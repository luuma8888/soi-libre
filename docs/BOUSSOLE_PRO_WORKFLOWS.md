# Boussole Pro - workflows GitHub Actions

Ce document récapitule les workflows utilisés pour générer et valider les données statiques de Boussole Pro.

Règle générale : aucune clé API ne doit être écrite dans le dépôt, dans les JSON générés, dans le HTML ou dans `localStorage`.

## Où configurer les valeurs

- `Settings > Secrets and variables > Actions > Secrets` : valeurs sensibles.
- `Settings > Secrets and variables > Actions > Variables` : paramètres non sensibles.
- Onglet `Actions` : valeurs saisies au lancement manuel d'un workflow.

Si un champ de lancement manuel est vide, le workflow utilise en général la variable GitHub correspondante, puis une valeur par défaut du code.

## Secrets communs

| Secret | Obligatoire | Utilisé par | Description |
|---|---:|---|---|
| `FT_CLIENT_ID` | Oui pour les appels API réels | ROME, Marché | Identifiant OAuth France Travail. |
| `FT_CLIENT_SECRET` | Oui pour les appels API réels | ROME, Marché | Secret OAuth France Travail. Ne jamais le mettre en variable simple ni dans un fichier. |

## Workflow `Sync ROME data`

Fichier : `.github/workflows/sync-rome-data.yml`

Script : `scripts/sync-france-travail-rome.mjs`

Sortie standard ROME72 :

```txt
creations/boussolepro/data/generated/
```

Sortie ROME500 expérimentale par lots :

```txt
creations/boussolepro/data/generated/rome500-experimental/batches/
```

### Champs de lancement manuel

| Champ | Valeurs possibles | Valeur recommandée | Description |
|---|---|---|---|
| `rome_codes` | Liste de codes ROME séparés par virgules, espaces ou retours ligne. Exemple `M1607,G1202,A1203`. Vide accepté. | Vide pour ROME72 standard ou ROME500 par fichier. | Force une liste de codes. Prioritaire sur `ROME_CODES_FILE` et `ROME_CODES`. |
| `raw_debug` | `true` ou `false` | `false` | Génère `debug/raw-structure-report.json`. Utile pour auditer la structure brute sans écrire de token ni secret. |
| `endpoint_diagnostic` | `true` ou `false` | `false` | Teste plusieurs variantes d'appel fiche métier et génère `debug/fiche-endpoint-diagnostic.json`. |
| `endpoint_diagnostic_only` | `true` ou `false` | `false` | Si `true`, lance seulement le diagnostic endpoint sans régénérer le corpus. À utiliser seulement avec `endpoint_diagnostic=true`. |
| `diagnostic_codes` | Liste de codes ROME. Exemple `M1607,G1202,A1203`. | `M1607,G1202,A1203` | Codes utilisés pour les diagnostics endpoint et relations. |
| `relations_diagnostic` | `true` ou `false` | `false` | Lance `scripts/diagnose-rome-relations-endpoints.mjs` pour tester des routes de relations ROME. Continue même si le diagnostic échoue. |
| `rome_codes_file` | Chemin vers un fichier JSON/TXT de codes. Exemple `creations/boussolepro/data/local/rome-codes-500.json`. Vide accepté. | Vide pour ROME72, fichier 500 pour ROME500. | Utilisé si `rome_codes` est vide. |
| `rome_batch_index` | Nombre entier. Vide ou `1`, `2`, `3`, `4`, `5` pour ROME500. | Vide pour ROME72, `1` à `5` pour ROME500. | Sélectionne le lot à synchroniser. Avec 500 codes et taille 100 : `1` = codes 1-100, `5` = codes 401-500. |
| `rome_batch_size` | Nombre entier positif. | `100` pour ROME500. | Taille d'un lot. Si vide/0, tous les codes sélectionnés sont synchronisés. |
| `rome_output_subdir` | Chemin relatif simple. Exemple `rome500-experimental`. Vide accepté. | Vide pour ROME72, `rome500-experimental` pour ROME500. | Sous-dossier de `data/generated/` où écrire les sorties expérimentales. |
| `rome_dataset_mode` | Vide ou `rome500`. | Vide pour ROME72, `rome500` pour ROME500. | Marque la génération comme expérimentale ROME500 et évite de promouvoir automatiquement ce corpus. |

### Variables GitHub lues par le workflow ROME

