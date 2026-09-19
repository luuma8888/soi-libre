# Chronéa 3.1 — corrections de cohérence UX

19 septembre 2026. Livrables : `creations/chronea.html` et `dist/chronea.html`, deux copies identiques d’une application HTML autonome et hors ligne. Les sources de développement sont dans `src/chronea/`.

## Réalisé

Les dix lots du plan `tmp/CHRONEA_CODEX_V3_CORRECTIONS.md` ont été exécutés dans l’ordre et validés avant de poursuivre. Le zoom utilise une seule caméra, séparée du filtre De / À. L’éditeur d’élément présente Repère ou Période, avec un seul formulaire de dates progressif, repris pour les ères/phases. Les chronologies d’un projet normal héritent de sa temporalité. Le calendrier imaginaire, les fils, les sources et les relations ont des contrôles métier sans JSON ni types techniques visibles. La barre présente un accès Publication, l’Apparence dans Projet et une table Données à colonnes choisies visuellement.

## Tests

Commande : `python3 scripts/test-chronea.py`. Résultat final : **213 vérifications, 0 échec** (87 noyau/stockage/adaptateurs, 43 interface historique, 17 acceptation, 66 UX des dix lots). Les deux HTML livrés sont identiques, font **264 347 octets** et portent le SHA-256 `2ef9655d40a5f9a558da2b836bb352eef2707ef12b6bc670adec5b65d564cdae`. Le total, les échecs, la taille et l’empreinte sont enregistrés dans `tests/chronea/results.json` ; les résultats par lot figurent dans `ux-lot-NN-results.json`. La recette Chromium utilise `--password-store=basic`. Elle vérifie aussi le démarrage sans réseau, la sauvegarde/relecture, les exports JSON et paquet, les PDF courants/complets, le thème, les médias et le responsive. Captures bureau, tablette et mobile dans `tests/chronea/artifacts/`.

## Migrations

Le schéma natif reste V3 et aucun projet existant n’est réécrit à la lecture. Les anciennes chaînes `event.type` restent dans les données ; à l’édition, leur première valeur est aussi conservée dans `metadata.legacyType`. La forme visible vient seulement de `temporal.kind`. L’ancienne préférence `camera` est reprise comme caméra graphique, sans devenir un filtre inter-vues. Un projet V3 à plusieurs systèmes reste consultable en mode compatibilité ; l’action de séparation crée des projets distincts en conservant l’original dans le cache.

## Compatibilité

Stockage IndexedDB et repli localStorage, instantanés, JSON natif, paquet `.chronea`, médias Blobs, undo/redo, imports/exports V3 et modes jour/nuit sont conservés. L’ajout/fusion d’un import incompatible est refusé avec proposition explicite d’un nouveau projet. La restauration complète d’un projet mixte demeure possible et le rend consultable.

## Limites restantes

La conversion automatique entre temps réel, axe numérique et calendrier imaginaire n’est pas disponible sans correspondance fournie par l’utilisateur ; aucune date n’est effacée pour simuler une conversion. La séparation d’un projet mixte en plusieurs projets du cache requiert IndexedDB ; chaque chronologie peut sinon être exportée séparément. `higherUnits` reste stocké, mais masqué dans l’interface tant qu’aucun comportement métier ne l’utilise. Les légendes et textes alternatifs des médias partagés restent attachés à l’asset, pas à chaque élément ; le nettoyage des médias orphelins n’a pas été ajouté. L’API native de choix de fichier, les lecteurs d’écran réels et les autres navigateurs exigent encore une vérification manuelle.

## Git

Modifications limitées à Chronéa, ses sources, tests, captures, sauvegarde V3.0 et documentation. Les autres modifications présentes dans le dépôt n’ont pas été intégrées. Aucun commit ni push effectué.
