# Rapport Chronéa 2.1 — 18 septembre 2026

## Résultat du premier lot du plan maître

Phases 0 et 1 réalisées : reconnaissance, baseline V2, harnais, fonctions métier testables et lot **Fiabilité**. Le format reste `schemaVersion: 2`, avec `appVersion: "2.1.0"`. Le schéma V3 et les phases 2–8 du plan ne sont pas présentés comme réalisés.

Fichiers principaux :

- `creations/chronea.html` : application existante améliorée ;
- `dist/chronea.html` : copie autonome identique, 124 836 octets ;
- `src/chronea/{index.html,core.js,app.js}` : sources maintenues ;
- `scripts/{build-chronea.py,chronea_browser.py,test-chronea.py}` : construction et tests ;
- `tests/chronea/` : baseline, tests, fixtures et résultats ;
- `docs/chronea/` : usage, architecture V2, interopérabilité, vérification et présent rapport ;
- `backup/chronea/chronea-v2-original.html` : version originale conservée.

Les deux HTML livrés ont la même empreinte SHA-256 :

```text
4da9414e0827ea967132e928c586d81e16204ca95a0eb60fe37d8943b2ef6051
```

## Corrections vérifiées

- Refus des dates civiles impossibles et des intervalles inversés avant mutation. Le calcul graphique ne répare plus silencieusement les jours invalides.
- Dates partielles conservées, dont année seule, mois/année et composants inconnus. EDTF reste dérivé.
- Autosauvegarde différée, préférences séparées, trois instantanés précédents maximum, statut visible sur mobile. La recherche garde le focus et ne réécrit pas le projet.
- Stockage corrompu conservé tel quel, écran de récupération, export brut et restauration après archivage explicite. Quota saturé simulé : la sauvegarde précédente n’est pas remplacée.
- Imports transactionnels : validation de toutes les chronologies, aperçu, annulation et choix de destination. Une deuxième chronologie invalide ne provoque aucune mutation partielle.
- CSV : séparateurs virgule/point-virgule/tabulation, BOM UTF-8, champs cités et multilignes, modes et unités distincts, IDs et résolution des relations. « cycle 12 » reste numérique.
- iCalendar : DATE versus DATE-TIME, fin exclusive uniquement pour les journées complètes, horaires, UID, UTC/TZID connus, horaires flottants, RELATED-TO directionnels, textes échappés et repli UTF-8 de 75 octets.
- Médias importés validés ; médias locaux servis par Blob URL ; médias distants conservés comme liens, sans requête automatique. HTML TimelineJS converti en texte inerte ; libellé d’affichage conservé.
- Éditeur modal avec fond inert, piège de focus, fermeture Escape et restauration du focus. Vrais boutons dans la vue Texte, sélecteurs de vue nommés avec `aria-pressed`, légendes et focus visibles.
- Impression des cinq vues, titre de chronologie et texte lisible en palette Nuit. Publication HTML sans URL Blob périmée.

## Preuves et commandes

```sh
python3 scripts/build-chronea.py
python3 scripts/test-chronea.py
git diff --check
pdftotext /tmp/chronea-2.1-impression.pdf -
```

Dernier passage complet : **42 tests du noyau + 42 tests navigateur, 84 réussis, 0 échec**. Résultats détaillés : `tests/chronea/results.json`. Chromium 150.0.7871.100 sur Debian 13, avec `--password-store=basic`, profil jetable, ouverture réelle `file://` et réseau de la page désactivé.

Responsive vérifié à 1440×1000, 768×1000, 390×844, sans débordement global. Captures inspectées sur bureau et mobile. Les cinq vues produisent un PDF ; le texte du PDF Récit a été relu via `pdftotext`.

Les dix formats proposés ont déclenché dix téléchargements réels. Le projet JSON téléchargé est réimportable avec la pièce jointe ; le round-trip natif couvre aussi relations et médias PDF. Fixtures V1/V2, CSV numérique et ICS horaire vérifiées. Round-trips sémantiques CSV et ICS automatisés.

Aucune exception JavaScript ni requête HTTP(S) externe relevée pendant les parcours. L’artefact final non instrumenté a aussi été ouvert. Vérification statique : un seul script intégré, aucun script/lien/iframe réseau, aucun appel `fetch`, `XMLHttpRequest` ou `WebSocket` dans l’application. Aucune clé API ni secret ajouté.

## Compatibilité et limites réelles

Les projets V1/V2 valides sont récupérables et migrés sans modification de leur source. Des anciennes données invalides ne sont pas rendues « valides » artificiellement : l’application préserve leur contenu brut et propose la récupération. SVG/HTML actifs et médias au MIME incohérent sont refusés ; cela peut signaler des anciennes pièces jointes que V2 acceptait.

Les formats plus pauvres restent des passerelles, jamais des sauvegardes complètes. Les anciens CSV sans mode temporel sont ambigus : l’aperçu annonce l’interprétation calendaire. Le JSON natif est préférable pour récupérer un axe imaginaire ancien.

iCalendar ne gère pas encore les récurrences, DURATION ni les définitions de fuseaux personnalisées. Ils sont refusés explicitement ; les propriétés/alarmes omises sont signalées. Une ancienne importation horaire déjà falsifiée par V2 ne peut pas retrouver son horaire d’origine sans réimporter le fichier ICS source.

Le stockage local reste limité par le quota du navigateur, particulièrement avec les instantanés contenant des médias. IndexedDB, média-store, projets empaquetés, schéma V3, édition en masse, graphe et nouveau moteur d’échelle restent des étapes suivantes. Aucune mesure de performance à 5 000–10 000 événements n’est revendiquée.

Pas de certification WCAG ni test sur lecteur d’écran, Firefox/Safari ou imprimante physique. Les contrôles clavier principaux sont vérifiés dans Chromium. L’impression de toutes les chronologies réunies n’existe pas encore ; le bouton imprime la vue courante.

## Git et prochaine étape

Branche conservée : `soi-libre-codex`. Chronéa était initialement non suivie (`?? creations/chronea.html`) ; les nouvelles sources/livraisons/documents restent également non suivis jusqu’à ajout explicite par l’utilisateur. Les nombreuses modifications préexistantes étrangères à Chronéa ont été préservées. Aucun commit, push ni changement de branche.

Relire les sources et la comparaison entre la V2 préservée et `creations/chronea.html` avant un éventuel commit. La prochaine phase du plan est **Schema v3 — Fondations durables**, sur cette base de fiabilité validée.
