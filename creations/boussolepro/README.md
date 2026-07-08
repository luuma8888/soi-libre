# Boussole Pro

**Version :** v0.3.1.alpha  
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

La version v0.3.1.alpha embarque toujours les métiers sample non officiels de démonstration et renforce la chaîne ROME générée : extraction récursive des champs utiles, référentiels dérivés et rapport de complétude par famille.

Les données sample restent marquées `sample_non_official` et ne doivent pas être présentées comme données ROME/RNCP/Onisep officielles.

## Mode données générées

La page **Données** propose `Charger les données générées`.

L’application tente alors de lire :

```text
creations/boussolepro/data/generated/import-manifest.rome.json
creations/boussolepro/data/generated/jobs.rome.json
creations/boussolepro/data/generated/data-quality-report.rome.json
```

Depuis `boussole-pro.html`, ces fichiers sont chargés avec le chemin relatif `data/generated/`, donc l’URL GitHub Pages attendue est `creations/boussolepro/data/generated/`.

Les fichiers `skills.rome.json`, `work-contexts.rome.json`, `job-appellations.rome.json` et `mappings.rome.json` sont générés pour nourrir ClairMétier quand les fiches ROME contiennent les champs exploitables.

La v0.3.1 prépare aussi, sans inventer de données, les fichiers futurs `formations.onisep.json`, `certifications.certifinfo.json`, `mappings-rome-formations.json` et `mappings-rome-certifications.json`.

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

L’API France Travail / ROME n’est pas obligatoire. La version v0.3.1.alpha conserve un mode avancé de test manuel dans Paramètres, sans stockage du Client Secret en localStorage.

Les chemins prévus sont :

- synchronisation par GitHub Actions avec secrets GitHub, scope `nomenclatureRome api_rome-fiches-metiersv1` et variable `ROME_CODES` pour synchroniser environ 72 codes représentatifs ;
- diagnostics optionnels via `FT_SCOPE_METIERS`, `FT_SCOPE_COMPETENCES`, `FT_SCOPE_CONTEXTES`, `FT_ROME_METIERS_URL`, `FT_ROME_COMPETENCES_URL` et `FT_ROME_CONTEXTES_URL`, sans échec bloquant si ces variables ne sont pas configurées. Le référentiel métiers reste en diagnostic pour ne pas augmenter le corpus au-delà des codes ROME demandés ;
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

GitHub Pages est statique : il ne peut pas protéger un secret côté serveur. Le workflow `.github/workflows/sync-rome-data.yml` lit les secrets GitHub côté Actions et écrit des fichiers publics dans `creations/boussolepro/data/generated/`.

## Déploiement GitHub Pages

1. Ajouter `FT_CLIENT_ID` et `FT_CLIENT_SECRET` dans les secrets GitHub Actions.
2. Configurer `ROME_CODES` si vous voulez remplacer la liste v0.3.1 par défaut.
3. Lancer le workflow `Sync ROME data`.
4. Vérifier les fichiers `creations/boussolepro/data/generated/`.
5. Ouvrir Boussole Pro sur GitHub Pages et charger les données générées depuis la page Données.

Le rapport `data-quality-report.rome.json` indique la branche, les codes demandés/réussis/échoués, la complétude métiers/compétences/contextes/appellations/formations/certifications, les champs les plus absents et les avertissements de couverture.

Le workflow écrit aussi `debug/raw-structure-report.json` avec les clés et chemins candidats de quelques fiches ROME, sans corps brut complet ni jeton.

Deux contrôles GitHub Actions complètent la chaîne :

- `Validate Boussole generated data` vérifie les JSON générés ;
- `Check no secrets` scanne les fichiers publics pour éviter l’ajout accidentel de secrets.

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
- chargement `creations/boussolepro/data/generated` avec erreur douce si absent ;
- retour aux données sample ;
- impression ;
- affichage mobile ;
- absence de secret dans le code.
