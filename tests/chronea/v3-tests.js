(() => {
  const P=ChroneaProject,T=ChroneaTime,C=ChroneaCore,results=[];
  const assert=(value,message='Assertion échouée')=>{if(!value)throw new Error(message)};
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const equal=(a,b)=>assert(JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),JSON.stringify({a,b}));
  const rejects=fn=>{let yes=false;try{fn()}catch{yes=true}assert(yes,'Donnée invalide acceptée')};
  const test=(name,fn)=>{try{fn();results.push({name,ok:true})}catch(error){results.push({name,ok:false,error:error.message})}};
  const g={id:'gregorian',type:'gregorian',name:'Grégorien',definition:{}};
  const n={id:'numeric',type:'numeric',name:'Cycles',definition:{unit:'cycle',direction:1}};
  const ep=(value,system=g,qualifier='exact')=>({value,precision:T.precision(value,system),qualifier});
  const point=value=>({kind:'point',start:ep(value),end:null});
  test('V3 nouveau projet valide et sans préférences métier',()=>{const p=P.create();P.validate(p);assert(!p.prefs);assert(p.schemaVersion===3)});
  test('V3 JSON Schema réellement appliqué',()=>{const p=P.create();delete p.timeSystems;rejects(()=>P.validate(p));});
  test('V3 migration V2 conserve dates, IDs, lanes et arête unique',()=>{
    const legacy={version:2,currentId:'t1',timelines:[{id:'t1',name:'Mémoire',timeMode:'calendar',unit:'cycle',events:[{id:'a',title:'A',time:{startYear:2012,certainty:'about'},group:'Famille',tags:['été'],sources:'Carnet',location:'Lac',relations:['b'],attachments:[]},{id:'b',title:'B',time:{startYear:2013},group:'Famille',tags:[],relations:['a'],attachments:[]}]}]};
    const original=JSON.stringify(legacy),r=P.fromLegacy(legacy);equal(JSON.stringify(legacy),original);equal(r.project.timelines[0].events[0].id,'a');equal(r.project.timelines[0].lanes.length,1);equal(r.project.timelines[0].relations.length,1);equal(r.project.timelines[0].events[0].temporal.start.value,{year:2012});equal(r.project.timelines[0].events[0].temporal.start.qualifier,'approximate');equal(r.project.sources[0].citation,'Carnet');
  });
  test('V3 migration extrait et déduplique les médias',()=>{
    const a={id:'file',name:'note.txt',type:'text/plain',size:4,dataUrl:'data:text/plain;base64,'+btoa('note')};
    const events=['a','b'].map(id=>({id,title:id,time:{startYear:2012},tags:[],relations:[],attachments:[a]}));
    const r=P.fromLegacy({version:2,currentId:'t',timelines:[{id:'t',name:'T',timeMode:'calendar',events}]});equal(r.project.media.length,1);equal(r.assets.size,1);equal(r.project.timelines[0].events[0].mediaIds,r.project.timelines[0].events[1].mediaIds);assert(!JSON.stringify(r.project).includes('base64'));
  });
  test('V3 IDs dupliqués entre chronologies remappés avec références',()=>{
    const t=id=>({id,name:id,timeMode:'calendar',events:[{id:'a',title:'A',time:{startYear:2012},tags:[],relations:[],attachments:[]}]});
    const r=P.fromLegacy({version:2,currentId:'t1',timelines:[t('t1'),t('t2')]});assert(r.project.timelines[0].events[0].id!==r.project.timelines[1].events[0].id);equal(r.project.timelines[1].events[0].externalIds.legacyChroneaId,'a');
  });
  test('V3 relations directionnelles non symétrisées et suppression intègre',()=>{
    const p=P.create(),t=p.timelines[0];t.events=[P.event('Cause',point({year:2000})),P.event('Suite',point({year:2001}))];t.relations=[{id:P.id(),sourceId:t.events[0].id,targetId:t.events[1].id,type:'causes',direction:'directed',note:''}];P.validate(p);equal(P.removeEvents(p,t.id,[t.events[0].id]).timelines[0].relations,[]);equal(t.relations.length,1);
  });
  test('V3 round-trip natif exact',()=>{const p=P.create();p.timelines[0].events=[P.event('Année seule',point({year:2012}))];equal(P.read(JSON.parse(JSON.stringify({app:'Chronéa',schemaVersion:3,project:p}))).project,p)});
  test('V3 références média, fil, système absentes refusées',()=>{for(const key of ['mediaIds','laneId']){const p=P.create(),e=P.event('Repère',point({year:2012}));e[key]=key==='laneId'?'missing':['missing'];p.timelines[0].events=[e];rejects(()=>P.validate(p));}});
  test('V3 précision indépendante par borne',()=>{T.validateTemporal({kind:'interval',start:ep({year:1998,month:3},g,'approximate'),end:ep({year:2001,month:6,day:12})},g)});
  test('V3 possibilité mars–juin 1998 conservée sans jour ajouté',()=>{const start={...ep({year:1998},g,'uncertain'),notBefore:{year:1998,month:3},notAfter:{year:1998,month:6}};T.validateTemporal({kind:'point',start,end:null},g);equal(T.endpointBounds(start,g).min,T.civilDay(1998,3));equal(start.value,{year:1998});});
  test('V3 bornes de possibilité inversées refusées',()=>rejects(()=>T.validateTemporal({kind:'point',start:{...ep({year:1998}),notBefore:{year:1998,month:6},notAfter:{year:1998,month:3}},end:null},g)));
  test('V3 avant/après naturellement ouverts',()=>{T.validateTemporal({kind:'openInterval',start:null,end:ep({year:1980})},g);equal(T.edtf({kind:'openInterval',start:null,end:ep({year:1980})},g),'../1980')});
  test('V3 position cycle 12.5 et direction décroissante',()=>{const system={...n,definition:{unit:'cycle',direction:-1}};T.validateTemporal({kind:'interval',start:ep(12.5,system),end:ep(10,system)},system);equal(T.range({kind:'point',start:ep(12.5,system),end:null},system).anchor,-12.5)});
  test('V3 calendrier fictif nommé et intercalaires',()=>{const system={type:'customCalendar',definition:{months:[{name:'Aube',days:30},{name:'Source',days:20}],intercalaryDays:2,eras:[{name:'Renouveau',offset:100}]}};T.validateSystem(system);T.validateTemporal({kind:'point',start:ep({year:2,month:3,day:2,era:'Renouveau'},system),end:null},system);rejects(()=>T.validateValue({year:2,month:2,day:21},system));});
  test('V3 jours grégoriens réversibles sur grandes années et avant notre ère',()=>{for(const year of [-1000000,-44,0,99,1900,2000,2024,1000000])equal(T.dayCivil(T.civilDay(year,3,15)),{year,month:3,day:15});equal(T.civilDay(1970),0)});
  test('V3 horaires UTC et TZID représentent le même instant',()=>equal(T.valueBounds({year:2026,month:9,day:18,hour:12,minute:0,tzid:'Europe/Paris'},g).anchor,T.valueBounds({year:2026,month:9,day:18,hour:10,minute:0,utc:true},g).anchor));
  test('V3 EDTF n’invente pas d’heure, d’unité ni de bornes',()=>{equal(T.edtf(point({year:2012}),g),'2012');equal(T.edtf({kind:'point',start:ep(12,n),end:null},n),'');equal(T.edtf({kind:'point',start:{...ep({year:2012}),notBefore:{year:2011}},end:null},g),'')});
  test('V3 parsing partiel, négatif, horaire et étendu',()=>{equal(T.parseValue('-0044-03',g),{year:-44,month:3});equal(T.parseValue('2012-XX-15',g),{year:2012,day:15});equal(T.parseValue('12.5',n),12.5);rejects(()=>T.parseValue('2024-02-31',g));});
  return results;
})()
