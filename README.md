<h1 align="center">Soi-Libre</h1>

<p align="center">
  Applications web autonomes pour l'exploration intérieure, la création, la transmission, l'organisation et l'autonomie.
</p>

<p align="center">
  <a href="https://luuma8888.github.io/soi-libre/"><strong>Ouvrir la page publique</strong></a>
</p>

<p align="center">
  🟢 Offline · 🟡 Un fichier HTML · 🔵 Données locales · 🟣 Export / import JSON · ⚪ Sans compte
</p>

---

## Accès direct

La page publique permet de consulter les outils dans le navigateur et de télécharger directement les applications, sans passer par les fichiers du dépôt :

```text
https://luuma8888.github.io/soi-libre/
```

C'est l'entrée recommandée pour les visiteurs non développeurs, et plus largement pour toute personne qui veut simplement utiliser les outils.

## Le projet

Soi-Libre est une bibliothèque d'applications web autonomes.

Le projet est pensé pour être simple à consulter, facile à copier, utilisable hors-ligne et respectueux de la vie privée. Chaque outil doit pouvoir être ouvert directement dans un navigateur moderne, sans compte, sans serveur, sans installation et sans appel réseau nécessaire.

Les applications sont des invitations pratiques : écrire, clarifier, explorer, transmettre, organiser, imprimer, sauvegarder et reprendre plus tard.

## Ce que vous trouverez ici

| Chemin | Contenu |
| --- | --- |
| `index.html` | Page vitrine locale qui présente les applications principales. |
| `creations/` | Applications HTML autonomes. |
| `assets/` | Captures d'écran et petites ressources visuelles utilisées par l'index. |
| `backup/`, `tmp/` | Fichiers de travail, audits ou sauvegardes locales quand ils sont présents. |

## Applications principales

| Application | Usage |
| --- | --- |
| `creations/eveil.html` | Compagnon d'éveil et d'introspection. |
| `creations/design-humain-cg.html` | Lecture symbolique Design Humain et Clés Génétiques. |
| `creations/espace-interieur.html` | Espace d'apaisement, d'écriture et d'exploration intérieure. |
| `creations/souverainete-interieure.html` | Cartographie, révocations, réaffirmations et déclarations de souveraineté. |
| `creations/cardforge.html` | Atelier de cartes et supports imprimables. |
| `creations/ucem-compagnon.html` | Compagnon de pratique pour Un Cours En Miracles. |
| `creations/seve/` | Outils pédagogiques pour accompagner les valeurs et le discernement. |
| `creations/atelier_comedie_musicale.html` | Conception d'une comédie musicale. |
| `creations/autonomie.html` | Préparation collective, ressources et organisation. |
| `creations/lune.html` | Almanach lunaire offline. |
| `creations/promptarium.html` | Bibliothèque locale de prompts et fragments IA. |

## Charte technique commune

Chaque application publiée dans ce projet doit respecter cette base technique :

| Principe | Règle |
| --- | --- |
| 🟡 Format | Application web single-page, dans un seul fichier HTML autonome. |
| 🟢 Offline | Fonctionnement hors-ligne, sans serveur ni installation obligatoire. |
| 🔒 Vie privée | Pas de tracking, pas de télémétrie, pas de compte utilisateur. |
| 🌐 Réseau | Pas d'appel réseau au démarrage, pas d'API externe, pas de CDN. |
| 🧩 Dépendances | Aucune dépendance externe obligatoire, aucun framework requis. |
| 🎨 Code intégré | CSS dans `<style>`, JavaScript dans `<script>`. |
| 💾 Sauvegarde | Données locales via `localStorage`, ou `IndexedDB` lorsque les données sont plus lourdes. |
| 📦 Portabilité | Export JSON et import JSON quand l'application gère des données utilisateur. |
| 🖨️ Impression | CSS d'impression lisible et utile. |
| 📱 Responsive | Interface utilisable sur desktop, tablette et mobile. |

L'objectif est qu'un utilisateur puisse télécharger un fichier HTML, le garder sur son ordinateur ou une clé USB, l'ouvrir plus tard sans internet, et retrouver ses données localement.

Il n'y a pas d'exception souhaitée sur cette base technique pour les applications disponibles. Si une application a besoin d'une capacité plus lourde, elle doit rester locale, autonome et documentée. Des liens de référence peuvent exister dans les contenus, mais aucune application ne doit appeler automatiquement une API, un CDN, un service de suivi ou une ressource externe pour fonctionner.

## Philosophie UX

Les outils Soi-Libre doivent rester doux, clairs et utilisables sans fatigue mentale.

| Intention | Application concrète |
| --- | --- |
| Clarté | Parcours lisible, boutons explicites, états vides utiles. |
| Douceur | Interface sobre, lumineuse, pastel et non agressive. |
| Autonomie | Sauvegarde locale, export, import et impression faciles. |
| Prudence | Ton aidant, non définitif, surtout pour les sujets intérieurs ou symboliques. |
| Accessibilité | Textes lisibles, navigation mobile, contrastes raisonnables. |

Pour les sujets intérieurs, spirituels, pédagogiques ou symboliques, les textes doivent être présentés comme des pistes, observations, invitations ou hypothèses à ajuster selon le terrain.

## Confidentialité

Par défaut, tout reste local :

- aucune donnée n'est envoyée à un serveur ;
- aucun compte n'est nécessaire ;
- aucune clé API n'est stockée ;
- aucune analyse d'usage n'est intégrée ;
- les sauvegardes sont dans le navigateur de l'utilisateur via `localStorage`, ou via `IndexedDB` lorsque le volume de données le justifie.

Les exports JSON servent à sauvegarder, transférer ou archiver volontairement ses données.

## Utilisation locale

Pour une utilisation simple, passer par la page publique :

```text
https://luuma8888.github.io/soi-libre/
```

Pour une utilisation depuis le dépôt de code, ouvrir directement :

```text
index.html
```

Ou ouvrir une application spécifique :

```text
creations/souverainete-interieure.html
```

Un serveur local n'est normalement pas nécessaire. Si un navigateur bloque certains comportements en ouverture directe, vous pouvez lancer :

```bash
python3 -m http.server 8000
```

Puis ouvrir :

```text
http://localhost:8000
```

## Développement

Avant de modifier une application :

- vérifier la branche Git ;
- vérifier `git status -sb` ;
- lire les consignes éventuelles du projet ;
- préserver le format autonome et offline ;
- éviter d'ajouter des dépendances ;
- ne pas casser `localStorage` ou `IndexedDB`, export/import JSON, mode jour/nuit, impression et responsive.

Après modification :

- tester l'ouverture dans un navigateur ;
- vérifier la console ;
- tester la sauvegarde locale ;
- tester export/import JSON si l'application en possède ;
- vérifier l'impression ;
- vérifier l'affichage mobile ;
- relire le diff avant commit.

## Contribution

Les contributions les plus utiles sont :

- corrections de bugs ;
- améliorations d'accessibilité ;
- clarté UX ;
- meilleure impression ;
- meilleure robustesse d'import/export ;
- simplification du code ;
- enrichissement de contenus sans alourdir l'application.

Le projet privilégie la simplicité robuste plutôt que les architectures lourdes. Si une fonctionnalité semble demander un framework, une compilation ou plusieurs fichiers, il faut d'abord chercher une solution compatible avec le principe : un fichier HTML autonome, lisible et durable.
