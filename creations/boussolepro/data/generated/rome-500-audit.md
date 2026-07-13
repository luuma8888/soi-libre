# Audit Boussole Pro - ROME 500

Généré le 2026-07-13T12:19:31.443Z.

## Synthèse

- Métiers demandés : 3
- Métiers récupérés : 3
- Échecs : 0
- Coquilles code + titre : 0/3
- Score de préparation matching : 60%

## Données réellement reliées aux métiers

- Mappings compétences : 3/3
- Mappings contextes : 0/3
- Mappings appellations : 0/3
- Mappings savoirs : 3/3
- Activités : 0/3
- Descriptions officielles : 0/3

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- description : 3
- activities : 3
- workContexts : 3
- accessConditions : 3
- requiredDiplomaLevel : 3
- recommendedDiplomaLevel : 3
- market : 3
- appellations : 3
- relatedJobs : 3

## Marché officiel

- France : 3/3, zéros 7, absents 0
- Occitanie : 3/3, zéros 48, absents 0
- Aude : 3/3, zéros 145, absents 0
- Codes sans statistique nationale : 0

## Domaines et secteurs

- Domaine officiel estimable depuis code ROME : 3/3
- Secteur Boussole explicite : 3/3
- Fallback générique : 0/3

## Référentiel brut compétences

- Entrées brutes : 35595
- Doublons d'identifiants : 0
- Identifiants manquants : 0
- Checksum : `9bb7f23b7adef835fc19cc6dbee6e3278559360fa315793b62b77ae3a9ef3a60`

## Taille et performance

- Taille totale générée : 26.36 Mo
- Nombre de fichiers : 38
- Plus gros fichiers : rome-raw-skills.json (14.73 Mo), knowledge.rome.json (4.7 Mo), market/market-national.rome.json (1.76 Mo), market/market-occitanie.rome.json (1.69 Mo), market/market-aude.rome.json (1.44 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- Aucun contexte officiel n'est relié aux métiers : les contraintes doivent rester neutres ou faiblement pondérées.
