"""Point d'entrée : tests métier, parcours UI et recette du HTML autonome."""
import hashlib,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
    subprocess.run([sys.executable,str(ROOT/'scripts/build-chronea.py')],cwd=ROOT,check=True)
    for filename in ['test-chronea-v3.py','test-chronea-ui.py','check-chronea-final.py','test-chronea-ux.py']:
        result=subprocess.run([sys.executable,str(ROOT/'scripts'/filename)],cwd=ROOT)
        if result.returncode:return result.returncode
    unit=json.loads((ROOT/'tests/chronea/core-results.json').read_text())
    browser=json.loads((ROOT/'tests/chronea/ui-results.json').read_text())
    final=json.loads((ROOT/'tests/chronea/final-results.json').read_text())
    html=(ROOT/'creations/chronea.html').read_bytes()
    assert html==(ROOT/'dist/chronea.html').read_bytes()
    ux=json.loads((ROOT/'tests/chronea/ux-lot-10-results.json').read_text())
    report={'version':'3.1.0','unit':unit,'browser':browser,'acceptance':final,'ux':ux,
            'total':len(unit)+len(browser)+len(final['checks'])+len(ux['checks']),
            'failed':sum(not row['ok'] for row in unit+browser+final['checks']+ux['checks']),
            'sha256':hashlib.sha256(html).hexdigest(),'bytes':len(html)}
    (ROOT/'tests/chronea/results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(str(report['total'])+' vérifications ; '+str(report['failed'])+' échec(s). SHA-256 : '+report['sha256'])
    return bool(report['failed'])

if __name__=='__main__':sys.exit(main())
