"""Validation des phases V3 ; utilise le Chromium local comme moteur JS."""
import asyncio
import json
import sys
from chronea_browser import Browser, ROOT

async def run():
    async with Browser() as browser:
        await browser.open(ROOT / "creations/chronea.html")
        await asyncio.sleep(.6)
        schema='const CHRONEA_SCHEMA='+json.dumps(json.loads((ROOT/'src/chronea/schema-v3.json').read_text()))+';\n'
        fixtures='const CHRONEA_FIXTURES='+json.dumps({path.name:json.loads(path.read_text()) for path in (ROOT/'tests/chronea/fixtures').glob('project-v*.json')},ensure_ascii=False)+';\n'
        source=fixtures+schema+'\n'.join((ROOT/'src/chronea'/name).read_text() for name in ['core.js','time.js','project.js','storage.js','scale.js','adapters.js'])
        suites=[]
        for filename in ['core-tests.js','v3-tests.js','storage-tests.js','adapter-tests.js','fixtures-tests.js']:
            tests=(ROOT/'tests/chronea'/filename).read_text()
            result=await browser.call('Runtime.evaluate',expression='(()=>{'+source+'\nreturn (\n'+tests+'\n);})()',returnByValue=True,awaitPromise=True)
            if result.get('exceptionDetails'): raise RuntimeError(result['exceptionDetails'])
            suites.extend(result['result']['value'])
        for test in suites:
            print(('PASS ' if test['ok'] else 'FAIL ')+test['name']+(' : '+test.get('error','') if not test['ok'] else ''))
        (ROOT/'tests/chronea/core-results.json').write_text(json.dumps(suites,ensure_ascii=False,indent=2)+'\n')
        print(str(len(suites))+' tests ; '+str(sum(not t['ok'] for t in suites))+' échec(s).')
        return any(not t['ok'] for t in suites)

if __name__=='__main__':
    sys.exit(asyncio.run(run()))
