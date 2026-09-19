"""Recette offline, téléchargements, PDF, récupération et mesures de charge."""
import asyncio,base64,json,pathlib,tempfile,sys,platform,subprocess
from chronea_browser import Browser,ROOT
async def run():
 report={'version':'3.1.0','checks':[],'sizes':[],'performance':[],'environment':{'platform':platform.platform(),'chromium':subprocess.check_output(['chromium','--version'],text=True).strip()}}
 with tempfile.TemporaryDirectory(prefix='chronea-final-') as temporary:
  work=pathlib.Path(temporary);path=work/'chronea.html';path.write_text((ROOT/'creations/chronea.html').read_text().replace('App.init();','window.__test=App;window.confirm=()=>true;App.init();'))
  downloads=work/'downloads';downloads.mkdir()
  async with Browser() as b:
   await b.call('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(downloads),eventsEnabled=True)
   await b.call('Network.emulateNetworkConditions',offline=True,latency=0,downloadThroughput=0,uploadThroughput=0)
   await b.open(path);await asyncio.sleep(.7)
   async def check(name,expression):
    try:ok=bool(await b.evaluate(expression));row={'name':name,'ok':ok}
    except Exception as error:row={'name':name,'ok':False,'error':str(error)}
    report['checks'].append(row);print(('PASS ' if row['ok'] else 'FAIL ')+name,flush=True)
   await check('Démarrage offline',"!document.querySelector('#addEventBtn').disabled && !__test.blocked")
   await b.evaluate('__test.loadDemo()')
   await check('Mode nuit',"(()=>{__test.prefs.theme='night';__test.render();return document.documentElement.dataset.theme==='night'})()")
   await check('Sauvegarde et cache IndexedDB',"return await __test.flushSave();")
   before=await b.evaluate('JSON.stringify(__test.project)')
   await b.call('Page.reload');await asyncio.sleep(.8)
   await check('Rechargement conserve les données', 'JSON.stringify(__test.project)==='+json.dumps(before))
   await check('Préférences du mode nuit conservées',"__test.prefs.theme==='night'")
   await check('Saisie sans perte de focus pendant autosauvegarde',"__test.openEditor();document.querySelector('#eventTitle').focus();document.querySelector('#eventTitle').value='Écriture continue';await __test.flushSave();const ok=document.activeElement.id==='eventTitle'&&document.querySelector('#eventTitle').value==='Écriture continue';__test.closeEditor();return ok;")
   await check('Focus restitué et fermeture clavier',"(()=>{document.querySelector('#addEventBtn').focus();__test.openEditor();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return document.activeElement.id==='addEventBtn'&&!document.querySelector('#eventDrawer').classList.contains('open')})()")
   # JSON projet et paquet réellement téléchargés.
   await b.evaluate('await __test.exportProject();await __test.exportProject(true);return true;');await asyncio.sleep(.5)
   files=list(downloads.iterdir());native=next((f for f in files if f.name.endswith('.chronea.json')),None);package=next((f for f in files if f.name.endswith('.chronea')),None)
   report['checks'].append({'name':'Téléchargements JSON et paquet réels','ok':bool(native and package),'files':[f.name for f in files]})
   if native:
    await check('Réimport natif restaure le projet',"const result=await ChroneaStorage.readJSON("+native.read_text()+");return __test.applyImport(result,'replace') && JSON.stringify(__test.project.timelines)===JSON.stringify(result.project.timelines);")
   # Tous les boutons d'export, avec validation de la matrice si présentée.
   for kind in ['csv','ics','preceden','timelinejs','jscalendar','jsonld','md','html','tex']:
    await b.evaluate("document.querySelector('[data-export="+kind+"]').click()")
    await asyncio.sleep(.05)
    await b.evaluate("(()=>{const d=document.querySelector('#fidelityDialog');if(d.open)document.querySelector('#fidelityApply').click();return true})()")
    await asyncio.sleep(.15)
   report['checks'].append({'name':'Tous les formats exportent un fichier','ok':len(list(downloads.iterdir()))>=11,'files':[f.name for f in downloads.iterdir()]})
   __screens=ROOT/'tests/chronea/artifacts';__screens.mkdir(exist_ok=True)
   for width,height in [(1440,1000),(768,1000),(390,844)]:
    await b.call('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=width==390)
    for view in ['vertical','horizontal','table','relations']:
     await b.evaluate("__test.prefs.theme='parchment';__test.prefs.view="+json.dumps(view)+";__test.render()")
     metrics=await b.evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,addVisible:document.querySelector('#addEventBtn').getBoundingClientRect().right<=innerWidth,viewVisible:document.querySelector('#viewSeg').getBoundingClientRect().right<=innerWidth})")
     report['sizes'].append({'width':width,'height':height,'view':view,**metrics})
     await b.screenshot(__screens/f'{view}-{width}.png')
    if width in (1440,390):
     await b.evaluate("__test.openEditor();document.querySelector('#eventTitle').value='Été 2012 — maison bleue';document.querySelector('#startYear').value='2012'")
     await b.screenshot(__screens/f'editor-{width}.png')
     await b.evaluate("__test.closeEditor();__test.openProjectTime()")
     await b.screenshot(__screens/f'project-time-{width}.png')
     await b.evaluate("document.querySelector('#projectTimeDialog').close()")
   report['checks'].append({'name':'Navigation responsive sans débordement global','ok':all(row['scrollWidth']<=row['width'] and row['addVisible'] and row['viewVisible'] for row in report['sizes'])})
   await b.call('Emulation.setDeviceMetricsOverride',width=1440,height=1000,deviceScaleFactor=1,mobile=False)
   await b.evaluate("__test.commit(p=>{const t=ChroneaProject.timeline('Seconde chronologie');t.events.push(ChroneaProject.event('Repère du second fil',{kind:'point',start:{value:{year:2020},precision:'year',qualifier:'exact'},end:null}));p.timelines.push(t)});__test.prefs.view='vertical';__test.render();window.print=()=>{}")
   for all_flag,label in [('false','current'),('true','all')]:
    await b.evaluate('await __test.printPublication('+all_flag+');return true;')
    pdf=await b.call('Page.printToPDF',printBackground=True,preferCSSPageSize=True)
    pdfpath=__screens/f'publication-{label}.pdf';pdfpath.write_bytes(base64.b64decode(pdf['data']))
    text=subprocess.check_output(['pdftotext',str(pdfpath),'-'],text=True)
    report['checks'].append({'name':'PDF '+label+' lisible','ok':'Première traversée' in text and (label!='all' or 'Repère du second fil' in text),'bytes':pdfpath.stat().st_size})
    await b.evaluate("document.body.classList.remove('publication-print');document.querySelector('#publicationPrint').innerHTML=''")
   # Charge synthétique, mêmes systèmes et données reproductibles, pas de seuil matériel rigide.
   for count in [500,1500,5000,10000]:
    expression="""const A=__test,P=ChroneaProject,p=P.create('Charge'),t=p.timelines[0];t.lanes=Array.from({length:4},(_,i)=>({id:P.id(),name:'Fil '+i,order:i,visible:true,color:'#718b78'}));t.events=Array.from({length:COUNT},(_,i)=>{const e=P.event('Repère '+i,{kind:'point',start:{value:{year:1800+i%225,month:1+i%12,day:1+i%27},precision:'day',qualifier:i%7?'exact':'approximate'},end:null});e.laneId=t.lanes[i%4].id;e.tags=['tag'+i%8];e.summary='Observation de charge '+i;return e});const measure=fn=>{const start=performance.now();fn();return Number((performance.now()-start).toFixed(2))};const result={count:COUNT,validate:measure(()=>P.validate(p))};A.project=p;A.assets=new Map();A.currentId=t.id;A.prefs.scaleCamera=null;A.prefs.search='';A.prefs.group='';A.rangeCache=new WeakMap();for(const view of ['vertical','horizontal','table']){A.prefs.view=view;result[view]=measure(()=>A.render());result[view+'DOM']=document.querySelectorAll('#canvasInner *').length;}A.prefs.view='horizontal';A.prefs.search='Repère 12';result.search=measure(()=>A.render());A.prefs.search='';A.prefs.group=t.lanes[0].id;result.filter=measure(()=>A.render());A.prefs.group='';result.pan=measure(()=>{const d=A.prefs.scaleCamera||{min:ChroneaTime.civilDay(1800),max:ChroneaTime.civilDay(2025)};A.prefs.scaleCamera={min:d.min+365,max:d.max+365};A.render()});result.zoom=measure(()=>A.zoomAt(2,.4));const start=performance.now();await A.flushSave();result.save=Number((performance.now()-start).toFixed(2));const loadStart=performance.now();await A.store.load(p.id);result.load=Number((performance.now()-loadStart).toFixed(2));result.jsonBytes=new TextEncoder().encode(JSON.stringify(p)).length;result.heapApprox=performance.memory?performance.memory.usedJSHeapSize:null;return result;""".replace('COUNT',str(count))
    row=await b.evaluate(expression);report['performance'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
   # Préserver un original corrompu et proposer récupération, sans écrasement.
   await b.evaluate("await __test.flushSave();const id=__test.project.id,store=__test.store,tx=store.db.transaction('projects','readwrite');const corrupt=ChroneaProject.clone(__test.project);corrupt.timelines[0].events[0].temporal.start.value.day=32;tx.objectStore('projects').put({key:id,project:corrupt});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});return true;")
   await b.call('Page.reload')
   for _ in range(100):
    await asyncio.sleep(.05)
    if await b.evaluate("!!document.querySelector('#recoveryDialog')?.open"):break
   await check('Cache corrompu : récupération et original préservé',"__test.blocked && __test.recoveryRaw.includes('\"day\":32') && document.querySelector('#recoveryDialog').open")
   await check('Cache corrompu : autosauvegarde bloquée',"return await __test.flushSave()===false;")
   exceptions=[e for e in b.events if e['method']=='Runtime.exceptionThrown'];report['checks'].append({'name':'Aucune exception console','ok':not exceptions,'exceptions':exceptions})
   network=[e['params']['request']['url'] for e in b.events if e['method']=='Network.requestWillBeSent' and e['params']['request']['url'].startswith(('http:','https:'))];report['checks'].append({'name':'Aucune requête réseau applicative','ok':not network,'urls':network})
 (ROOT/'tests/chronea/final-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 failed=[r for r in report['checks'] if not r['ok']]
 print(str(len(report['checks']))+' vérifications finales ; '+str(len(failed))+' échec(s).')
 for row in failed:print(json.dumps(row,ensure_ascii=False))
 return bool(failed)
if __name__=='__main__':sys.exit(asyncio.run(run()))
