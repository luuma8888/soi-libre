/* Temporalité V3. Les coordonnées sont dérivées et ne deviennent jamais des dates. */
const ChroneaTime = (() => {
  'use strict';
  const C=ChroneaCore, has=C.hasValue;
  const fail=message=>{throw new Error(message)};
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;
  // Calendrier grégorien proleptique, arithmétique entière, sans limite de Date.UTC.
  function civilDay(year,month=1,day=1){
    let y=year-(month<=2?1:0);const era=Math.floor(y/400),yoe=y-era*400;
    const doy=Math.floor((153*(month+(month>2?-3:9))+2)/5)+day-1;
    return era*146097+yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy-719468;
  }
  function dayCivil(day){
    const z=Math.floor(day)+719468,era=Math.floor(z/146097),doe=z-era*146097;
    const yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);
    let year=yoe+era*400;const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100));
    const mp=Math.floor((5*doy+2)/153),d=doy-Math.floor((153*mp+2)/5)+1,m=mp+(mp<10?3:-9);
    year+=m<=2?1:0;return {year,month:m,day:d};
  }
  function precision(value,system){
    if(system.type==='numeric')return 'numeric';
    if(!has(value.year)||(!has(value.month)&&has(value.day)))return 'partial';
    for(const key of ['second','minute','hour','day','month'])if(has(value[key]))return key;
    return 'year';
  }
  function validateSystem(system){
    if(!system||!['gregorian','numeric','customCalendar'].includes(system.type))fail('Système temporel inconnu.');
    const d=system.definition;
    if(!d||typeof d!=='object')fail('Définition temporelle absente.');
    if(system.type==='numeric'){
      if(typeof d.unit!=='string'||![1,-1].includes(d.direction??1))fail('Unité ou direction numérique invalide.');
    }
    if(system.type==='customCalendar'){
      if(!Array.isArray(d.months)||!d.months.length||d.months.length>100||d.months.some(m=>typeof m.name!=='string'||!Number.isInteger(m.days)||m.days<1||m.days>100000))fail('Mois du calendrier personnalisé invalides.');
      if(d.intercalaryDays!==undefined&&(!Number.isInteger(d.intercalaryDays)||d.intercalaryDays<0||d.intercalaryDays>100000))fail('Jours intercalaires invalides.');
      if(d.eras!==undefined&&(!Array.isArray(d.eras)||d.eras.some(e=>typeof e.name!=='string'||!Number.isSafeInteger(e.offset))))fail('Ères du calendrier invalides.');
    }
    return true;
  }
  function validateValue(value,system){
    if(system.type==='numeric'){if(!finite(value))fail('Position numérique non finie ou hors plage.');return;}
    if(!value||typeof value!=='object'||Array.isArray(value))fail('Composants de date invalides.');
    if(system.type==='gregorian'){for(const k of ['year','month','day'])if(has(value[k])&&typeof value[k]!=='number')fail('Composants de date non numériques.');C.validateDate(value.year,value.month,value.day);}
    else{
      if(has(value.year)&&(!Number.isSafeInteger(value.year)||Math.abs(value.year)>1e9))fail('Année imaginaire invalide.');
      if(has(value.month)&&(!Number.isInteger(value.month)||value.month<1||value.month>system.definition.months.length+(system.definition.intercalaryDays?1:0)))fail('Cycle du calendrier imaginaire invalide.');
      if(has(value.day)&&(!Number.isInteger(value.day)||value.day<1||value.day>(has(value.month)?system.definition.months[value.month-1]?.days||system.definition.intercalaryDays:Math.max(...system.definition.months.map(m=>m.days)))))fail('Jour imaginaire invalide.');
      if(value.era&&!system.definition.eras?.some(e=>e.name===value.era))fail('Ère inconnue.');
    }
    if(has(value.hour)){
      if(system.type!=='gregorian'||![value.year,value.month,value.day].every(has))fail('Un horaire nécessite une date grégorienne complète.');
      for(const [key,max]of [['hour',23],['minute',59],['second',59]])if(has(value[key])&&(!Number.isInteger(value[key])||value[key]<0||value[key]>max))fail('Horaire invalide.');
      const endpoint=icsEndpoint(value);C.validateICSDate(endpoint);C.icsInstant(endpoint);
    }else if(has(value.minute)||has(value.second)||value.tzid||value.utc)fail('Fuseau/minute/seconde sans heure.');
  }
  function icsEndpoint(value){
    const p=n=>String(n).padStart(2,'0');
    const endpoint={type:'DATE-TIME',value:String(value.year).padStart(4,'0')+p(value.month)+p(value.day)+'T'+p(value.hour)+p(value.minute||0)+p(value.second||0)+(value.utc?'Z':'')};
    if(value.tzid)endpoint.tzid=value.tzid;return endpoint;
  }
  function valueBounds(value,system){
    validateValue(value,system);
    if(system.type==='numeric'){const n=value*(system.definition.direction??1);return {min:n,max:n,anchor:n};}
    if(!has(value.year))return {min:null,max:null,anchor:null};
    const {year,month,day}=value;
    if(has(value.hour)){
      const n=C.icsInstant(icsEndpoint(value))/86400000;return {min:n,max:n,anchor:n};
    }
    if(system.type==='customCalendar'){
      const d=system.definition,length=d.months.reduce((n,m)=>n+m.days,0)+(d.intercalaryDays||0);
      const offset=value.era?d.eras.find(e=>e.name===value.era).offset:0;
      let min=(year+offset)*length,max=min+length;
      if(has(month)){min+=d.months.slice(0,month-1).reduce((n,m)=>n+m.days,0);max=min+(d.months[month-1]?.days||d.intercalaryDays);if(has(day)){min+=day-1;max=min+1;}}
      return {min,max,anchor:(min+max)/2};
    }
    const min=civilDay(year,month||1,has(month)?day||1:1);
    const max=!has(month)?civilDay(year+1):!has(day)?(month===12?civilDay(year+1):civilDay(year,month+1)):min+1;
    return {min,max,anchor:(min+max)/2};
  }
  function endpointBounds(endpoint,system){
    if(!endpoint)return {min:null,max:null,anchor:null};
    const b=valueBounds(endpoint.value,system);
    if(endpoint.notBefore!==undefined)b.min=valueBounds(endpoint.notBefore,system).min;
    if(endpoint.notAfter!==undefined)b.max=valueBounds(endpoint.notAfter,system).max;
    if(Number.isFinite(b.min)&&Number.isFinite(b.max)&&(b.anchor===null||b.anchor<b.min||b.anchor>b.max))b.anchor=(b.min+b.max)/2;
    return b;
  }
  function validateTemporal(temporal,system){
    validateSystem(system);
    if(!temporal||!['point','interval','openInterval'].includes(temporal.kind))fail('Forme temporelle V3 invalide.');
    for(const endpoint of [temporal.start,temporal.end])if(endpoint){
      if(!['exact','approximate','uncertain'].includes(endpoint.qualifier))fail('Qualification temporelle inconnue.');
      validateValue(endpoint.value,system);
      if(endpoint.precision!==precision(endpoint.value,system))fail('Précision incompatible avec les composants saisis.');
      for(const key of ['notBefore','notAfter'])if(endpoint[key]!==undefined)validateValue(endpoint[key],system);
      if(endpoint.notBefore!==undefined&&endpoint.notAfter!==undefined){
        const a=valueBounds(endpoint.notBefore,system),b=valueBounds(endpoint.notAfter,system);
        if(a.min===null||b.max===null||a.min>b.max)fail('Bornes de possibilité inversées ou non positionnables.');
      }
      const b=endpointBounds(endpoint,system);if(b.min!==null&&b.max!==null&&b.min>b.max)fail('Bornes de possibilité incohérentes.');
    }
    if(temporal.kind==='point'&&temporal.end)fail('Un repère ne possède pas de fin.');
    if(temporal.kind==='interval'&&(!temporal.start||!temporal.end))fail('Une période nécessite deux bornes.');
    if(temporal.kind==='openInterval'&&!!temporal.start===!!temporal.end)fail('Un intervalle ouvert nécessite exactement une borne.');
    if(temporal.start&&temporal.end){const a=endpointBounds(temporal.start,system),b=endpointBounds(temporal.end,system);if(a.min===null||b.max===null||a.min>b.max)fail('La fin doit suivre le début dans la direction de cet axe.');}
    return true;
  }
  function range(temporal,system){
    const a=endpointBounds(temporal.start,system),b=endpointBounds(temporal.end,system);
    if(temporal.kind==='point')return {...a,endAnchor:a.anchor};
    return {min:a.min,max:b.max,anchor:a.anchor??b.anchor,endAnchor:b.anchor??a.anchor};
  }
  function legacyTemporal(time,mode){
    const system={type:mode==='universal'?'numeric':'gregorian',definition:{unit:time.unit||'',direction:1}};
    const q=v=>v==='about'?'approximate':v==='uncertain'?'uncertain':'exact';
    const endpoint=(prefix,ical)=>{
      let value;if(mode==='universal'){if(!has(time[prefix==='start'?'start':'end']))return null;value=Number(time[prefix]);}
      else{value={};for(const [k,suffix]of [['year','Year'],['month','Month'],['day','Day']])if(has(time[prefix+suffix]))value[k]=Number(time[prefix+suffix]);if(!Object.keys(value).length)return null;
        if(ical){value.hour=Number(ical.value.slice(9,11));value.minute=Number(ical.value.slice(11,13));value.second=Number(ical.value.slice(13,15));if(ical.tzid)value.tzid=ical.tzid;if(ical.value.endsWith('Z'))value.utc=true;}}
      return {value,precision:precision(value,system),qualifier:q(time.certainty||time.qualifier),...(mode==='universal'&&time.unit?{unit:time.unit}:{})};
    };
    const start=endpoint('start',time.ical?.start),end=endpoint('end',time.ical?.end),qualifier=time.certainty||time.qualifier;
    if(qualifier==='before')return {kind:'openInterval',start:null,end:start};
    if(qualifier==='after')return {kind:'openInterval',start,end:null};
    return {kind:end?'interval':'point',start,end};
  }
  function parseValue(text,system){
    text=String(text).trim();if(!text)return null;
    if(system.type==='numeric'){const n=Number(text);validateValue(n,system);return n;}
    let era; if(system.type==='customCalendar'&&text.includes('@')){[text,era]=text.split('@');era=era.trim();}
    const match=text.match(/^(Y?-?\d{1,10}|XXXX)(?:-(\d{1,2}|XX))?(?:-(\d{1,2}|XX))?(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|\[[^\]]+\])?)?$/);
    if(!match)fail('Utilise année, année-mois, année-mois-jour, ou un horaire ISO.');
    const value={};for(const [index,key]of [[1,'year'],[2,'month'],[3,'day'],[4,'hour'],[5,'minute'],[6,'second']])if(match[index]&&!/X/.test(match[index]))value[key]=Number(match[index].replace(/^Y/,''));
    if(era)value.era=era;
    if(match[7]==='Z')value.utc=true;else if(match[7])value.tzid=match[7].slice(1,-1);
    validateValue(value,system);return value;
  }
  function valueText(value,system){
    if(system.type==='numeric')return String(value);
    const year=has(value.year)?(value.year<0?'-'+String(-value.year).padStart(4,'0'):String(value.year).padStart(4,'0')):'XXXX';
    let text=year;if(has(value.month)||has(value.day))text+='-'+(has(value.month)?String(value.month).padStart(2,'0'):'XX');if(has(value.day))text+='-'+String(value.day).padStart(2,'0');
    if(has(value.hour))text+='T'+String(value.hour).padStart(2,'0')+':'+String(value.minute||0).padStart(2,'0')+(has(value.second)?':'+String(value.second).padStart(2,'0'):'')+(value.utc?'Z':value.tzid?'['+value.tzid+']':'');return text+(value.era?'@'+value.era:'');
  }
  function endpointLabel(endpoint,system){
    if(!endpoint)return '';
    let text=valueText(endpoint.value,system);
    if(system.type==='numeric')text+=' '+(endpoint.unit||system.definition.unit||'');
    if(system.type==='customCalendar'&&has(endpoint.value.month)){const v=endpoint.value;const tokens={jour:v.day??'',mois:system.definition.months[v.month-1]?.name||'Jours intercalaires',année:v.year??'année inconnue',ère:v.era||''};text=(system.definition.displayFormat||'jour mois année ère').replace(/jour|mois|année|ère/g,key=>tokens[key]).trim();}
    if(endpoint.qualifier==='approximate')text='vers '+text;else if(endpoint.qualifier==='uncertain')text+=' ?';
    if(endpoint.notBefore!==undefined||endpoint.notAfter!==undefined)text+=' ['+(endpoint.notBefore!==undefined?valueText(endpoint.notBefore,system):'…')+' → '+(endpoint.notAfter!==undefined?valueText(endpoint.notAfter,system):'…')+']';return text;
  }
  function label(temporal,system){
    if(temporal.displayLabel)return temporal.displayLabel;
    if(temporal.kind==='openInterval')return temporal.start?'après '+endpointLabel(temporal.start,system):'avant '+endpointLabel(temporal.end,system);
    return endpointLabel(temporal.start,system)+(temporal.end?' — '+endpointLabel(temporal.end,system):'')||'Repère non daté';
  }
  function edtf(temporal,system){
    if(system.type!=='gregorian')return '';
    const part=e=>{if(!e||has(e.value.hour)||e.notBefore!==undefined||e.notAfter!==undefined)return null;let text=valueText(e.value,system);if(has(e.value.year)&&Math.abs(e.value.year)>9999)text='Y'+text;return text+(e.qualifier==='approximate'?'~':e.qualifier==='uncertain'?'?':'');};
    const a=part(temporal.start),b=part(temporal.end);
    if(temporal.kind==='openInterval')return temporal.start?(a?a+'/..':''):(b?'../'+b:'');
    return a?(temporal.end&&b?a+'/'+b:temporal.end?'':a):'';
  }
  return {civilDay,dayCivil,precision,validateSystem,validateValue,validateTemporal,valueBounds,
    endpointBounds,range,legacyTemporal,parseValue,valueText,label,edtf,icsEndpoint};
})();
