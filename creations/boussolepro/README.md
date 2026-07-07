# Boussole Pro

**Version :** v0.2.alpha  
**Sous-titre :** Boussole métier vivante, réaliste et offline  
**Moteur local :** ClairMétier

Boussole Pro est une application web autonome d’exploration métier. Elle aide à repérer des pistes compatibles avec un profil, des contraintes, des compétences, des diplômes, des envies, des valeurs et un niveau d’accès réel aux métiers.

Le fichier principal reste :

```text
creations/boussolepro/boussole-pro.html
```

Il contient le HTML, le CSS, le JavaScript, le moteur local, les données sample, le mode jour/nuit, les imports/exports et le CSS d’impression.

## Mode offline par défaut

L’application fonctionne sans serveur, sans CDN, sans tracking et sans API obligatoire. Le profil, le corpus actif, les préférences et les résultats sont conservés dans `localStorage`.

Si aucun fichier généré n’existe et si l’utilisateur est hors ligne, le corpus sample embarqué continue de fonctionner.

## Données sample

La version v0.2.alpha embarque au moins 80 métiers sample, non officiels, couvrant notamment santé, social, petite enfance, animation, administratif, comptabilité, numérique, data, support informatique, communication, création, artisanat, bâtiment, maintenance, industrie, restauration, hôtellerie, agriculture, environnement, animaux, logistique, transport, commerce, sécurité, laboratoire, accompagnement, formation, services et culture.

Les données sample restent marquées `sample_non_official` et ne doivent pas être présentées comme données ROME/RNCP/Onisep officielles.

## Mode données générées

La page **Données** propose `Charger les données générées`.

L’application tente alors de lire :

```text
data/generated/import-manifest.rome.json
data/generated/jobs.rome.json
data/generated/data-quality-report.rome.json
```

Les fichiers `skills.rome.json`, `work-contexts.rome.json`, `job-appellations.rome.json` et `mappings.rome.json` peuvent aussi exister, mais la première voie GitHub Actions se concentre sur les fiches métiers ROME.

Si les fichiers sont absents, bloqués ou indisponibles, un message lisible est affiché et le corpus actif est conservé.

## Import / export

Actions disponibles :

- importer un corpus JSON ;
- exporter le corpus actif ;
- exporter le rapport qualité ;
- importer / exporter un profil JSON ;
- exporter les résultats en JSON ou Markdown ;
- revenir aux données sample.

## Mode API organisme

L’API France Travail / ROME n’est pas obligatoire. La version v0.2.alpha ajoute un mode avancé de test manuel dans Paramètres, sans stockage du Client Secret en localStorage.

Les chemins prévus sont :

- synchronisation par GitHub Actions avec secrets GitHub, scope `nomenclatureRome api_rome-fiches-metiersv1` et fiches de test `M1607`, `M1805`, `K1303`, `A1203` ;
- proxy serverless sécurisé ;
- import manuel JSON généré ailleurs.

Le panneau de test API manuel est avancé, replié par défaut, et ne stocke pas de secret en localStorage. Il sert seulement de diagnostic : l’application ne doit pas dépendre d’un appel OAuth navigateur depuis GitHub Pages.

## Cohérence profil / moteur

La page Paramètres contient un audit des champs de profil. Il documente l’impact attendu de chaque question : score de compétences, formation, contraintes, valeurs, contexte, mobilité ou faisabilité.

## Sécurité des secrets

Ne jamais écrire `FT_CLIENT_SECRET` dans :

- le HTML ;
- un fichier JSON public ;
- localStorage ;
- le dépôt Git ;
- une URL ;
- une capture ou un export destiné au public.

Si un Client Secret a été partagé dans un outil externe, une conversation ou un dépôt, il est recommandé de le régénérer dans France Travail IO avant usage durable.

GitHub Pages est statique : il ne peut pas protéger un secret côté serveur. Le workflow `.github/workflows/sync-rome-data.yml` lit les secrets GitHub côté Actions et écrit des fichiers publics dans `data/generated/`.

## Déploiement GitHub Pages

1. Ajouter `FT_CLIENT_ID` et `FT_CLIENT_SECRET` dans les secrets GitHub Actions.
2. Configurer `FT_TOKEN_URL` et `FT_ROME_FICHES_METIERS_URL` en variables Actions après vérification dans France Travail IO.
3. Lancer le workflow `Sync ROME data`.
4. Vérifier les fichiers `data/generated/`.
5. Ouvrir Boussole Pro sur GitHub Pages et charger les données générées depuis la page Données.

Documentation :

- `docs/API_FRANCE_TRAVAIL.md`
- `docs/API_PROXY.md`

## Tests recommandés

Ouvrir `boussole-pro.html`, puis vérifier :

- mode offline sans internet ;
- séparation header / sidebar / contenu ;
- résultats masqués pendant “Ma Boussole” ;
- bouton “Voir mes pistes” vers Résultats ;
- sauvegarde après rechargement ;
- mode jour/nuit ;
- export/import profil ;
- export résultats JSON et Markdown ;
- import corpus JSON ;
- chargement `data/generated` avec erreur douce si absent ;
- retour aux données sample ;
- impression ;
- affichage mobile ;
- absence de secret dans le code.
