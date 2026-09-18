# Recette de Chronéa 3.0

## Commande complète

```sh
python3 scripts/test-chronea.py
```

Le script reconstruit les deux HTML, exécute les suites puis produit `tests/chronea/results.json`, avec version, total, échecs, taille et SHA-256 du fichier livré. Chromium est lancé avec `--password-store=basic`. Les profils de navigateur et copies instrumentées sont temporaires ; aucune donnée du navigateur habituel n’est modifiée.

Exécutions ciblées :

```sh
python3 scripts/test-chronea-v3.py
python3 scripts/test-chronea-ui.py
python3 scripts/check-chronea-final.py
```

## Couverture

- Noyau et adaptateurs : calendrier, dates impossibles, périodes, EDTF, numérique, schéma, migrations, références, CSV, ICS, UID, TZID, JSCalendar, fusion et fixtures.
- Stockage réel : IndexedDB, Blobs, instantanés, repli localStorage, archives ZIP, CRC, chemins dangereux, médias manquants et aller-retour natif.
- Interface : saisies avancées, calendriers fictifs guidés, périodes de fond, focus, édition directe, tags groupés, duplication, suppression, undo/redo, graphe, imports, fidélité, SVG/PNG, TeX et champs de publication.
- Conservation : légendes de médias lors d’un retrait/réouverture ; IDs, notes et direction des relations lors d’une édition, avec plus de 500 liens.
- Recette : navigateur offline, nuit, autosauvegarde, rechargement, téléchargements réels JSON/paquet et neuf formats d’échange/rapport, récupération d’un cache corrompu et zéro exception/réseau.
- Responsive : 1440×1000, 768×1000, 390×844, sur Récit, Échelle, Données et Relations, avec captures PNG.
- Impression : PDF chronologie et projet via CDP, textes contrôlés par `pdftotext`, images/vectoriel et CSS dédiés.
- Charge : 500, 1 500, 5 000, 10 000 événements ; validation, trois vues, recherche, filtre, pan, zoom, sauvegarde, relecture, taille JSON et éléments DOM.

Fixtures : `project-v1.json`, `project-v2.json`, `project-v3.json`, `numeric.csv`, `timed.ics`. V3 comporte dates partielles, possibilités, calendrier fictif, axe décroissant, fil, source, relation, période de fond et Blob textuel.

## Preuves et limites

Les JSON de résultats sont persistés et les captures/PDF se trouvent dans `tests/chronea/artifacts/`. La baseline V2 et le rapport 2.1 sont conservés. Les durées de charge dépendent de la machine et ne constituent pas un engagement universel. La mémoire exposée par Chromium peut être arrondie : la taille JSON est une mesure reproductible ; le heap n’est pas un audit précis de mémoire.

L’API fichier directe est vérifiée avec un substitut de picker/writable et un paquet relu. La boîte de sélection native et les refus propres à d’autres navigateurs exigent une vérification manuelle. Le fallback JSON reste disponible. TeX est contrôlé comme texte, sans compilation LaTeX. Aucun lecteur d’écran réel ni audit WCAG complet n’a été effectué.

## Dernière relecture manuelle conseillée

Sur le navigateur habituel, ouvrir le HTML et un ancien export, ajouter un souvenir avec photo, enregistrer une copie fichier, recharger, restaurer cette copie et imprimer en A4/A3. Vérifier également la navigation clavier et le confort à 200 % de zoom. Cette relecture complète les tests automatisés ; elle ne remplace pas leurs résultats.
