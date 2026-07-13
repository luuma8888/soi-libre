# Audit Boussole Pro - ROME 500

Généré le 2026-07-13T05:40:31.777Z.

## Synthèse

- Métiers demandés : 500
- Métiers récupérés : 500
- Échecs : 0
- Coquilles code + titre : 500/500
- Score de préparation matching : 0%

## Données réellement reliées aux métiers

- Mappings compétences : 0/500
- Mappings contextes : 0/500
- Mappings appellations : 0/500
- Mappings savoirs : 0/500
- Activités : 0/500
- Descriptions officielles : 0/500

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- description : 500
- activities : 500
- requiredSkills : 500
- workContexts : 500
- accessConditions : 500
- requiredDiplomaLevel : 500
- recommendedDiplomaLevel : 500
- market : 500
- appellations : 500
- relatedJobs : 500
- valueTags : 230
- interestTags : 179

## Marché officiel

- France : 437/500, zéros 7, absents 63
- Occitanie : 429/500, zéros 48, absents 71
- Aude : 382/500, zéros 145, absents 118
- Codes sans statistique nationale : 63

## Domaines et secteurs

- Domaine officiel estimable depuis code ROME : 500/500
- Secteur Boussole explicite : 0/500
- Fallback générique : 500/500

## Référentiel brut compétences

- Entrées brutes : 35595
- Doublons d'identifiants : 0
- Identifiants manquants : 0
- Checksum : `b44f131b40e135bd5ba76ecd67a8d3b82d77e64b57a2de6e56e1ffd8862c27ac`

## Taille et performance

- Taille totale générée : 30.34 Mo
- Nombre de fichiers : 38
- Plus gros fichiers : rome-raw-skills.json (16.34 Mo), knowledge.rome.json (4.68 Mo), jobs.rome.json (2.03 Mo), market/market-national.rome.json (1.76 Mo), market/market-occitanie.rome.json (1.69 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- Aucune compétence officielle n'est reliée aux métiers : le score compétences reste neutre et peu discriminant.
- Aucun contexte officiel n'est relié aux métiers : les contraintes doivent rester neutres ou faiblement pondérées.
- Trop de métiers sont des coquilles code + titre seulement pour promouvoir ce corpus.
- 500 métier(s) utilisent encore un fallback de secteur générique.
- 63 code(s) n'ont pas de ligne marché nationale dans le lot actuel.
