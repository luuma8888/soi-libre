# Audit Boussole Pro - corpus ROME

Généré le 2026-11-01T10:14:45.356Z.

## Synthèse

- Métiers demandés : 72
- Métiers récupérés : 72
- Échecs : 0
- Coquilles code + titre : 0/72
- Score de préparation données : 100%
- Readiness globale : usable_for_validation

## Données réellement reliées aux métiers

- Mappings compétences : 72/72
- Mappings contextes : 71/72
- Mappings appellations : 71/72
- Mappings savoirs : 72/72
- Activités : 0/72
- Descriptions officielles : 71/72

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source `rome-fiches-metiers` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL`, `FT_ROME_CONTEXTES_URL`.
- Marché : `api_marche_travail`, méthode POST, volumes d'offres observés.

## Champs absents ou insuffisants

- activities : 72
- requiredDiplomaLevel : 72
- recommendedDiplomaLevel : 72
- relatedJobs : 72
- description : 1
- appellations : 1
- workContexts : 1
- accessConditions : 1

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

- Entrées brutes : 35787
- Doublons d'identifiants : 0
- Identifiants manquants : 0
- Checksum : `66483b18a2c12e8c9f5bee18b88e8e8733f1c8f6bf9825cd8c6d23794c9da0ba`

## Taille et performance

- Taille totale générée : 499.3 Mo
- Nombre de fichiers : 258
- Plus gros fichiers : rome1000-candidate/jobs.rome.json (34.39 Mo), rome800-candidate/jobs.rome.json (28.11 Mo), rome1000-candidate/rome-raw-skills.json (25.5 Mo), rome800-candidate/rome-raw-skills.json (25.5 Mo), rome-raw-skills.json (21.1 Mo)

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

- 1 code(s) n'ont pas de ligne marché nationale dans le lot actuel.
