"""Construit deux copies identiques du HTML autonome, sans dépendance de build."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/chronea'
template = (SOURCE / 'index.html').read_text()
schema = 'const CHRONEA_SCHEMA=' + json.dumps(json.loads((SOURCE / 'schema-v3.json').read_text()), ensure_ascii=False) + ';\n'
scripts = schema + '\n'.join((SOURCE / name).read_text() for name in ['core.js', 'time.js', 'project.js', 'storage.js', 'scale.js', 'graph.js', 'adapters.js', 'publication.js', 'temporal-editor.js', 'app.js'])
assert '</script' not in scripts.lower(), 'Une fermeture de script doit être échappée dans le JS.'
assert template.count('<!-- CHRONEA_SCRIPTS -->') == 1
result = template.replace('<!-- CHRONEA_SCRIPTS -->', '<script>\n' + scripts + '\n</script>')
for path in [ROOT / 'creations/chronea.html', ROOT / 'dist/chronea.html']:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(result)
    print(str(path.relative_to(ROOT)) + ' : ' + str(len(result.encode())) + ' octets')
