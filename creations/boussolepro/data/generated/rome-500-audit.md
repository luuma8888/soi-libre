# Audit Boussole Pro - corpus ROME

Généré le 2026-07-13T15:16:12.618Z.

## Synthèse

- Métiers demandés : 72
- Métiers récupérés : 72
- Échecs : 0
- Coquilles code + titre : 0/72
- Score de préparation matching : 60%

## Données réellement reliées aux métiers

- Mappings compétences : 72/72
- Mappings contextes : 0/72
- Mappings appellations : 0/72
- Mappings savoirs : 72/72
- Activités : 0/72
- Descriptions officielles : 0/72

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- description : 72
- activities : 72
- workContexts : 72
- accessConditions : 72
- requiredDiplomaLevel : 72
- recommendedDiplomaLevel : 72
- market : 72
- appellations : 72
- relatedJobs : 72

## Marché officiel

- France : 63/72, zéros 7, absents 9
- Occitanie : 63/72, zéros 48, absents 9
- Aude : 63/72, zéros 145, absents 9
- Codes sans statistique nationale : 9

## Domaines et secteurs

- Domaine officiel estimable depuis code ROME : 72/72
- Secteur Boussole explicite : 72/72
- Fallback générique : 0/72

## Référentiel brut compétences

- Entrées brutes : 35595
- Doublons d'identifiants : 0
- Identifiants manquants : 0
- Checksum : `81987e003329a52a8558eb15ce6aa5f9acaf072344235f0adf040dc275eba534`

## Taille et performance

- Taille totale générée : 37.22 Mo
- Nombre de fichiers : 42
- Plus gros fichiers : rome-raw-skills.json (20.97 Mo), knowledge.rome.json (5.13 Mo), jobs.rome.json (2.1 Mo), market/market-national.rome.json (1.76 Mo), market/market-occitanie.rome.json (1.69 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- Aucun contexte officiel n'est relié aux métiers : les contraintes doivent rester neutres ou faiblement pondérées.
- 9 code(s) n'ont pas de ligne marché nationale dans le lot actuel.
