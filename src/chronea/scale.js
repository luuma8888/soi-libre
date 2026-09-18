/* Échelle dérivée : graduations, agrégation et placement. Aucun changement des dates métier. */
const ChroneaScale=(()=>{
 'use strict';const T=ChroneaTime;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const nice=n=>{const power=10**Math.floor(Math.log10(Math.max(n,1e-15))),ratio=n/power;return [1,2,5,10].find(x=>x>=ratio)*power;};
 function ticks(domain,system,width=1100){
  const span=domain.max-domain.min,count=Math.max(2,Math.floor(width/130)),items=[];let step=nice(span/count);
  if(system.type==='gregorian'&&span>730){const a=T.dayCivil(domain.min).year,b=T.dayCivil(domain.max).year;step=Math.max(1,nice((b-a)/count));for(let year=Math.ceil(a/step)*step;year<=b&&items.length<30;year+=step){const value=T.civilDay(year);if(value>=domain.min)items.push({value,label:Math.abs(year)>=1e6?String(Number((year/1e6).toPrecision(5)))+' M ans':String(year)})}}
  else if(system.type==='gregorian'&&span>60){const a=T.dayCivil(domain.min),b=T.dayCivil(domain.max),start=a.year*12+a.month-1,end=b.year*12+b.month-1;step=Math.max(1,nice((end-start)/count));for(let m=Math.ceil(start/step)*step;m<=end&&items.length<30;m+=step){const year=Math.floor(m/12),month=m-year*12+1,value=T.civilDay(year,month);if(value>=domain.min)items.push({value,label:year+'-'+String(month).padStart(2,'0')})}}
  else{if(system.type==='gregorian')step=span<2?Math.max(1/1440,Math.ceil(step*24)/24):Math.max(1,step);for(let n=Math.ceil(domain.min/step)*step;n<=domain.max&&items.length<30;n+=step){let label;if(system.type==='gregorian'){label=T.valueText(T.dayCivil(n),system);if(span<2){const minutes=Math.round((n-Math.floor(n))*1440);label+=' '+String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')}}else label=String(Number((n*(system.type==='numeric'?(system.definition.direction??1):1)).toPrecision(8)));items.push({value:n,label})}}
  return items;
 }
 function layout(events,timeline,system,domain,width=1100){
  const left=130,right=30,plot=width-left-right,x=n=>left+(n-domain.min)/(domain.max-domain.min)*plot;
  const laneIds=[null,...timeline.lanes.filter(l=>l.visible).sort((a,b)=>a.order-b.order).map(l=>l.id)],lanes=[],nodes=[];let y=65;
  const bins=Math.max(12,Math.floor(500/Math.max(1,laneIds.length)));
  for(const laneId of laneIds){const rows=[],members=events.filter(e=>(e.laneId||null)===laneId&&T.range(e.temporal,system).anchor!==null),groups=new Map();
   for(const e of members){const r=T.range(e.temporal,system),bucket=Math.floor((r.anchor-domain.min)/(domain.max-domain.min)*bins);if(!groups.has(bucket))groups.set(bucket,[]);groups.get(bucket).push({e,r})}
   const packs=[];for(const group of groups.values()){if(group.length>3){packs.push({events:group.map(g=>g.e),min:Math.min(...group.map(g=>g.r.min??g.r.anchor)),max:Math.max(...group.map(g=>g.r.max??g.r.anchor)),anchor:group.reduce((n,g)=>n+g.r.anchor,0)/group.length})}else for(const g of group)packs.push({events:[g.e],...g.r})}
   packs.sort((a,b)=>a.anchor-b.anchor);
   for(const pack of packs){const point=Math.max(left,Math.min(width-right,x(pack.anchor))),start=Math.max(left,x(pack.min??domain.min)),end=Math.min(width-right,x(pack.max??domain.max)),label=pack.events.length>1?pack.events.length+' repères':pack.events[0].title;const size=Math.min(240,Math.max(45,label.length*7));const labelX=point+size+12>width-right?Math.max(left+9,point-size-9):point+9,labelStart=Math.min(point,labelX,start);let row=rows.findIndex(endX=>endX<labelStart-8);if(row<0)row=rows.length;rows[row]=Math.max(labelX+size,end,point+6);nodes.push({...pack,labelX,x:point,x1:start,x2:Math.max(start,end),y:y+24+row*43,label,laneId})}
   const height=Math.max(65,rows.length*43+35);lanes.push({id:laneId,name:timeline.lanes.find(l=>l.id===laneId)?.name||'Repères',y,height});y+=height;
  }
  return {nodes,lanes,height:y+45,width,left,right,plot,x,domain};
 }
 function svg(events,timeline,system,domain,options={}){
  const l=layout(events,timeline,system,domain,options.width||1100),ticksList=ticks(domain,system,l.width),color='#33413f',background=options.background||'#faf8f2';let body=`<rect width="100%" height="100%" fill="${background}"/><style>text{font-family:system-ui,sans-serif;fill:${color}}.scale-node{cursor:pointer}.scale-node:focus{outline:3px solid #426b7a}</style>`;
  for(const lane of l.lanes)body+=`<rect x="${l.left}" y="${lane.y}" width="${l.plot}" height="${lane.height}" fill="${l.lanes.indexOf(lane)%2?'#f0f4ef':'#f9f6ee'}"/><text x="8" y="${lane.y+28}" font-size="13">${esc(lane.name.slice(0,18))}</text>`;
  if(options.spans!==false)for(const span of timeline.spans){const r=T.range(span.temporal,system),a=l.x(r.min??domain.min),b=l.x(r.max??domain.max);if(b<l.left||a>l.width-l.right)continue;const lane=l.lanes.find(x=>x.id===span.laneId),top=lane?.y??65,height=lane?.height??l.height-100;body+=`<rect x="${Math.max(l.left,a)}" y="${top}" width="${Math.max(0,Math.min(l.width-l.right,b)-Math.max(l.left,a))}" height="${height}" fill="${esc(span.color||'#d9e6d8')}" opacity=".32"/><text x="${Math.max(l.left,a)+4}" y="${top+12}" font-size="10">${esc(span.title)}</text>`}
  for(const tick of ticksList){const x=l.x(tick.value);body+=`<path d="M${x},48V${l.height-24}" stroke="#c6d1ca" stroke-dasharray="2 4"/><text x="${x}" y="30" font-size="11" text-anchor="middle">${esc(tick.label)}</text>`}
  for(const n of l.nodes){const e=n.events[0],cluster=n.events.length>1,uncertain=[e.temporal.start,e.temporal.end].filter(Boolean).some(ep=>ep.qualifier!=='exact'||ep.notBefore!==undefined||ep.notAfter!==undefined),attrs=cluster?`data-cluster="${esc(n.events.map(e=>e.id).join(','))}"`:`data-open-event="${esc(e.id)}"`;
   body+=`<g class="scale-node" role="button" tabindex="0" aria-label="${esc(cluster?n.label:T.label(e.temporal,system)+' · '+e.title)}" ${attrs}><title>${esc(cluster?n.label:T.label(e.temporal,system)+' · '+e.title)}</title>`;
   if(cluster)body+=`<rect x="${n.labelX-6}" y="${n.y-12}" width="90" height="27" rx="8" fill="#dbe8dd" stroke="#708e75"/>`;
   else{if(e.temporal.kind!=='point')body+=`<path d="M${n.x1},${n.y}H${n.x2}" stroke="${esc(e.color)}" stroke-width="7" ${uncertain?'stroke-dasharray="5 4"':''}/>`;if(uncertain||e.temporal.start?.precision!=='day'&&e.temporal.start?.precision!=='numeric')body+=`<rect x="${n.x1}" y="${n.y-7}" width="${Math.max(2,n.x2-n.x1)}" height="14" fill="${esc(e.color)}" opacity=".18"/>`;body+=`<circle cx="${n.x}" cy="${n.y}" r="5" fill="${esc(e.color)}"/>`;if(e.temporal.kind==='openInterval')body+=`<text x="${e.temporal.start?n.x2-15:n.x1}" y="${n.y+4}" font-size="16">${e.temporal.start?'→':'←'}</text>`}
   body+=`<text x="${n.labelX}" y="${n.y+(cluster?5:-10)}" font-size="12">${esc(n.label.length>32?n.label.slice(0,31)+'…':n.label)}</text></g>`;
  }
  if(options.legend!==false)body+=`<text x="${l.left}" y="${l.height-8}" font-size="11">● repère · trait : durée · zone : précision partielle · tirets : qualification · flèche : intervalle ouvert</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" height="${l.height}" role="img" aria-label="Échelle temporelle : ${esc(timeline.title)}">${body}</svg>`;
 }
 return {nice,ticks,layout,svg};
})();
