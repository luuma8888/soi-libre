# Boussole Pro v0.7.2 - Rapport d'implémentation

Date : 2026-07-16

## Objectif

Stabiliser le score ClairMétier pour qu'un métier réellement exercé, maîtrisé et aimé soit reconnu comme forte correspondance personnelle, sans exception codée pour un code ROME précis.

Cas de régression traité : `G1203 - Animateur / Animatrice jeunesse`.

## Changements moteur

- Ajout de `jobExperiences` au profil.
- Ajout de `contextPreferences` avec niveaux `important`, `preferred`, `optional`, `avoid`.
- Ajout de `personalFitScore`, `feasibilityScore`, `marketOpportunityLevel`, `selectionScore` et `legacyCompositeScore`.
- Conservation de l'ancien composite comme diagnostic uniquement.
- Ajout de `evaluateExactJobExperience()` : durée, période, poste actuel, maîtrise, appréciation et envie de poursuivre.
- Ajout de `evaluateAccessFeasibility()` : conditions d'accès, diplômes, certifications obligatoires/recommandées, certifications avantageuses et expérience exacte.
- Détection du BAFA comme avantage si le texte d'accès le signale.
- Correction du score contraintes : départ à 25, pénalité uniquement en cas de risque ou incompatibilité confirmée.
- Correction des scores valeurs/intérêts et contextes avec saturation, pour éviter de pénaliser les profils riches.

## Secteurs corrigés

Le corpus ROME 500 local contient encore des secteurs importés erronés, par exemple `G1203` stocké en `restauration_alimentation`.

La v0.7.2 ajoute un mapping runtime prioritaire :

1. code ROME exact ;
2. préfixe 4 caractères ;
3. préfixe 3 caractères ;
4. famille/domaine/titre contrôlé ;
5. ambigu inutilisable.

Le fallback par lettre ne sert plus de preuve forte pour le cœur du profil.

Livrables :

- `data/local/rome-sector-mapping-v2.json`
- `data/generated/rome-sector-mapping-audit.json`
- `data/generated/sector-mapping-regression-report.json`

## Scores avant / après

Avant : le cas `G1203` pouvait rester autour de `72/100` car le moteur mélangeait secteur erroné, score composite unique et accès mal exploité.

Après : le moteur expose séparément :

- correspondance personnelle ;
- faisabilité actuelle ;
- opportunité marché ;
- confiance ;
- composite historique.

Assertions attendues pour le profil `experienced_youth_animator` :

- `G1203` rang 1 ;
- `personalFitScore >= 92` ;
- `feasibilityScore >= 80` ;
- `coreProfileMatchScore >= 90` ;
- `skills >= 23/25` ;
- `training >= 16/20` ;
- `constraints >= 23/25` ;
- `values >= 11/15` ;
- `context >= 8/10`.

## Interface

- Ajout du bloc “Métiers déjà exercés” dans Ma Boussole.
- Recherche dans métiers/appellations du corpus chargé.
- Ajout de durée, période, poste actuel, maîtrise, appréciation, envie de poursuivre.
- Affichage en résultat de la correspondance personnelle, faisabilité et marché séparés.
- Modal “Pourquoi” enrichi avec expérience exacte, faisabilité d'accès et composite diagnostic.
- Comparaison mise à jour avec correspondance personnelle, faisabilité et composite diagnostic.

## Tests et limites

Profils ajoutés :

- `experienced_youth_animator`
- `experienced_disliked_job`
- `old_experience_transferable`
- `no_exact_job_experience`

Aucune API n'a été appelée. Aucune GitHub Action n'a été lancée.

Limites restantes :

- Le mapping v2 est intégré côté application ; le générateur ROME devra reprendre cette logique lors d'une future étape API.
- Le Web Worker n'a pas été ajouté en v0.7.2 : le rapport performance recommande de l'ajouter si le corpus dépasse significativement 500 métiers.
- Les rapports JSON sont des audits locaux de calibration et non des données officielles France Travail.

## Fichiers à commit

- `creations/boussolepro/boussole-pro.html`
- `creations/boussolepro/data/local/rome-sector-mapping-v2.json`
- `creations/boussolepro/data/generated/rome-sector-mapping-audit.json`
- `creations/boussolepro/data/generated/sector-mapping-regression-report.json`
- `creations/boussolepro/data/generated/score-calibration-report.json`
- `creations/boussolepro/data/generated/score-engine-performance-report.json`
- `creations/boussolepro/CODEX_V0_7_2_IMPLEMENTATION_REPORT.md`

## Actions manuelles recommandées

1. Charger le corpus ROME 500 expérimental dans Boussole Pro.
2. Charger le profil test intégré `experienced_youth_animator`.
3. Lancer les résultats.
4. Vérifier que `G1203` ressort comme forte correspondance personnelle.
5. Vérifier le modal “Pourquoi” et l'export diagnostic JSON.
