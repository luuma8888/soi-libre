# Boussole Pro

**Version :** v0.5.5-alpha
**Sous-titre :** Boussole métier vivante, réaliste et offline  
**Moteur local :** ClairMétier

Boussole Pro est une application web autonome d’exploration métier. Elle aide à repérer des pistes compatibles avec un profil, des contraintes, des compétences, des diplômes, des envies, des valeurs et un niveau d’accès réel aux métiers.

Le fichier principal reste :

```text
creations/boussolepro/boussole-pro.html
```

Il contient le HTML, le CSS, le JavaScript, le moteur local, le corpus local enrichi estimatif, les données sample, le mode jour/nuit, les imports/exports et le CSS d’impression.

## Mode offline par défaut

L’application fonctionne sans serveur, sans CDN, sans tracking et sans API obligatoire. Le profil, le corpus actif, les préférences et les résultats sont conservés dans `localStorage`.

Par défaut, la v0.5.5 utilise le corpus local enrichi estimatif embarqué dans le HTML. Si ce corpus est indisponible, le corpus sample minimal reste disponible.

## Nouveautés v0.5.5-alpha

La v0.5.5-alpha affine la lecture humaine du profil :

- orientation par domaine : cœur actuel, domaine vivant, support, outil, secondaire, passé, à éviter en principal ou à exclure ;
- distinction claire entre compétence possédée et désir professionnel principal ;
- `trainingFamilies` traité comme famille de formation déjà connue, avec un effet de familiarité/accessibilité, pas comme souhait de reconversion ;
- ajout de `desiredTrainingFamilies` pour les familles de formation réellement souhaitées ;
- Top 5 qualifié : cœur, branche secondaire, métier hybride, alternative utile ou exploratoire ;
- numérique utilisable comme outil/support sans pousser automatiquement les métiers informatiques purs ;
- diagnostic enrichi avec fondation du résultat et niveau de cœur de profil ;
- banc de test local : profils intégrés, import multi-profils JSON, export JSON ou Markdown.

## Nouveautés v0.5.4-alpha

La v0.5.4-alpha améliore la sélection qualitative :

- taxonomie stable des secteurs, notamment propreté distincte de bâtiment ;
- score de cœur de profil pour distinguer métier central, compatible et exploratoire ;
- qualification du Top 5 : cœur du profil, diversité, complément utile ou exploratoire ;
- marché préparé comme critère intentionnel, avec indication quand il reste estimatif ou non discriminant ;
- origine des pondérations explicitée : défaut, intention, manuel, importé ou ancien profil ;
- affichage du niveau d’informations fondant un résultat ;
- comparaison simple des intentions moteur sans modifier le profil ;
- profils tests ajoutés pour propreté/hôtellerie, minimal et social/éducation.

## Nouveautés v0.5.3-alpha

La v0.5.3-alpha recalibre le moteur ClairMétier :

- intentions de recherche avec pondérations automatiques ;
- passage en pondération personnalisée dès qu’un curseur est ajusté ;
- contraintes traitées comme risque/filtre plutôt que bonus massif ;
- marché inconnu ou estimatif affiché comme donnée à confirmer et peu pondéré ;
- score formation plus discriminant selon diplôme, certification, budget, horizon et ouverture à la formation ;
- score de confiance plus variable, notamment pour les profils minimalistes ;
- affinité de domaine pour éviter qu’un métier hors sujet monte seulement grâce aux contraintes ;
- Top 5 complété avec les meilleures pistes utiles si la diversité stricte donne moins de cinq résultats ;
- exclusions de domaine par table explicite plutôt que correspondance textuelle vague ;
- diagnostic JSON enrichi avec intention, pondérations, affinité, fiabilité marché, plafonds de score et distributions d’audit.

## Nouveautés v0.5.2-alpha

La v0.5.2-alpha stabilise le calibrage des résultats :

- un mode diagnostic de résultat activable depuis la page Résultats ;
- une explication détaillée par sous-score ;
- une distinction claire entre compétence forte, faible, absente et non évaluée ;
- une liste des compétences manquantes non pénalisantes ;
- des sections “pourquoi ce métier ressort”, “ce qui l’empêche d’être mieux classé” et “ce qui pourrait changer le résultat” ;
- un contrôle des métiers qui resteraient hautement pertinents malgré une exclusion ;
- un export diagnostic JSON ;
- des profils tests intégrés pour auditer rapidement le moteur ;
- l’export profil inclut explicitement les préférences du moteur et les pondérations.

## Nouveautés v0.5.1-alpha

La v0.5.1-alpha ajoute un recalibrage d’usage sans changer le principe offline :

- le bloc **Top 5 diversifié** est restauré visuellement avant les autres pistes ;
- le bouton **Pourquoi** détaille compétences cochées, compétences à vérifier, contexte, contraintes, formation et marché ;
- les compétences sont organisées par secteurs avec recherche, accordéons et doublons visuels sûrs ;
- la durée d’expérience peut être précisée par domaine ;
- les métiers locaux sans code direct sont rattachés à une variante locale de code ROME à vérifier ;
- les métiers d’aide / puériculture incohérents sont réalignés avec des compétences de soin, enfant, hygiène et écoute ;
- des parcours de formation locaux indicatifs sont ajoutés avec `source: "curated_estimated"` et `officialStatus: "to_verify"` ;
- un onglet **Exploration** pour chercher, filtrer et trier les métiers du corpus actif ;
- des favoris locaux exportés/importés avec le profil ;
- une séparation plus claire entre pertinence et confiance du résultat ;
- des listes visibles plus sobres : Top 5, autres pistes principales, pistes à explorer, exclusions proches et pertinentes ;
- une règle de diversification plus prudente pour ne pas promouvoir une piste trop loin du meilleur score ;
- un scoring compétences plus juste : une compétence non cochée n’est pas considérée comme absente, elle baisse surtout la confiance ;
- des structures locales préparées pour les indicateurs marché France / Occitanie / Aude, sans données d’offres ni appel réseau.

