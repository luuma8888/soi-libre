# Audit Boussole Pro - ROME 500

Généré le 2026-07-13T05:50:19.993Z.

## Synthèse

- Métiers demandés : 72
- Métiers récupérés : 72
- Échecs : 0
- Coquilles code + titre : 72/72
- Score de préparation matching : 20%

## Données réellement reliées aux métiers

- Mappings compétences : 0/72
- Mappings contextes : 0/72
- Mappings appellations : 0/72
- Mappings savoirs : 0/72
- Activités : 0/72
- Descriptions officielles : 0/72

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- description : 72
- activities : 72
- requiredSkills : 72
- workContexts : 72
- accessConditions : 72
- requiredDiplomaLevel : 72
- recommendedDiplomaLevel : 72
- market : 72
- appellations : 72
- relatedJobs : 72
- valueTags : 13
- interestTags : 3

## Marché officiel

- France : 63/72, zéros 7, absents 9
- Occitanie : 63/72, zéros 48, absents 9
- Aude : 63/72, zéros 145, absents 9
- Codes sans statistique nationale : 9

## Domaines et secteurs

- Domaine officiel estimable depuis code ROME : 72/72
- Secteur Boussole explicite : 71/72
- Fallback générique : 1/72

## Référentiel brut compétences

- Entrées brutes : 35595
- Doublons d'identifiants : 0
- Identifiants manquants : 0
- Checksum : `9bb7f23b7adef835fc19cc6dbee6e3278559360fa315793b62b77ae3a9ef3a60`

## Taille et performance

- Taille totale générée : 26.58 Mo
- Nombre de fichiers : 37
- Plus gros fichiers : rome-raw-skills.json (14.73 Mo), knowledge.rome.json (4.68 Mo), market/market-national.rome.json (1.76 Mo), market/market-occitanie.rome.json (1.69 Mo), market/market-aude.rome.json (1.44 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- Aucune compétence officielle n'est reliée aux métiers : le score compétences reste neutre et peu discriminant.
- Aucun contexte officiel n'est relié aux métiers : les contraintes doivent rester neutres ou faiblement pondérées.
- Trop de métiers sont des coquilles code + titre seulement pour promouvoir ce corpus.
- 1 métier(s) utilisent encore un fallback de secteur générique.
- 9 code(s) n'ont pas de ligne marché nationale dans le lot actuel.
