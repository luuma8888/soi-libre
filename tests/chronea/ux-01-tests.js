(async()=>{
const A=__test,P=ChroneaProject,$=s=>document.querySelector(s),rows=[],assert=(x,m='Assertion')=>{if(!x)throw Error(m)},test=async(name,fn)=>{try{await fn();rows.push({name:'Lot 1 : '+name,ok:true})}catch(e){rows.push({name:'Lot 1 : '+name,ok:false,error:String(e)})}};
A.project=P.create('Zoom');A.currentId=A.project.timelines[0].id;A.prefs.search='';A.prefs.group='';A.prefs.rangeFilter=null;A.prefs.scaleCamera=null;A.prefs.view='horizontal';A.loadDemo();
await test('molette synchronise le slider',()=>{const full=A.getFullDomain();$('.scale-wrap').dispatchEvent(new WheelEvent('wheel',{deltaY:-346.57359028,clientX:400,bubbles:true,cancelable:true}));assert(Math.abs(A.getScaleZoomRatio()-2)<1e-8);assert(Math.abs(Number($('#zoomInput').value)-1)<.001);assert(A.getScaleCamera().max-A.getScaleCamera().min<(full.max-full.min))});
await test('slider utilise le zoom réel après molette',()=>{$('#zoomInput').value=2;$('#zoomInput').dispatchEvent(new Event('input'));assert(Math.abs(A.getScaleZoomRatio()-4)<1e-8)});
await test('minimap déplace sans changer le niveau',()=>{const ratio=A.getScaleZoomRatio(),before=A.getScaleCamera().min,el=$('.scale-overview'),rect=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('click',{clientX:rect.left+rect.width*.8,bubbles:true}));assert(Math.abs(ratio-A.getScaleZoomRatio())<1e-8&&before!==A.getScaleCamera().min)});
await test('pan conserve le niveau',()=>{const ratio=A.getScaleZoomRatio();$('#panPrev').click();assert(Math.abs(ratio-A.getScaleZoomRatio())<1e-8)});
await test('zoom ne filtre aucune autre vue',()=>{A.zoomScaleAt(10);for(const view of ['vertical','list','gallery','table','relations']){A.prefs.view=view;A.render();assert(A.filteredEvents().length===4,view)}});
await test('De/À filtre sans changer la caméra',()=>{const before=JSON.stringify(A.prefs.scaleCamera);$('#rangeFrom').value='2016';$('#rangeTo').value='2021';A.changeRange();assert(A.filteredEvents().length===2);assert(JSON.stringify(A.prefs.scaleCamera)===before);$('#rangeReset').click();assert(A.filteredEvents().length===4)});
await test('Tout voir restaure 1×',()=>{A.prefs.view='horizontal';A.render();$('#scaleReset').click();assert(A.prefs.scaleCamera===null&&A.getScaleZoomRatio()===1&&Number($('#zoomInput').value)===0)});
await test('boutons mobile utilisent la caméra commune',()=>{$('#zoomPlus').click();assert(A.getScaleZoomRatio()===2);$('#zoomMinus').click();assert(A.getScaleZoomRatio()===1);assert(!('zoom' in A.prefs)&&!('camera' in A.prefs));assert(!$('.zoom').hidden)});
A.resetScaleCamera();return rows;
})()
