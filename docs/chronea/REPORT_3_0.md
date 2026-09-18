# Bilan Chronéa 3.0 — 18 septembre 2026

Les phases 0 à 8 du plan maître ont été mises en œuvre, avec une livraison HTML autonome. Les sauvegardes historiques sont conservées. Aucun commit, push ou changement de branche n’a été effectué.

## Livraison

- `creations/chronea.html` et `dist/chronea.html`, identiques : 241047 octets.
- Sources : `src/chronea/` (HTML/CSS, schéma, noyau, temps, projet, stockage, échelle, graphe, adaptateurs, publication, contrôleurs).
- Construction et tests : les six scripts Chronéa dans `scripts/`.
- Fixtures, suites, résultats, captures et PDF : `tests/chronea/`.
- Références, historique et ce bilan : `docs/chronea/`.
- Livraisons V2 et 2.1 : `backup/chronea/`.

`SHA-256 : 5965a8589b9ba8e4e0df509b662db49442162fdf462031c18ec1958095a764e6`

## Portes de validation

| Phase | Réalisé | Preuves au passage |
|---|---|---|
| 0–1 | Baseline et fiabilité 2.1 | 42 noyau + 42 navigateur ; rapport 2.1 conservé |
| 2 | Contrat V3, références et migrations | 60 tests métier verts |
| 3 | Projets, Blobs, IndexedDB, instantanés et paquet | 70 tests métier/stockage verts |
| 4 | Temporalité avancée et systèmes | 10 contrôles UI verts, dont récupération/undo/cache |
| 5 | Échelle, données groupées et relations | 18 contrôles UI cumulés verts, regroupement 10 000 |
| 6 | Import Studio, CSV V3, JSCalendar et fusion | 83 métier/stockage/adaptateurs + 22 UI verts |
| 7 | Publication et rapports | 30 UI cumulés verts, SVG/PNG/TeX |
| 8 | Conservation, focus, ergonomie, graphe, performances et documentation | Recette finale ci-dessous |

Les défauts rencontrés ont été corrigés avant de valider la suite : origine de navigateur de test pour le stockage, détection « nom » CSV, focus clavier, récupération asynchrone, horodatage fractionnaire JSCalendar. La relecture finale a ajouté des régressions sur légendes, relations et périodes de fond.

## Résultat final

Commande exécutée : `python3 scripts/test-chronea.py`. **147 vérifications, 0 échec** : 87 métier/stockage/adaptateurs/fixtures, 43 UI/console, 17 recette finale.

Chromium : `Chromium 150.0.7871.100 built on Debian GNU/Linux 13 (trixie)`, avec `--password-store=basic`, profil temporaire, réseau offline. CPU : Intel Core i5-10210U à 1,60 GHz. Plateforme : `Linux-6.6.141-09476-g954adab60416-x86_64-with-glibc2.41`.

Téléchargements JSON et paquet relus ; neuf exports d’échange/rapport téléchargés ; données et Nuit conservées au rechargement ; cache invalide préservé avec écritures bloquées ; zéro exception console et zéro requête réseau applicative. Responsive vérifié à 1440×1000, 768×1000 et 390×844 sur quatre vues, avec captures. PDF courant et complet contrôlés ; le dossier complet contient plusieurs chronologies.

## Mesures de charge

Une exécution Chromium headless locale, sans médias binaires lourds, quatre fils, dates réparties, résumés et tags. Durées en millisecondes. Ce ne sont pas des seuils garantis sur tout appareil.

| Événements | Validation | Récit | Échelle | Données | Recherche | Filtre | Pan | Zoom | Sauvegarde | Relecture |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 47 | 11.2 | 77.8 | 18.9 | 80 | 10.2 | 30.5 | 56 | 34.3 | 48.8 |
| 1500 | 130.4 | 15.6 | 105.1 | 15.4 | 102.6 | 23.7 | 45 | 76.2 | 126 | 162.9 |
| 5000 | 418.6 | 28.4 | 89 | 22.3 | 100.6 | 25.3 | 45.8 | 59.1 | 178.8 | 465.9 |
| 10000 | 790.3 | 40.8 | 108.8 | 30.1 | 98.5 | 25.6 | 66 | 61.2 | 363.7 | 1008.3 |

À 10 000 événements : 2405 éléments DOM dans Récit, 1709 dans Échelle, 3041 dans Données. Le JSON représente 5166386 octets. Pagination et regroupements maintiennent les vues bornées ; la validation complète au chargement ou lors d’une mutation reste plus coûteuse. L’autosauvegarde ne répète plus cette validation déjà effectuée par le contrôleur et ne reconstruit aucun champ.

La valeur heap exposée par le navigateur est arrondie et ne permet pas un audit précis. Démarrage/relecture avec gros médias et machines mobiles modestes doivent être évalués sur le terrain.

## Corrections et conservation

- Une année ou un mois seul ne reçoit aucun jour inventé ; les coordonnées restent dérivées.
- Possibilités, qualifications indépendantes, ouverts et horaires conservés dans le natif.
- Édition textuelle : relations, IDs, notes et direction préservés, même au-delà de 500 liens.
- Pièces jointes : retrait/réouverture sans permutation de légendes ; Blobs vérifiés et paquet relu.
- Périodes de fond : renommer conserve les possibilités ; simplification des dates avancées confirmée.
- Undo entre projets détache l’ancien handle fichier et la fenêtre de l’autre projet.
- JSON-LD ne transforme pas un intervalle ouvert en date certaine ; Preceden omet les formes non représentables.
- Table : édition directe sans remplacement du champ ni perte de focus.

## Limites réelles

- Calendriers personnalisés à longueurs fixes : pas d’anomalies historiques ou de règles bissextiles fictives ; unités supérieures conservées en métadonnées.
- ICS/JSCalendar sont des sous-ensembles annoncés ; récurrences et fuseaux personnalisés refusés. EDTF ne porte pas calendriers fictifs, horaires ou possibilités indépendantes.
- Cache de navigateur dépendant du quota et de l’origine, éventuellement évincé ; médias anciens conservés pour les instantanés. Le fichier portable demeure essentiel.
- API fichier native vérifiée par substitut, dialogue réel à relire sur le navigateur habituel ; JSON de secours en cas d’indisponibilité.
- Graphe à voisinage borné, placement heuristique ; toutes les relations restent dans la liste paginée. SVG/PNG produisent une planche continue, PDF un dossier multipage.
- Texte Markdown pris en charge par un sous-ensemble cohérent ; TeX non compilé dans la recette.
- Pas d’audit complet WCAG ni de lecteur d’écran réel dans cet environnement ; navigation clavier, focus, libellés et responsive contrôlés.

## Git et relecture

Branche de travail : `soi-libre-codex`. Les fichiers Chronéa sont nouveaux/non suivis dans ce dépôt ; les modifications préexistantes de Boussole et autres applications restent intactes. Aucun fichier n’a été ajouté à l’index par ce chantier. Relire le diff avant commit et ne sélectionner que les chemins Chronéa.

Pour intégrer uniquement le commit Chronéa dans `main`, une copie de travail séparée et un cherry-pick permettent de conserver les autres modifications non enregistrées du checkout actuel. Les commandes de commit/push sont fournies dans la réponse finale, sans exécution.
