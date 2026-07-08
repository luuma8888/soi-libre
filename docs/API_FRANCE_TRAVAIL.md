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

Elle recupere quelques fiches ROME de test, par defaut :

```text
M1607, M1805, K1303, A1203
```

Le navigateur ne doit pas appeler l'OAuth France Travail comme chemin principal. Le formulaire API manuel de Boussole Pro reste un diagnostic avance, utile pour comprendre une configuration, mais le flux fiable pour GitHub Pages passe par GitHub Actions ou par un proxy securise.

## Secrets GitHub

Dans GitHub, ouvrir `Settings > Secrets and variables > Actions`.

Secrets requis :

- `FT_CLIENT_ID`
- `FT_CLIENT_SECRET`

Variables possibles :

- `FT_TOKEN_URL`
- `FT_ROME_FICHES_METIERS_URL`
- `FT_ROME_TEST_CODES`
- `FT_RATE_LIMIT_MS`

Les URLs et scopes doivent etre verifies dans la documentation France Travail IO active.

## Test sur GitHub Pages

Une fois le workflow execute, publier le site puis ouvrir Boussole Pro. La page Donnees propose `Charger les donnees generees`. L'application cherche les fichiers via le chemin relatif `data/generated/`, donc depuis GitHub Pages ils doivent exister dans `creations/boussolepro/data/generated/`. Si les fichiers sont absents ou si la synchronisation a echoue, l'application conserve le corpus sample.

## Retour aux donnees sample

Dans Boussole Pro, page Donnees, utiliser `Revenir aux donnees sample`. Le profil utilisateur est conserve.

## Regle de securite

Ne jamais mettre le secret France Travail dans le HTML, un JSON public, localStorage, une capture d'ecran, ou un commit.

Si un Client Secret a ete partage dans un outil externe, une conversation ou un depot, il est recommande de le regenerer dans France Travail IO avant usage durable.