## Corpus local enrichi v0.4

La v0.4.alpha ajoute un corpus local estimatif de 210 métiers, généré depuis `tmp/monde-pro/PROMPT_CODEX_BOUSSOLE_PRO_V0_4_CORPUS_LOCAL_200_METIERS.md` avec :

- `scripts/build-curated-clairmetier-corpus.mjs` ;
- `creations/boussolepro/data/curated/clairmetier-curated-v0.4.json` ;
- `creations/boussolepro/data/curated/curated-quality-report.v0.4.json`.

Ce corpus est aussi intégré dans `boussole-pro.html` pour consultation offline directe. Il est marqué `source: "curated_estimated"`, `provenance: "curated_clairmetier_ai_logic"` et `officialStatus: "not_official_to_verify"`.

Il contient 210 métiers, 91 compétences locales, 41 contextes, 13 certifications indicatives, 210 mappings, des contraintes, valeurs, intérêts, contextes et indicateurs marché estimatifs. Ces données servent à orienter, pas à certifier.

## Données sample

La version v0.5.5-alpha conserve les métiers sample non officiels comme repli minimal.

Les données sample restent marquées `sample_non_official` et ne doivent pas être présentées comme données ROME/RNCP/Onisep officielles.

## Mode données générées ROME

L’appel API ROME / France Travail direct depuis le navigateur reste désactivé pour l’usage courant. Les fichiers générés par GitHub Actions et les workflows existants restent présents pour reprise ultérieure.

La page **Données** propose `Charger les données générées`.

L’application tente alors de lire :

```text
creations/boussolepro/data/generated/import-manifest.rome.json
creations/boussolepro/data/generated/jobs.rome.json
creations/boussolepro/data/generated/data-quality-report.rome.json
```

Depuis `boussole-pro.html`, ces fichiers sont chargés avec le chemin relatif `data/generated/`, donc l’URL GitHub Pages attendue est `creations/boussolepro/data/generated/`.

Les compétences ROME sont séparées en plusieurs couches :

- `rome-raw-skills.json` : référentiel brut complet, optionnel, non chargé par défaut dans le matching ;
- `skills.rome.json` : compétences filtrées utiles ;
- `knowledge.rome.json` : savoirs et connaissances ;
- `certification-like.rome.json` : diplômes, habilitations, CACES, permis, titres ou éléments similaires ;
- `skills-matchable.rome.json` : petite liste de compétences utilisables dans le profil ;
- `mappings.rome.json` : liens métier → compétences, contextes, appellations, savoirs et métiers proches.

Les fichiers `work-contexts.rome.json`, `job-appellations.rome.json` et `mappings.rome.json` sont générés pour nourrir ClairMétier quand les fiches ROME contiennent les champs exploitables.

Tant que `mappings.rome.json` ne relie pas officiellement des compétences ou contextes à un métier, ClairMétier les affiche comme référentiels globaux mais ne les utilise pas comme preuve métier. Les compétences matchables servent au profil utilisateur, pas à affirmer qu’un métier les exige.

La chaîne ROME prépare aussi, sans inventer de données, les fichiers futurs `formations.onisep.json`, `certifications.certifinfo.json`, `mappings-rome-formations.json` et `mappings-rome-certifications.json`. Les formations, certifications et indicateurs marché sample ne sont pas mélangés au corpus ROME généré.

Si les fichiers sont absents, bloqués ou indisponibles, un message lisible est affiché et le corpus actif est conservé.

## Import / export

Actions disponibles :

- importer un corpus JSON ;
- exporter le corpus actif ;
- exporter le rapport qualité ;
- importer / exporter un profil JSON ;
- exporter les résultats en JSON ou Markdown ;
- exporter un diagnostic JSON des résultats ;
- importer / exporter les favoris avec le profil ;
- charger des profils tests intégrés depuis Paramètres ;
- charger le corpus local enrichi estimatif ;
- choisir le mode de corpus : automatique, ROME généré, corpus local enrichi, sample minimal ;
- revenir aux données sample.

## Mode API organisme

L’API France Travail / ROME n’est pas obligatoire et reste en pause fonctionnelle côté navigateur. La version v0.5.5-alpha conserve un mode avancé de test manuel dans Paramètres, sans stockage du Client Secret en localStorage.

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
2. Configurer `ROME_CODES` si vous voulez remplacer la liste v0.3.2 par défaut quand la synchronisation ROME sera reprise.
3. Lancer le workflow `Sync ROME data`.
4. Vérifier les fichiers `creations/boussolepro/data/generated/`.
5. Ouvrir Boussole Pro sur GitHub Pages et charger les données générées depuis la page Données.

Le rapport `data-quality-report.rome.json` indique la branche, les codes demandés/réussis/échoués, la complétude métiers/compétences/contextes/appellations/formations/certifications, les champs les plus absents, les avertissements de couverture et les compteurs `rawSkills`, `filteredSkills`, `linkedSkills`, `linkedContexts`, `linkedAppellations` et `matchableSkills`.

Le workflow peut écrire `debug/raw-structure-report.json` avec les clés et chemins candidats de quelques fiches ROME, sans corps brut complet ni jeton. Pour limiter les gros diffs, ce debug est désactivé par défaut et s’active avec l’input `raw_debug` ou la variable `ROME_RAW_DEBUG=true`.

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
