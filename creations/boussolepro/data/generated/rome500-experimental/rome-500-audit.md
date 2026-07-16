# Audit Boussole Pro - corpus ROME

Généré le 2026-07-16T16:02:50.584Z.

## Synthèse

- Métiers demandés : 500
- Métiers récupérés : 500
- Échecs : 0
- Coquilles code + titre : 0/500
- Score de préparation données : 100%
- Readiness globale : usable_for_validation

## Données réellement reliées aux métiers

- Mappings compétences : 500/500
- Mappings contextes : 496/500
- Mappings appellations : 496/500
- Mappings savoirs : 500/500
- Activités : 0/500
- Descriptions officielles : 496/500

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- activities : 500
- requiredDiplomaLevel : 500
- recommendedDiplomaLevel : 500
- relatedJobs : 500
- description : 4
- appellations : 4
- workContexts : 4
- accessConditions : 4

## Marché officiel

- Statut bundle marché : loaded_from_shared_market_folder
- Lignes brutes : France 437, région 429, département 382
- Couverture corpus actif : 437/500 métier(s), sans marché 63
- France : 437/500, zéros 7, absents 63
- Occitanie : 429/500, zéros 48, absents 71
- Aude : 382/500, zéros 145, absents 118
- Codes sans statistique nationale : 63
- Codes nationaux absents en Occitanie : 8
- Codes nationaux ou régionaux absents dans l’Aude : 55

## Domaines et secteurs

- Domaine officiel estimable depuis code ROME : 500/500
- Secteur Boussole explicite : 500/500
- Fallback générique : 0/500

## Référentiel brut compétences

- Entrées brutes : 35595
- Doublons d'identifiants : 0
- Identifiants manquants : 0
- Checksum : `81987e003329a52a8558eb15ce6aa5f9acaf072344235f0adf040dc275eba534`

## Taille et performance

- Taille totale générée : 73.08 Mo
- Nombre de fichiers : 55
- Plus gros fichiers : rome-raw-skills.json (20.97 Mo), jobs.rome.json (18.47 Mo), knowledge.rome.json (5.14 Mo), batches/jobs.batch-03.json (3.84 Mo), batches/jobs.batch-02.json (3.79 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- 63 code(s) n'ont pas de ligne marché nationale dans le lot actuel.
