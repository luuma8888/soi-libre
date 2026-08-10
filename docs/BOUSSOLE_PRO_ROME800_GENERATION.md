# Boussole Pro - generation du corpus ROME800

## Objectif

Le workflow `Build ROME800 candidate` conserve le corpus ROME500 et récupère uniquement 300 fiches officielles supplémentaires. Il construit ensuite le paquet marché, l'identité runtime, les validations et une livraison hors ligne.

## Exécution

Le fichier du workflow doit d'abord être présent sur la branche par défaut afin d'apparaître dans GitHub Actions.

1. Ouvrir **Actions > Build ROME800 candidate**.
2. Choisir la branche `soi-libre-codex`.
3. Cliquer sur **Run workflow**. Aucun paramètre n'est requis.

Le workflow réutilise les secrets et variables France Travail déjà configurés. Aucun secret ne doit être saisi dans l'application, un fichier JSON ou un commentaire GitHub.

## Étapes réalisées

- récupération de l'univers ROME officiel ;
- sélection déterministe de 300 ajouts et de candidats de reprise ;
- récupération des fiches par trois lots de 100 ;
- remplacement audité d'une fiche non exploitable, si nécessaire ;
- fusion stricte avec les 500 métiers existants ;
- reconstruction des compétences, accès et contraintes ;
- extension des volumes France, Occitanie et Aude aux nouveaux codes ;
- reconstruction de l'enrichissement FAP/BMO/Dares pour 800 métiers ;
- validation du corpus, des 12 profils, de l'export compact et de la migration ;
- mesure navigateur froide et chaude ;
- calcul des empreintes SHA-256 et activation de `v0.8.1-alpha` ;
- création de l'artefact `boussole-pro-v0.8.1-alpha-rome800`.

## Reprise

Les sorties de chaque lot sont séparées dans `data/generated/rome800-candidate/batches`. Une relance du workflow reprend la même sélection déterministe et ne rappelle jamais les 500 métiers historiques. La fusion refuse toute livraison différente de 800 codes uniques.

## Vérifications attendues

- `jobs.rome.json` contient exactement 800 métiers ;
- `rome-codes-800-additions.json` contient exactement 300 ajouts ;
- `rome800-validation-report.json` et `rome800-functional-validation-report.json` passent ;
- `runtime-bundle-manifest.json` est `coherent` ;
- `market-fap-enrichment.rome800.json` contient 800 lignes ;
- l'application affiche `v0.8.1-alpha` et le build `20260810-rome800-market-continuity-01` ;
- l'artefact GitHub contient `manifest.sha256.json` et s'ouvre hors ligne.

Les données réelles ROME800 ne sont pas simulées localement : elles n'existent qu'après l'exécution réussie du workflow avec les accès France Travail configurés.
