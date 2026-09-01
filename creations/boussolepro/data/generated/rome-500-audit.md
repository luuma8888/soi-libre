# Audit Boussole Pro - corpus ROME

Généré le 2026-09-01T08:27:46.112Z.

## Synthèse

- Métiers demandés : 72
- Métiers récupérés : 72
- Échecs : 0
- Coquilles code + titre : 0/72
- Score de préparation données : 98%
- Readiness globale : usable_for_validation

## Données réellement reliées aux métiers

- Mappings compétences : 72/72
- Mappings contextes : 69/72
- Mappings appellations : 69/72
- Mappings savoirs : 72/72
- Activités : 0/72
- Descriptions officielles : 69/72

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- activities : 72
- requiredDiplomaLevel : 72
- recommendedDiplomaLevel : 72
- relatedJobs : 72
- description : 3
- appellations : 3
- workContexts : 3
- accessConditions : 3

## Marché officiel

- Statut bundle marché : bundled_in_corpus_folder
- Lignes brutes : France 894, région 883, département 785
- Couverture corpus actif : 71/72 métier(s), sans marché 1
- France : 71/72, zéros 13, absents 1
- Occitanie : 71/72, zéros 87, absents 1
- Aude : 71/72, zéros 331, absents 1
- Codes sans statistique nationale : 1
- Codes nationaux absents en Occitanie : 0
- Codes nationaux ou régionaux absents dans l’Aude : 0

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

- Taille totale générée : 499.12 Mo
- Nombre de fichiers : 258
- Plus gros fichiers : rome1000-candidate/jobs.rome.json (34.39 Mo), rome800-candidate/jobs.rome.json (28.11 Mo), rome1000-candidate/rome-raw-skills.json (25.5 Mo), rome800-candidate/rome-raw-skills.json (25.5 Mo), rome-raw-skills.json (20.97 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- 1 code(s) n'ont pas de ligne marché nationale dans le lot actuel.
