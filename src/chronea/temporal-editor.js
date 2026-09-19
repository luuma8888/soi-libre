/* Éditeur métier commun aux éléments et bandes de contexte. Aucun champ ISO concurrent. */
const ChroneaTemporalEditor=(()=>{
'use strict';
const T=ChroneaTime,clone=x=>JSON.parse(JSON.stringify(x)),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
class Editor{
 constructor(host,system,temporal={kind:'point',start:null,end:null},{prefix='',shape='point',allowOpen=false}={}){
  this.host=host;this.system=system;this.original=clone(temporal);this.prefix=prefix;this.shape=shape;this.allowOpen=allowOpen;
  const first=allowOpen&&shape==='interval'?temporal.start:temporal.start||temporal.end,last=allowOpen&&shape==='interval'?temporal.end:temporal.start&&temporal.end?temporal.end:null;
  host.innerHTML=this.endpointHTML('start',first,temporal.kind==='openInterval'&&shape==='point'?(temporal.start?'after':'before'):first?.qualifier||'exact')+this.endpointHTML('end',last,last?.qualifier||'exact');
  for(const [key,ep]of [['start',first],['end',last]]){this.fillValue(key,ep?.value);this.fillValue(key+'Early',ep?.notBefore);this.fillValue(key+'Late',ep?.notAfter);this.el(key+'Qualifier').value=key==='start'&&temporal.kind==='openInterval'&&shape==='point'?(temporal.start?'after':'before'):ep?.qualifier||'exact';this.el(key+'Nuance').value=ep?.qualifier||'exact';}
  host.addEventListener('input',()=>this.refresh());host.addEventListener('change',()=>this.refresh());this.setShape(shape);this.initialSnapshot=this.snapshot();
 }
 id(key){return this.prefix+key;}
 el(key){return this.host.querySelector('#'+this.id(key));}
 field(key,label,control){return '<label class="field" for="'+this.id(key)+'">'+esc(label)+control+'</label>';}
 input(key,label,type='number',attrs=''){return this.field(key,label,'<input id="'+this.id(key)+'" type="'+type+'" '+attrs+'>');}
 valueHTML(key,value){const s=this.system;
  if(s.type==='numeric')return this.input(key+'Value',s.definition.unit||'Position','text','inputmode="decimal"');
  const months=s.type==='gregorian'?MONTHS:s.definition.months.map(m=>m.name).concat(s.definition.intercalaryDays?['Jours intercalaires']:[]);
  let html='<div class="date-grid">'+this.input(key+'Year','Année','number','step="1"')+this.field(key+'Month','Mois','<select id="'+this.id(key+'Month')+'"><option value="">Inconnu</option>'+months.map((m,i)=>'<option value="'+(i+1)+'">'+esc(m)+'</option>').join('')+'</select>')+this.input(key+'Day','Jour','number','min="1" step="1"')+'</div>';
  if(s.type==='customCalendar')html+=this.field(key+'Era','Ère','<select id="'+this.id(key+'Era')+'"><option value="">Sans ère</option>'+(s.definition.eras||[]).map(e=>'<option>'+esc(e.name)+'</option>').join('')+'</select>');
  if(s.type==='gregorian')html+='<details data-hour="'+key+'" '+(value?.hour!==undefined?'open':'')+'><summary>Ajouter une heure</summary>'+this.input(key+'Time','Heure','time','step="1"')+(value?.tzid||value?.utc?'<p class="notice">Fuseau importé conservé : '+esc(value.tzid||'UTC')+'</p>':'')+'<small>L’heure nécessite une année, un mois et un jour connus. Sans fuseau importé, elle reste une heure locale.</small></details>';
  return html;
 }
 endpointHTML(key,ep,qualifier){return '<fieldset class="field" id="'+this.id(key+'Endpoint')+'"><legend data-endpoint-legend>'+ (key==='start'?'Date':'Fin')+'</legend>'+this.field(key+'Qualifier','Précision','<select id="'+this.id(key+'Qualifier')+'">'+[['exact','Connue'],['approximate','Vers / environ'],['uncertain','Incertaine'],['before','Avant'],['after','Après']].filter(([v])=>key==='start'||!['before','after'].includes(v)).map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select>')+this.field(key+'Nuance','Nuance de cette borne','<select id="'+this.id(key+'Nuance')+'"><option value="exact">Connue</option><option value="approximate">Vers / environ</option><option value="uncertain">Incertaine</option></select>')+this.valueHTML(key,ep?.value)+'<details '+(ep?.notBefore!==undefined||ep?.notAfter!==undefined?'open':'')+'><summary>Je connais seulement une fourchette</summary><fieldset><legend>Au plus tôt</legend>'+this.valueHTML(key+'Early',ep?.notBefore)+'</fieldset><fieldset><legend>Au plus tard</legend>'+this.valueHTML(key+'Late',ep?.notAfter)+'</fieldset></details></fieldset>';}
 fillValue(key,value){if(this.system.type==='numeric'){this.el(key+'Value').value=value??'';return;}for(const suffix of ['Year','Month','Day','Era'])if(this.el(key+suffix))this.el(key+suffix).value=value?.[suffix.toLowerCase()]??'';if(this.el(key+'Time'))this.el(key+'Time').value=value?.hour!==undefined?[value.hour,value.minute??0,...(value.second!==undefined?[value.second]:[])].map(n=>String(n).padStart(2,'0')).join(':'):'';}
 setShape(shape){this.shape=shape;this.el('endEndpoint').hidden=shape!=='interval';this.el('startEndpoint').querySelector('[data-endpoint-legend]').textContent=shape==='interval'?'Début':'Date';const q=this.el('startQualifier');for(const option of q.options)if(['before','after'].includes(option.value))option.disabled=shape==='interval';if(shape==='interval'&&['before','after'].includes(q.value))q.value=this.el('startNuance').value;this.refresh();}
 refresh(){for(const key of ['start','end']){this.el(key+'Nuance').closest('label').hidden=!['before','after'].includes(this.el(key+'Qualifier').value);for(const tail of ['','Early','Late']){const hour=this.host.querySelector('[data-hour="'+key+tail+'"]');if(hour){const complete=['Year','Month','Day'].every(s=>this.el(key+tail+s).value!=='');hour.hidden=!complete&&!this.el(key+tail+'Time').value;}}}}
 readValue(key,previous){if(this.system.type==='numeric'){const text=this.el(key+'Value').value.trim();return text?Number(text.replace(',','.')):null;}
  const value=previous&&typeof previous==='object'?clone(previous):{};for(const suffix of ['Year','Month','Day','Era']){delete value[suffix.toLowerCase()];const text=this.el(key+suffix)?.value;if(text)value[suffix.toLowerCase()]=suffix==='Era'?text:Number(text);}
  const time=this.el(key+'Time')?.value;for(const k of ['hour','minute','second','tzid','utc'])delete value[k];if(time){const parts=time.split(':').map(Number);value.hour=parts[0];value.minute=parts[1];if(parts.length>2)value.second=parts[2];if(previous?.tzid)value.tzid=previous.tzid;if(previous?.utc)value.utc=true;}
  return Object.keys(value).length?value:null;
 }
 snapshot(){return JSON.stringify([this.shape,...[...this.host.querySelectorAll('input,select')].map(el=>[el.id,el.value])]);}
 read(){if(this.snapshot()===this.initialSnapshot){T.validateTemporal(this.original,this.system);return clone(this.original);}const oldA=this.allowOpen?this.original.start:this.original.start||this.original.end,oldB=this.allowOpen?this.original.end:this.original.start&&this.original.end?this.original.end:null;
  const endpoint=(key,old)=>{const value=this.readValue(key,old?.value);if(value===null)return null;const ep=old?clone(old):{};ep.value=value;ep.precision=T.precision(value,this.system);const q=this.el(key+'Qualifier').value;ep.qualifier=['before','after'].includes(q)?this.el(key+'Nuance').value:q;for(const [tail,prop]of [['Early','notBefore'],['Late','notAfter']]){const bound=this.readValue(key+tail,old?.[prop]);delete ep[prop];if(bound!==null)ep[prop]=bound;}return ep;};
  const first=endpoint('start',oldA),q=this.el('startQualifier').value;let temporal={...this.original,kind:this.shape,start:first,end:this.shape==='interval'?endpoint('end',oldB):null};if(this.shape==='point'&&['before','after'].includes(q))temporal={...temporal,kind:'openInterval',start:q==='after'?first:null,end:q==='before'?first:null};if(this.allowOpen&&this.shape==='interval'&&!!temporal.start!==!!temporal.end)temporal.kind='openInterval';T.validateTemporal(temporal,this.system);return temporal;
 }
}
return {Editor};
})();