| Variable | Valeurs possibles / testées | Description |
|---|---|---|
| `FT_TOKEN_URL` | URL OAuth. Valeur testée : `https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire` | URL de récupération du token France Travail. |
| `FT_SCOPE_METIERS` | Scope France Travail ROME métiers. Exemple utilisé : `api_rome-metiersv1 nomenclatureRome` | Scope optionnel pour le référentiel métiers. |
| `FT_SCOPE_COMPETENCES` | Scope France Travail ROME compétences. Exemple utilisé : `api_rome-competencesv1 nomenclatureRome` | Scope optionnel pour le référentiel compétences. |
| `FT_SCOPE_CONTEXTES` | Scope France Travail ROME contextes. Exemple utilisé : `api_rome-contextes-travailv1 nomenclatureRome` | Scope optionnel pour le référentiel contextes. |
| `FT_ROME_FICHES_METIERS_URL` | URL endpoint fiche métier. Valeur testée : `https://api.francetravail.io/partenaire/rome-fiches-metiers/v1/fiches-rome/fiche-metier` | Endpoint principal par code ROME. |
| `FT_ROME_METIERS_URL` | URL endpoint métiers. | Référentiel global et/ou détail métier si disponible. |
| `FT_ROME_COMPETENCES_URL` | URL endpoint compétences. | Référentiel compétences global. |
| `FT_ROME_CONTEXTES_URL` | URL endpoint contextes. | Référentiel contextes global. |
| `FT_RATE_LIMIT_MS` | Nombre de millisecondes. Défaut `1100`. | Pause entre appels API ROME. |
| `ROME_CODES` | Liste de codes ROME. | Liste par défaut si aucun champ manuel et aucun fichier ne sont fournis. |
| `ROME_CODES_FILE` | Chemin vers fichier JSON/TXT. | Alternative à `ROME_CODES` pour de grands corpus. |
| `ROME_BATCH_INDEX` | Entier. | Peut être défini en variable, mais il est souvent plus clair de le saisir au lancement manuel. |
| `ROME_BATCH_SIZE` | Entier. Défaut workflow `100`. | Taille des lots ROME. |
| `ROME_OUTPUT_SUBDIR` | Chemin relatif. | Sous-dossier de sortie. |
| `ROME_DATASET_MODE` | Vide ou `rome500`. | Active le mode expérimental. |
| `ROME_DEBUG_CODES` | Liste de codes. Défaut `M1607,M1805,K1303,A1203`. | Codes utilisés dans certains rapports debug. |
| `ROME_RAW_DEBUG` | `true` ou `false`. | Valeur par défaut du champ `raw_debug` si celui-ci est vide. |

Le workflow fixe aussi directement :

```txt
FT_SCOPE=nomenclatureRome api_rome-fiches-metiersv1
```

### Variables ROME avancées lues par les scripts

Ces variables ne sont pas toutes exposées comme champs du formulaire, mais le code sait les lire.

| Variable | Valeurs possibles | Description |
|---|---|---|
| `FT_ROME_FICHE_CODE_PARAMS` | Liste de noms de paramètres, défaut `codeRome,code,romeCode`. | Utilisé par les diagnostics endpoint pour tester différentes formes de requêtes. |
| `ROME_METIERS_DIAGNOSTIC_CODES` | Liste de codes ROME, défaut `A1203,K1303,M1607,M1805`. | Codes utilisés pour les échantillons du référentiel métiers. |
| `ROME_RELATIONS_DIAGNOSTIC_CODES` | Liste de codes ROME. | Codes transmis au script de diagnostic des relations. Dans le workflow, il reprend `diagnostic_codes`. |
| `ROME_DATASET_VERSION` | Chaîne libre, exemple `rome500-experimental-v0.7`. | Force la version du dataset généré. À laisser vide sauf besoin de versionner explicitement un test. |

### Recettes ROME

ROME72 standard :

```txt
rome_codes: vide
raw_debug: false
endpoint_diagnostic: false
endpoint_diagnostic_only: false
diagnostic_codes: M1607,G1202,A1203
relations_diagnostic: false
rome_codes_file: vide
rome_batch_index: vide
rome_batch_size: 100
rome_output_subdir: vide
rome_dataset_mode: vide
```

ROME500 lot 1 :

```txt
rome_codes: vide
raw_debug: false
endpoint_diagnostic: false
endpoint_diagnostic_only: false
diagnostic_codes: M1607,G1202,A1203
relations_diagnostic: false
rome_codes_file: creations/boussolepro/data/local/rome-codes-500.json
rome_batch_index: 1
rome_batch_size: 100
rome_output_subdir: rome500-experimental
rome_dataset_mode: rome500
```

