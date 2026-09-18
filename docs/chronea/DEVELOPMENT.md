# Développement de Chronéa

## Sources

| Fichier | Rôle |
|---|---|
| `src/chronea/index.html` | Structure, CSS, contrôles, dialogues et icônes inline |
| `schema-v3.json` | Contrat JSON Schema intégré au build |
| `core.js` | Validation et adaptateurs historiques V1/V2, CSV et iCalendar |
| `time.js` | Systèmes temporels, bornes, coordonnées dérivées et EDTF |
| `project.js` | Projet canonique V3, intégrité, migrations, sous-projet et suppression |
| `storage.js` | IndexedDB, Blobs, instantanés, JSON portable et ZIP sans bibliothèque |
| `scale.js` | Graduations, packing, clustering et SVG proportionnel |
| `graph.js` | Graphe limité à un voisinage et liens orientés |
| `adapters.js` | CSV V3, JSCalendar, capacités, rebase et fusion |
| `publication.js` | SVG éditorial, PNG local, Markdown vers TeX |
| `app.js` | État, contrôleurs, vues, historique et transactions |

Le build assemble ces sources dans **un seul script intégré**. Il n’y a ni modules externes à charger, ni compilation JS, ni dépendance applicative. Modifier les sources puis reconstruire les deux HTML générés.

```sh
python3 scripts/build-chronea.py
python3 scripts/test-chronea.py
```

## Transactions et rendu

`App.project` est le projet métier canonique. `App.prefs` contient uniquement l’interface. Une mutation clone le projet, vérifie le contrat et toutes les références, puis remplace l’état de façon atomique. Historique, import et modifications groupées suivent ce chemin. Les Blobs immuables sont référencés dans les états de l’historique sans recopier leurs octets.

Récit, Texte, Médias et Données ont des pages de 200 événements ; Relations, des pages de 150 liens. Le graphe montre au plus 60 nœuds et 100 liens, avec accès à la collection exacte dans la liste. L’Échelle agrège les voisinages denses et place les libellés sur plusieurs rangées. Les objets sans ancre restent accessibles dans les vues structurées.

La saisie directe ne reconstruit pas la table à chaque changement et conserve le focus. L’autosauvegarde ne déclenche pas de rendu. Les recherches sont temporisées ; les plages dérivées et index de sources/médias sont mis en cache par identité d’objet.

## Stockage

IndexedDB `chronea.projects.v3` comporte `projects`, `media`, `snapshots`. Les références de Blobs incluent projet, référence média et checksum ; les instantanés précédents retrouvent donc leurs octets. Une transaction écrit projet, médias et instantané ; cinq instantanés au maximum sont conservés par projet.

Le contrôleur valide chaque mutation avant l’autosauvegarde, qui évite une seconde validation globale. Le stockage valide normalement ses autres appelants. La validation des octets d’un Blob immutable est mémorisée, puis son checksum est comparé à chaque association.

Sans IndexedDB, `chronea.project.v3` contient un JSON portable et `chronea.snapshot.v3` la copie précédente. `chronea.preferences.v3` garde vue, thème et projet actif. Les clés V1/V2 sont lues sans écrasement. Une lecture invalide conserve le brut, bloque les écritures automatiques et donne accès aux instantanés. Les archives explicitement confirmées utilisent `chronea.corrupt-backup.<timestamp>`.

L’historique en mémoire est limité à 30 états et environ 16 Mio de métadonnées JSON. Les octets du cache de médias anciens restent conservés pour ne pas endommager un instantané ; le cache peut donc croître au fil de longues sessions. Le navigateur peut évincer son stockage : conserver une copie fichier.

## Sécurité

JSON Schema et invariants sont appliqués avant utilisation. Les objets prototype sont refusés, les textes sont échappés, les protocoles de liens limités, les médias actifs exclus. Les URL d’objets sont révoquées quand le projet change. Les tests injectent un pont `window.__test` uniquement dans une copie temporaire ; il est absent de la livraison.
