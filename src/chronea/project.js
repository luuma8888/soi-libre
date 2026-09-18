/* Projet V3 : objets stables, migrations transactionnelles et intégrité référentielle. */
const ChroneaProject=(()=>{
  'use strict';
  const C=ChroneaCore,T=ChroneaTime,clone=value=>JSON.parse(JSON.stringify(value));
  const id=()=>crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const stamp=()=>new Date().toISOString(),fail=m=>{throw new Error(m)};
  const RELATIONS=['related','causes','dependsOn','precedes','contains','contradicts','supports','sameSubject'];
  function schemaValidate(value,schema=CHRONEA_SCHEMA,path='$'){
    if(schema.$ref)return schemaValidate(value,CHRONEA_SCHEMA.$defs[schema.$ref.split('/').at(-1)],path);
    if(schema.anyOf){if(!schema.anyOf.some(s=>{try{schemaValidate(value,s,path);return true}catch{return false}}))fail(path+' : type incompatible.');return;}
    if(schema.const!==undefined&&value!==schema.const)fail(path+' : constante invalide.');
    if(schema.enum&&!schema.enum.includes(value))fail(path+' : valeur inconnue.');
    const type=value===null?'null':Array.isArray(value)?'array':typeof value;
    if(schema.type&&!([schema.type].flat().includes(type)||([schema.type].flat().includes('integer')&&Number.isInteger(value))))fail(path+' : type '+schema.type+' attendu.');
    if(schema.minimum!==undefined&&value<schema.minimum)fail(path+' : valeur trop petite.');
    if(schema.type==='object'){
      for(const key of schema.required||[])if(!Object.hasOwn(value,key))fail(path+'.'+key+' : champ requis.');
      for(const [key,item]of Object.entries(value))if(schema.properties?.[key])schemaValidate(item,schema.properties[key],path+'.'+key);else if(schema.additionalProperties&&typeof schema.additionalProperties==='object')schemaValidate(item,schema.additionalProperties,path+'.'+key);
    }
    if(schema.type==='array')value.forEach((item,i)=>schemaValidate(item,schema.items,path+'['+i+']'));
  }
  function timeline(title='Ma chronologie',timeSystemId='gregorian'){return {id:id(),title,timeSystemId,lanes:[],spans:[],events:[],relations:[]};}
  function create(title='Mon projet'){const t=timeline();return {schemaVersion:3,id:id(),title,createdAt:stamp(),updatedAt:stamp(),timelines:[t],timeSystems:[{id:'gregorian',type:'gregorian',name:'Calendrier grégorien',definition:{}}],media:[],sources:[],metadata:{}};}
  function event(title,temporal){return {id:id(),title,type:'Événement',summary:'',markdown:'',temporal,displayDate:'',laneId:null,tags:[],place:'',sourceIds:[],mediaIds:[],externalIds:{},createdAt:stamp(),updatedAt:stamp(),color:'#925b39',links:''};}
  function validate(project){
    C.checkTree(project);schemaValidate(project);
    const ids=new Set(),checkId=value=>{if(typeof value!=='string'||!/^[-\p{L}\p{N}_.:@+]{1,180}$/u.test(value)||ids.has(value))fail('ID absent, invalide ou dupliqué : '+value);ids.add(value);};
    checkId(project.id);if(!project.timelines.length||project.timelines.length>100)fail('Le projet nécessite 1 à 100 chronologies.');
    const systems=new Map(project.timeSystems.map(s=>[s.id,s]));
    project.timeSystems.forEach(s=>{checkId(s.id);T.validateSystem(s);});
    for(const s of project.sources){checkId(s.id);if(s.url&&!C.safeUrl(s.url))fail('URL de source refusée.');}
    for(const m of project.media){checkId(m.id);if(m.remoteUrl){if(!/^https?:/.test(C.safeUrl(m.remoteUrl)))fail('URL média refusée.');}else if(!C.MEDIA_TYPES.includes(m.mimeType))fail('MIME média refusé.');if(!Number.isSafeInteger(m.size)||m.size<0||m.size>20*1024*1024)fail('Taille média invalide (20 Mo maximum).');}
    const media=new Set(project.media.map(m=>m.id)),sources=new Set(project.sources.map(s=>s.id));
    for(const t of project.timelines){
      checkId(t.id);const system=systems.get(t.timeSystemId);if(!system)fail('Système temporel référencé absent.');
      const lanes=new Set(t.lanes.map(l=>l.id)),events=new Set(t.events.map(e=>e.id));
      t.lanes.forEach(l=>{checkId(l.id);if(l.color&&!/^#[\da-f]{6}$/i.test(l.color))fail('Couleur de fil invalide.');});
      if(t.events.length>20000)fail('20 000 événements maximum par chronologie.');
      for(const e of [...t.events,...t.spans]){
        checkId(e.id);if(!e.title.trim())fail('Titre requis.');T.validateTemporal(e.temporal,system);
        if(e.laneId&&!lanes.has(e.laneId))fail('Fil référencé absent.');
        if(e.color&&!/^#[\da-f]{6}$/i.test(e.color))fail('Couleur invalide.');
      }
      for(const e of t.events){
        if(e.sourceIds.some(x=>!sources.has(x))||e.mediaIds.some(x=>!media.has(x)))fail('Source ou média référencé absent.');
        if(Object.values(e.externalIds).some(v=>/[\r\n]/.test(v)))fail('Identifiant externe invalide.');
        C.validateLinks(e.links||'');
      }
      const edges=new Set();for(const r of t.relations){checkId(r.id);if(!events.has(r.sourceId)||!events.has(r.targetId)||r.sourceId===r.targetId)fail('Relation non résolue.');if(!RELATIONS.includes(r.type))fail('Type de relation inconnu.');const key=[r.type,r.direction,...(r.direction==='undirected'?[r.sourceId,r.targetId].sort():[r.sourceId,r.targetId])].join('|');if(edges.has(key))fail('Relation dupliquée.');edges.add(key);}
    }
    return true;
  }
  function fromLegacy(input){
    const s=input.app?C.readNative(input):C.migrateState(input),p=create('Projet importé');p.timelines=[];
    const assets=new Map(),report={fromVersion:input.schemaVersion||input.version||1,toVersion:3,events:0,relations:0,media:0,remappedIds:0};
    const used=new Set([p.id,'gregorian']),unique=old=>{if(old&&!used.has(old)){used.add(old);return old;}const fresh=id();used.add(fresh);report.remappedIds++;return fresh;};
    const sourceByText=new Map(),mediaByContent=new Map();
    for(const old of s.timelines){
      const systemId=old.timeMode==='calendar'?'gregorian':unique('numeric-'+old.id);
      if(old.timeMode==='universal')p.timeSystems.push({id:systemId,type:'numeric',name:'Axe '+old.name,definition:{unit:old.unit||'cycle',direction:1}});
      const t=timeline(old.name,systemId);t.id=unique(old.id);const laneByName=new Map(),eventIds=new Map();
      for(const legacy of old.events){
        const e=event(legacy.title,T.legacyTemporal(legacy.time||{},old.timeMode));e.id=unique(legacy.id);eventIds.set(legacy.id,e.id);report.events++;
        Object.assign(e,{type:legacy.kind||'Événement',summary:legacy.summary||'',markdown:legacy.markdown||'',displayDate:legacy.dateLabel||'',tags:clone(legacy.tags),place:legacy.location||'',color:legacy.color||'#925b39',links:legacy.links||'',createdAt:legacy.createdAt||stamp(),updatedAt:legacy.updatedAt||stamp(),externalIds:{...(legacy.externalIds||{}),legacyChroneaId:legacy.id}});
        if(legacy.icalRelations)e.metadata={icalRelations:clone(legacy.icalRelations)};
        if(legacy.group){if(!laneByName.has(legacy.group)){const lane={id:unique(null),name:legacy.group,order:t.lanes.length,visible:true,color:e.color,description:''};t.lanes.push(lane);laneByName.set(legacy.group,lane.id);}e.laneId=laneByName.get(legacy.group);}
        if(legacy.sources){if(!sourceByText.has(legacy.sources)){const source={id:unique(null),title:legacy.sources.split('\n')[0].slice(0,140),citation:legacy.sources,type:'legacy',metadata:{legacyText:true}};p.sources.push(source);sourceByText.set(legacy.sources,source.id);}e.sourceIds=[sourceByText.get(legacy.sources)];}
        for(const a of legacy.attachments){
          const key=a.remoteUrl||a.dataUrl;
          if(!mediaByContent.has(key)){const mid=unique(a.id);const m={id:mid,name:a.name||'Fichier',mimeType:a.type,size:a.size,storageRef:a.remoteUrl?'remote:'+mid:'media/'+mid,alt:a.alt||'',caption:a.caption||'',metadata:{legacyAttachmentId:a.id}};if(a.remoteUrl)m.remoteUrl=a.remoteUrl;else assets.set(m.storageRef,a.dataUrl);p.media.push(m);mediaByContent.set(key,mid);report.media++;}e.mediaIds.push(mediaByContent.get(key));
        }
        t.events.push(e);
      }
      const edgeKeys=new Set();for(const legacy of old.events)for(const target of legacy.relations){const pair=[eventIds.get(legacy.id),eventIds.get(target)].sort(),key=pair.join('|');if(!edgeKeys.has(key)){edgeKeys.add(key);t.relations.push({id:unique(null),sourceId:pair[0],targetId:pair[1],type:'related',direction:'undirected',note:''});report.relations++;}}
      p.timelines.push(t);
    }
    p.metadata.migration={...report,at:stamp()};validate(p);return {project:p,assets,report,prefs:s.prefs||{},currentId:p.timelines[s.timelines.findIndex(t=>t.id===s.currentId)]?.id||p.timelines[0].id};
  }
  function read(input){C.checkTree(input);if(input.app!==undefined&&(input.app!=='Chronéa'||![1,2,3].includes(input.schemaVersion)))fail('Application ou version native non prise en charge.');if(input.app==='Chronéa'&&[1,2].includes(input.schemaVersion))return fromLegacy(input);const p=clone(input.project||input);validate(p);return {project:p,assets:new Map(),report:{fromVersion:3,toVersion:3}};}
  function removeEvents(project,timelineId,eventIds){const p=clone(project),t=p.timelines.find(t=>t.id===timelineId),removed=new Set(eventIds);if(!t)fail('Chronologie absente.');t.events=t.events.filter(e=>!removed.has(e.id));t.relations=t.relations.filter(r=>!removed.has(r.sourceId)&&!removed.has(r.targetId));const uids=new Set(project.timelines.find(x=>x.id===timelineId).events.filter(e=>removed.has(e.id)).map(e=>e.externalIds.icalUid).filter(Boolean));for(const e of t.events)if(e.metadata?.icalRelations)e.metadata.icalRelations=e.metadata.icalRelations.filter(r=>!uids.has(r.uid));validate(p);return p;}
  function subset(project,timelineId){const p=clone(project);p.timelines=p.timelines.filter(t=>t.id===timelineId);const sourceIds=new Set(p.timelines.flatMap(t=>t.events.flatMap(e=>e.sourceIds))),mediaIds=new Set(p.timelines.flatMap(t=>t.events.flatMap(e=>e.mediaIds)));p.sources=p.sources.filter(s=>sourceIds.has(s.id));p.media=p.media.filter(m=>mediaIds.has(m.id));p.timeSystems=p.timeSystems.filter(s=>p.timelines.some(t=>t.timeSystemId===s.id));validate(p);return p;}
  return {id,stamp,clone,RELATIONS,schemaValidate,create,timeline,event,validate,fromLegacy,read,removeEvents,subset};
})();