Relancer ensuite avec `rome_batch_index` : `2`, `3`, `4`, `5`.

Diagnostic endpoint uniquement :

```txt
endpoint_diagnostic: true
endpoint_diagnostic_only: true
diagnostic_codes: M1607,G1202,A1203
```

## Workflow `Merge ROME 500 batches`

Fichier : `.github/workflows/merge-rome500-batches.yml`

Script : `scripts/merge-rome500-batches.mjs`

Ce workflow n'appelle pas l'API France Travail. Il fusionne les lots déjà écrits dans :

```txt
creations/boussolepro/data/generated/rome500-experimental/batches/
```

### Champs de lancement manuel

Aucun champ.

### Variables d'environnement

| Variable | Source | Description |
|---|---|---|
| `GITHUB_REF_NAME` | GitHub Actions | Branche courante du run. Utilisée dans les rapports et pour pousser les fichiers générés sur la même branche. |

### Quand l'utiliser

Après avoir généré et récupéré les lots ROME500 :

```txt
jobs.batch-01.json ... jobs.batch-05.json
mappings.batch-01.json ... mappings.batch-05.json
appellations.batch-01.json ... appellations.batch-05.json
report.batch-01.json ... report.batch-05.json
```

Le corpus 500 reste expérimental tant que les seuils qualité et les tests de régression ne sont pas validés.

## Workflow `Generate market data`

Fichier : `.github/workflows/generate-market-data.yml`

Scripts : `scripts/generate-market-data.mjs`, puis `scripts/prepare-boussole-market-phase1.mjs`

Sortie :

```txt
creations/boussolepro/data/generated/market/
```

### Champs de lancement manuel

| Champ | Valeurs possibles | Valeur recommandée | Description |
|---|---|---|---|
| `dry_run` | `true`, `false`. Le script accepte aussi `1`, `yes`, `oui` comme vrai. | `false` pour générer réellement, `true` pour diagnostic sans appel API. | Si `true`, aucune API Marché/BMO/FAP n'est appelée. |
| `territory` | Liste séparée par virgules ou retours ligne. Valeurs testées : `FR`, `REG-76`, `DEP-11`. Alias acceptés : `FRANCE`, `NAT`, `NAT-FR`, `OCCITANIE`, `REG76`, `76`, `AUDE`, `DEP11`, `11`. | `FR,REG-76,DEP-11` | Territoires à interroger. `FR` devient `NAT/FR`, `REG-76` devient `REG/76`, `DEP-11` devient `DEP/11`. |
| `rome_codes` | Liste de codes ROME. Exemple `G1202,K1207,M1607`. Vide accepté. | Vide pour utiliser le fichier ROME500. | Force une liste ciblée, prioritaire sur `rome_codes_file`. |
| `rome_codes_file` | Chemin vers un fichier JSON/TXT de codes. | `creations/boussolepro/data/local/rome-codes-500.json` | Liste utilisée lorsque `rome_codes` et `MARKET_ROME_CODES` sont vides. Le workflow échoue si le fichier est absent ou incohérent. |
| `period_type` | Chaîne transmise à l'API. Valeur testée : `TRIMESTRE`. | `TRIMESTRE` | Remplit `codeTypePeriode` dans le POST JSON. Les autres valeurs dépendent de l'API France Travail. |
| `source` | Liste de sources. Valeurs gérées : `api_marche_travail`, `bmo`. | `api_marche_travail,bmo` | Choisit les sources à traiter. FAP/ROME est traité si `FAP_ROME_MAPPING_URL` est renseignée. |

### Variables GitHub Marché

