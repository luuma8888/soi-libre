"""Pilotage Chromium local par CDP ; aucun outil n'est intégré à l'application."""
import asyncio
import base64
import json
import pathlib
import subprocess
import tempfile
import urllib.request

import websockets

ROOT = pathlib.Path(__file__).resolve().parents[1]


class Browser:
    async def __aenter__(self):
        self.profile = tempfile.TemporaryDirectory(prefix='chronea-browser-')
        self.log = open(pathlib.Path(self.profile.name) / 'chrome.log', 'w')
        self.proc = subprocess.Popen([
            'chromium', '--headless', '--no-sandbox', '--password-store=basic',
            '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking',
            '--remote-debugging-port=0', '--user-data-dir=' + self.profile.name,
            'about:blank'], stdout=self.log, stderr=self.log)
        port_file = pathlib.Path(self.profile.name) / 'DevToolsActivePort'
        for _ in range(100):
            if port_file.exists():
                break
            await asyncio.sleep(.1)
        port = port_file.read_text().splitlines()[0]
        with urllib.request.urlopen('http://127.0.0.1:' + port + '/json') as response:
            target = next(t for t in json.load(response) if t['type'] == 'page')
        self.ws = await websockets.connect(target['webSocketDebuggerUrl'], max_size=40 * 1024 * 1024)
        self.counter = 0
        self.events = []
        await self.call('Page.enable')
        await self.call('Runtime.enable')
        await self.call('Network.enable')
        return self

    async def __aexit__(self, *_):
        try:
            await self.call('Browser.close')
        except websockets.exceptions.ConnectionClosed:
            pass
        await self.ws.close()
        self.proc.wait(timeout=10)
        self.log.close()
        # Chromium peut terminer une écriture de profil après la fermeture du CDP.
        for attempt in range(5):
            try:
                self.profile.cleanup()
                break
            except OSError:
                if attempt == 4:
                    raise
                await asyncio.sleep(.1)

    async def call(self, method, **params):
        self.counter += 1
        message_id = self.counter
        await self.ws.send(json.dumps({'id': message_id, 'method': method, 'params': params}))
        while True:
            result = json.loads(await asyncio.wait_for(self.ws.recv(), 30))
            if result.get('id') == message_id:
                if 'error' in result:
                    raise RuntimeError(result['error'])
                return result.get('result', {})
            self.events.append(result)

    async def evaluate(self, expression):
        if 'await ' in expression:
            expression = '(async()=>{' + expression + '})()'
        result = await self.call('Runtime.evaluate', expression=expression,
                                 returnByValue=True, awaitPromise=True)
        if result.get('exceptionDetails'):
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    async def open(self, path):
        await self.call('Page.navigate', url=pathlib.Path(path).resolve().as_uri())
        for _ in range(100):
            await asyncio.sleep(.05)
            if await self.evaluate("document.readyState === 'complete' && !!document.querySelector('#canvasInner')"):
                return
        raise RuntimeError('Application non chargée')

    async def screenshot(self, path):
        result = await self.call('Page.captureScreenshot', format='png')
        pathlib.Path(path).write_bytes(base64.b64decode(result['data']))


async def baseline():
    async with Browser() as browser:
        original = ROOT / 'backup/chronea/chronea-v2-original.html'
        application = original if original.exists() else ROOT / 'creations/chronea.html'
        await browser.open(application)
        await browser.evaluate("document.querySelector('[data-empty-demo]').click()")
        report = {'version': '2', 'file': str(application.relative_to(ROOT)), 'sizes': []}
        for width, height in [(1440, 1000), (768, 1000), (390, 844)]:
            await browser.call('Emulation.setDeviceMetricsOverride', width=width, height=height,
                               deviceScaleFactor=1, mobile=False)
            await browser.screenshot('/tmp/chronea-baseline-' + str(width) + '.png')
            report['sizes'].append(await browser.evaluate("({width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth, events:document.querySelectorAll('.event-card').length})"))
        report['views'] = await browser.evaluate("['vertical','horizontal','list','gallery','table'].map(view=>{document.querySelector('[data-view='+view+']').click();return {view,text:document.querySelector('#canvasInner').textContent.length}})")
        await browser.evaluate("document.querySelector('[data-view=vertical]').click();document.querySelector('#addEventBtn').click();document.querySelector('#eventTitle').value='Date impossible';document.querySelector('#startYear').value=2024;document.querySelector('#startMonth').value=2;document.querySelector('#startDay').value=31;document.querySelector('#saveEventBtn').click()")
        report['invalidDateAccepted'] = await browser.evaluate("JSON.parse(localStorage.getItem('chronea.state.v2')).timelines[0].events.some(e=>e.title==='Date impossible')")
        report['errors'] = [e for e in browser.events if e.get('method') == 'Runtime.exceptionThrown']
        (ROOT / 'tests/chronea/baseline.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(baseline())
