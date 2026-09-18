"""Tests fonctionnels Chromium ; le pont App est uniquement injecté dans une copie temporaire."""
import asyncio,json,sys,tempfile,pathlib
from chronea_browser import Browser,ROOT
async def run():
 with tempfile.TemporaryDirectory(prefix='chronea-ui-') as directory:
  path=pathlib.Path(directory)/'test.html'
  path.write_text((ROOT/'creations/chronea.html').read_text().replace('App.init();','window.__test=App;window.confirm=()=>true;App.init();'))
  async with Browser() as browser:
   await browser.open(path)
   await asyncio.sleep(.7)
   suites=[]
   for file in sorted((ROOT/'tests/chronea').glob('ui-*-tests.js')):
    result=await browser.call('Runtime.evaluate',expression=file.read_text(),returnByValue=True,awaitPromise=True)
    if result.get('exceptionDetails'):raise RuntimeError(result['exceptionDetails'])
    suites.extend(result['result']['value'])
   for test in suites: print(('PASS ' if test['ok'] else 'FAIL ')+test['name']+(' : '+test.get('error','') if not test['ok'] else ''))
   exceptions=[e for e in browser.events if e['method']=='Runtime.exceptionThrown']
   suites.append({'name':'Aucune erreur console Chromium','ok':not exceptions,'errors':exceptions})
   (ROOT/'tests/chronea/ui-results.json').write_text(json.dumps(suites,ensure_ascii=False,indent=2)+'\n')
   print(str(len(suites))+' tests ; '+str(sum(not t['ok'] for t in suites))+' échec(s).')
   return any(not t['ok'] for t in suites)
if __name__=='__main__':sys.exit(asyncio.run(run()))