| Variable | Valeurs possibles / testées | Description |
|---|---|---|
| `MARKET_DRY_RUN` | `true` ou `false`. Défaut workflow `true`. | Valeur par défaut si le champ `dry_run` est vide. |
| `MARKET_TERRITORIES` | Exemple `FR,REG-76,DEP-11`. | Territoires par défaut. |
| `MARKET_SOURCE` | `api_marche_travail`, `bmo`, ou les deux séparés par virgule. | Sources à générer. |
| `FT_MARKET_SCOPE` | Valeur testée : `api_stats-offres-demandes-emploiv1 offresetdemandesemploi` | Scope OAuth pour l'API Marché. |
| `FT_MARKET_TOKEN_URL` | URL OAuth. Valeur testée : `https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire` | URL token spécifique marché. Si vide, le script peut utiliser `FT_TOKEN_URL` ou la valeur par défaut. |
| `FT_MARKET_API_URL` | Valeur testée : `https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1/indicateur/stat-offres` | Endpoint API Marché utilisé en POST JSON par code ROME. |
| `MARKET_EXTRA_QUERY` | Query string sans `?`, exemple `cle=valeur&autre=valeur`. | Paramètres additionnels ajoutés aux appels GET globaux. Généralement vide. |
| `MARKET_ROME_CODES` | Liste de codes ROME. | Réglage avancé du script local. Dans GitHub Actions, utiliser le champ manuel `rome_codes`. |
| `MARKET_ROME_CODES_FILE` | Chemin relatif vers un fichier JSON/TXT de codes ROME. | Fallback versionné, par défaut `creations/boussolepro/data/local/rome-codes-500.json`. |
| `ROME_CODES` | Liste historique utilisée par le workflow ROME. | Elle n'est plus reprise par le workflow marché afin de ne pas réduire accidentellement ROME500 à ROME72. |
| `MARKET_ACTIVITY_TYPE` | Chaîne. Défaut `ROME`. | Remplit `codeTypeActivite`. Garder `ROME` pour les codes ROME. |
| `MARKET_PERIOD_TYPE` | Chaîne. Défaut `TRIMESTRE`. | Remplit `codeTypePeriode`. |
| `MARKET_NOMENCLATURE_TYPE` | Chaîne. Défaut `ORIGINEOFF`. | Remplit `codeTypeNomenclature`. |
| `MARKET_USE_GLOBAL_TERRITORY_CALL` | `true` ou `false`. Défaut `false`. | Si `true`, tente d'abord un appel GET global par territoire. Le mode stable actuel est le POST JSON par code ROME, donc garder `false`. |
| `MARKET_FAIL_ON_EMPTY` | `true` ou `false`. Défaut `false`. | Si `true`, le workflow échoue quand aucun résultat API Marché n'est exploitable. Pour diagnostic progressif, garder `false`. |
| `MARKET_DEBUG_SAMPLE` | `true` ou `false`. Défaut `false`. | Écrit des échantillons debug de réponse marché si le script le décide. |
| `MARKET_REQUEST_DELAY_MS` | Nombre de millisecondes. Défaut `250`. | Pause entre appels marché par code ROME. |
| `BMO_DATA_URL` | URL du classeur officiel BMO. Valeur par défaut : ressource BMO 2026 de France Travail sur data.gouv.fr. | Le workflow réel télécharge et parse le XLSX ; les projets, difficultés et saisonnalités restent au niveau FAP 2021 tant que le rapprochement ROME est absent. |
| `DARES_TENSION_DATA_URL` | URL du classeur officiel Dares / France Travail. Valeur par défaut : données de tension 2024. | Le workflow conserve le millésime statistique 2024, distinct de la date de publication. |
| `FAP_NOMENCLATURE_URL` | Export CSV officiel de la nomenclature FAP 2021. | Normalise les codes et libellés FAP utilisés par BMO et Dares. |
| `FAP_ROME_MAPPING_URL` | URL éventuelle d’une table FAP 2021 vers ROME 4 officielle ou validée. | Aucune première correspondance arbitraire n’est retenue. Sans table contrôlée, le statut reste `not_run_needs_source_or_workflow` et le classement n’est pas modifié. |

En mode réel, le workflow produit un contrat marché versionné, une identité de paquet indépendante, un rapport qualité, les données BMO 2026 et Dares 2024 normalisées, ainsi qu’un état explicite du rapprochement FAP–ROME. En mode `dry_run`, il préserve les sources déjà normalisées et vérifie la structure sans appel réseau.

### Variables Marché avancées lues par le script

| Variable | Valeurs possibles | Description |
|---|---|---|
| `DRY_RUN` | `true` ou `false`. | Alias technique de `MARKET_DRY_RUN`. Le workflow l'alimente depuis le champ `dry_run`. |
| `SOURCE` | Liste de sources. | Alias technique de `MARKET_SOURCE`. |
| `TERRITORY` | Liste de territoires. | Alias technique de `MARKET_TERRITORIES`. |
| `FT_TOKEN_URL` | URL OAuth. | Fallback si `FT_MARKET_TOKEN_URL` est vide. |

### Payload POST JSON Marché

Le script envoie un payload par territoire et code ROME :

