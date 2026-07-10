# API France Travail pour Boussole Pro

Boussole Pro reste offline-first. L'API France Travail / ROME sert uniquement a enrichir un corpus local ou des fichiers statiques generes.

## Principe recommande pour GitHub Pages

GitHub Pages est statique et ne peut pas proteger un secret cote serveur. Le navigateur ne doit donc jamais recevoir `FT_CLIENT_SECRET`.

Le chemin recommande est :

1. Creer une application dans l'espace France Travail IO.
2. Ajouter `FT_CLIENT_ID` et `FT_CLIENT_SECRET` dans les secrets GitHub du depot.
3. Ajouter `FT_TOKEN_URL` et `FT_ROME_FICHES_METIERS_URL` dans les variables GitHub Actions.
4. Lancer le workflow `Sync ROME data` manuellement.
5. Verifier les fichiers generes dans `creations/boussolepro/data/generated/`.
6. Depuis Boussole Pro, ouvrir Donnees puis charger les donnees generees.

La premiere voie automatisee utilise le scope valide :

```text
nomenclatureRome api_rome-fiches-metiersv1
```

Quand la synchronisation ROME sera reprise, la variable `ROME_CODES` permettra de synchroniser environ 72 codes representatifs. Si la variable est absente, le script utilise une liste integree.

```text
ROME_CODES=A1203,A1414,A1501,...
```

Chaque code est traite independamment. Une erreur 404, 403, 500 ou une structure inconnue est inscrite dans `failedCodes`, puis la synchronisation continue. Le workflow ne devient bloquant que si aucune fiche exploitable n'est recuperee.

Le navigateur ne doit pas appeler l'OAuth France Travail comme chemin principal. Le formulaire API manuel de Boussole Pro reste un diagnostic avance, utile pour comprendre une configuration, mais le flux fiable pour GitHub Pages passe par GitHub Actions ou par un proxy securise.

## Secrets GitHub

Dans GitHub, ouvrir `Settings > Secrets and variables > Actions`.

Secrets requis :

- `FT_CLIENT_ID`
- `FT_CLIENT_SECRET`

Variables possibles :

- `FT_TOKEN_URL`
- `FT_ROME_FICHES_METIERS_URL`
- `FT_SCOPE_METIERS`
- `FT_SCOPE_COMPETENCES`
- `FT_SCOPE_CONTEXTES`
- `FT_ROME_METIERS_URL`
- `FT_ROME_COMPETENCES_URL`
- `FT_ROME_CONTEXTES_URL`
- `ROME_CODES`
- `ROME_DEBUG_CODES`
- `ROME_RAW_DEBUG`
- `FT_RATE_LIMIT_MS`

Les URLs et scopes de referentiels optionnels doivent etre verifies dans la documentation France Travail IO active. Si un endpoint optionnel n'est pas configure ou repond en erreur, la synchronisation continue avec un avertissement. Le referentiel `metiers` est teste en diagnostic seulement pour ne pas augmenter le corpus au-dela des codes ROME demandes.

## Test sur GitHub Pages

Une fois le workflow execute, publier le site puis ouvrir Boussole Pro. La page Donnees propose `Charger les donnees generees`. L'application cherche les fichiers via le chemin relatif `data/generated/`, donc depuis GitHub Pages ils doivent exister dans `creations/boussolepro/data/generated/`. Si les fichiers sont absents ou si la synchronisation a echoue, l'application conserve le corpus sample.

Le workflow ne charge plus le referentiel competences global comme liste directement matchable. Il separe :

- `rome-raw-skills.json` : competences brutes ROME, non chargees par defaut dans Boussole Pro ;
- `skills.rome.json` : competences filtrees ;
- `knowledge.rome.json` : savoirs ;
- `certification-like.rome.json` : diplomes, titres, permis, CACES, habilitations ou elements similaires ;
- `skills-matchable.rome.json` : couche reduite pour le profil utilisateur ;
- `mappings.rome.json` : liens effectifs metier → competences, contextes, appellations et savoirs.

Le rapport qualite genere contient notamment `requestedCodesCount`, `successfulCodesCount`, `failedCodesCount`, `successfulCodes`, `failedCodes`, `completionRate`, `topMissingFields`, la couverture des domaines ROME et une section `completeness` distinguant metiers, competences, contextes, appellations, formations et certifications. Il expose aussi `rawSkills`, `filteredSkills`, `linkedSkills`, `matchableSkills`, `linkedJobsWithSkillsCount`, `linkedJobsWithContextsCount` et `globalCompletionScore`.

Si un referentiel global est charge sans lien metier → competence, le rapport signale `referential_loaded_but_unlinked`. Dans ce cas, Boussole Pro ne doit pas utiliser ces competences globales comme preuve de compatibilite.

Le dossier `creations/boussolepro/data/generated/debug/` peut contenir `raw-structure-report.json` quand `ROME_RAW_DEBUG=true` ou quand l'input manuel `raw_debug` est active. Ce fichier liste seulement les cles et chemins candidats des reponses ROME de test pour aider la normalisation ; il ne doit jamais contenir de token, secret, client_id ou en-tete Authorization.

## Retour aux donnees sample

Dans Boussole Pro, page Donnees, utiliser `Revenir aux donnees sample`. Le profil utilisateur est conserve.

## Regle de securite

Ne jamais mettre le secret France Travail dans le HTML, un JSON public, localStorage, une capture d'ecran, ou un commit.

Si un Client Secret a ete partage dans un outil externe, une conversation ou un depot, il est recommande de le regenerer dans France Travail IO avant usage durable.
