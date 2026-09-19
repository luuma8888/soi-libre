"""Gates UX : s'arrêter au premier lot en échec, sans modifier le navigateur habituel."""
import asyncio, hashlib, json, pathlib, sys, tempfile
from chronea_browser import Browser, ROOT

async def run():
    limit = int(sys.argv[1]) if len(sys.argv)>1 else 10
    html = (ROOT/'creations/chronea.html').read_text()
    results = []
    async with Browser() as browser:
        with tempfile.TemporaryDirectory(prefix='chronea-ux-') as directory:
            path = pathlib.Path(directory)/'test.html'
            path.write_text(html.replace('App.init();','window.__test=App;window.confirm=()=>true;App.init();'))
            await browser.open(path)
            await asyncio.sleep(.8)
            for file in sorted((ROOT/'tests/chronea').glob('ux-*-tests.js')):
                lot = int(file.name.split('-')[1])
                if lot>limit: break
                response = await browser.call('Runtime.evaluate',expression=file.read_text(),returnByValue=True,awaitPromise=True)
                if response.get('exceptionDetails'): raise RuntimeError(response['exceptionDetails'])
                rows = response['result']['value']
                results.extend(rows)
                for row in rows: print(('PASS ' if row['ok'] else 'FAIL ')+row['name']+' '+row.get('error',''))
                if any(not row['ok'] for row in rows): break
            errors = [e for e in browser.events if e['method']=='Runtime.exceptionThrown']
            results.append({'name':'Console sans exception','ok':not errors,'errors':errors})
    report = {'throughLot':limit,'sha256':hashlib.sha256(html.encode()).hexdigest(),'checks':results,'failed':sum(not r['ok'] for r in results)}
    (ROOT/f'tests/chronea/ux-lot-{limit:02}-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(f"{len(results)} contrôles ; {report['failed']} échec(s).")
    return bool(report['failed'])

if __name__=='__main__': sys.exit(asyncio.run(run()))