```json
{
  "codeTypeTerritoire": "NAT | REG | DEP",
  "codeTerritoire": "FR | 76 | 11",
  "codeTypeActivite": "ROME",
  "codeActivite": "G1202",
  "codeTypePeriode": "TRIMESTRE",
  "codeTypeNomenclature": "ORIGINEOFF"
}
```

### Recette Marché réelle

```txt
dry_run: false
territory: FR,REG-76,DEP-11
rome_codes: vide
rome_codes_file: creations/boussolepro/data/local/rome-codes-500.json
period_type: TRIMESTRE
source: api_marche_travail,bmo
```

L'étape `Validate market ROME scope` doit annoncer `requestedRomeCodesCount: 500` avant tout appel à l'API. Une valeur différente doit conduire à interrompre le lancement et à contrôler les deux champs ROME.

Variables recommandées :

```txt
FT_MARKET_SCOPE=api_stats-offres-demandes-emploiv1 offresetdemandesemploi
FT_MARKET_TOKEN_URL=https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire
FT_MARKET_API_URL=https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1/indicateur/stat-offres
MARKET_TERRITORIES=FR,REG-76,DEP-11
MARKET_DRY_RUN=false
MARKET_PERIOD_TYPE=TRIMESTRE
MARKET_NOMENCLATURE_TYPE=ORIGINEOFF
MARKET_USE_GLOBAL_TERRITORY_CALL=false
MARKET_FAIL_ON_EMPTY=false
```

## Workflow `Validate Boussole generated data`

Fichier : `.github/workflows/validate-boussole-data.yml`

Script : `scripts/validate-boussole-generated-data.mjs`

### Déclencheurs

- Lancement manuel `workflow_dispatch`.
- Push modifiant :
  - `creations/boussolepro/data/generated/**`
  - `scripts/validate-boussole-generated-data.mjs`

### Champs de lancement manuel

Aucun champ.

### Variables d'environnement

Aucune variable spécifique.

### Ce qui est validé

- JSON lisible.
- `jobs.rome.json` contient un tableau exploitable.
- Champs minimaux métier : `id`, `romeCode`, `title`, `description`, `sourceRefs`.
- Rapport clair en cas d'erreur.

## Workflow `Check no secrets`

Fichier : `.github/workflows/check-no-secrets.yml`

Script : `scripts/check-no-secrets.mjs`

### Déclencheurs

- Lancement manuel `workflow_dispatch`.
- Tous les push.

### Champs de lancement manuel

Aucun champ.

### Variables d'environnement

Aucune variable spécifique.

### Ce qui est scanné

Le script cherche notamment :

- `access_token`
- `client_secret`
- `FT_CLIENT_SECRET`
- `Bearer ...`
- assignations suspectes de secrets

Il n'affiche pas les valeurs sensibles détectées, seulement le fichier, la ligne et le type de motif.

## Ordre pratique recommandé

Pour ROME72 :

```txt
1. Sync ROME data sur la branche soi-libre-codex, paramètres ROME72.
2. git pull --ff-only origin soi-libre-codex
3. Validate Boussole generated data si besoin.
4. Tester dans Boussole Pro : Charger les données générées ROME 72.
```

Pour ROME500 :

```txt
1. Sync ROME data lot 1.
2. git pull --ff-only origin soi-libre-codex.
3. Sync ROME data lot 2.
4. git pull --ff-only origin soi-libre-codex.
5. Répéter jusqu'au lot 5.
6. Merge ROME 500 batches.
7. git pull --ff-only origin soi-libre-codex.
8. Tester dans Boussole Pro : Charger ROME 500 expérimental.
```

Pour Marché :

```txt
1. Generate market data avec dry_run=false.
2. git pull --ff-only origin soi-libre-codex.
3. Dans Boussole Pro : Charger les données générées ROME 72.
4. Vérifier l'onglet Données > Marché et territoire.
```

## Rappels importants

- Les workflows checkout et push sur `github.ref_name`, donc la branche choisie au lancement doit être `soi-libre-codex` pour mettre à jour cette branche.
- L'onglet Actions affiche les workflows depuis la branche par défaut du dépôt. Si un workflow n'apparaît pas, il faut que son fichier YAML existe aussi sur `main`.
- Le formulaire API manuel dans Boussole Pro reste un diagnostic avancé. L'obtention du token France Travail depuis le navigateur est bloquée par CORS et ne doit pas être utilisée comme voie réelle.
- Le corpus ROME500 ne remplace pas automatiquement le corpus ROME72 : il est expérimental jusqu'à validation qualité, performance et régression moteur.
