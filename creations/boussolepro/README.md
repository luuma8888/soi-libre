# Boussole Pro

**Version :** v0.7.7-alpha
**Sous-titre :** Boussole métier vivante, réaliste et offline  
**Moteur local :** ClairMétier

Boussole Pro est une application web autonome d’exploration métier. Elle aide à repérer des pistes compatibles avec un profil, des contraintes, des compétences, des diplômes, des envies, des valeurs, un contexte de travail et un niveau d’accès réaliste aux métiers.

Le fichier principal reste :

```text
creations/boussolepro/boussole-pro.html
```

Il contient le HTML, le CSS, le JavaScript, le moteur local, les données sample, le mode jour/nuit, les imports/exports et le CSS d’impression. Aucun CDN, tracking, appel réseau obligatoire ou dépendance externe n’est nécessaire au démarrage.

## Usage offline

L’application fonctionne directement depuis le fichier HTML ou via un petit serveur local. Le profil, le corpus actif, les préférences, les favoris et les résultats sont conservés dans `localStorage`.

Les données ROME générées restent séparées du HTML et peuvent être chargées depuis la page **Données**. Si les fichiers générés sont absents ou bloqués, l’application conserve le corpus actif et affiche une erreur lisible.

## Identité de la livraison

La barre d’état affiche une identité complète et stable :

```text
Boussole Pro v0.7.7-alpha · build 20260802-market-phase1-01 · données <version du corpus actif>
```

Le même `buildId` est inclus dans les exports et rapports. Après un déploiement manuel, contrôler le HTML public sans transmettre de profil :

```bash
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/verify-boussole-deployment.mjs "URL_PUBLIQUE" "20260802-market-phase1-01"
```

Le script affiche l’URL finale, le marqueur attendu et reçu, la date du contrôle, les en-têtes de cache utiles et un verdict. Aucun service worker n’est utilisé par l’application ; aucun cache applicatif supplémentaire ne masque donc le HTML.

## Modes de lecture

La v0.7.7 distingue trois niveaux d’usage :

- **Essentiel** : lecture courte des pistes principales, sans surcharge technique.
- **Détaillé** : scores séparés, raisons, vigilances, accès, marché et contexte.
- **Diagnostic** : audit plus complet pour comprendre les arbitrages du moteur.

Les résultats séparent volontairement :

- la **correspondance personnelle** ;
- la **faisabilité actuelle** ;
- le **marché / territoire** ;
- la **confiance des données**.

Le score historique composite reste disponible pour diagnostic, mais il ne doit pas être lu comme un verdict unique.

## Expériences exactes

Le profil peut contenir des domaines d’expérience larges et des métiers exacts déjà exercés. Les métiers exacts sont saisis depuis le corpus chargé, avec :

- nombre d’années ;
- période : ancienne, récente ou actuelle ;
- niveau de maîtrise ;
- appréciation ;
- envie de continuer ou non ;
- coche **Poste actuel**.

La coche **Poste actuel** synchronise `isCurrent` et `recency`. Le décochage repasse une expérience actuelle en `recent`, afin de rester modifiable et exportable/importable.

## Corpus disponibles

L’application peut travailler avec :

- le corpus sample minimal embarqué ;
- le corpus ROME72 dans `creations/boussolepro/data/generated/` ;
- le corpus ROME500 candidat consolidé dans le dossier historique `creations/boussolepro/data/generated/rome500-experimental/`.

Le corpus ROME500 porte la version fonctionnelle `rome500-candidate-v0.7`. Sa maturité est `candidate_consolidated` et son périmètre validé est `validated_for_boussole_pro_v0_7`. Ces deux informations ne signifient ni corpus officiel complet, ni certification, ni stabilité générale. L’ancien identifiant `rome500-experimental-v0.7` et le nom du dossier historique restent des alias techniques de migration, sans valeur de maturité fonctionnelle.

La révision canonique du paquet moteur est `rome500-runtime-v0.7.7-r1`. Son manifeste recense les fichiers actifs, leurs empreintes SHA-256, les versions de règles et les tailles de tables, notamment les `9 226` lignes de `skillsEngine`. L’identité de la couche marché et son cache sont séparés du corpus ROME : un nouveau millésime marché ne recharge pas les compétences. Un paquet incohérent ou un cache obsolète est rechargé sans effacer le profil, les favoris ni les réglages personnels.

## Livraison multi-fichiers

Le corpus ROME500 actif n'est pas intégré dans le HTML. La livraison complète se trouve dans `tmp/monde-pro/livraison-boussole-pro-v0.7.7-alpha-20260802-market-phase1-01/` et doit être ouverte avec un serveur local depuis ce dossier :

```bash
cd tmp/monde-pro/livraison-boussole-pro-v0.7.7-alpha-20260802-market-phase1-01
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000/boussole-pro.html`. L'ouverture directe en `file://` ne garantit pas le chargement des JSON locaux. Le fichier `manifest.sha256.json` décrit chaque fichier livré ; `runtime-bundle-identity.json` identifie précisément les entrées du moteur.

## Données ROME générées

La page **Données** peut charger les fichiers générés :

```text
import-manifest.rome.json
jobs.rome.json
skills.rome.json
knowledge.rome.json
certification-like.rome.json
skills-matchable.rome.json
work-contexts.rome.json
job-appellations.rome.json
mappings.rome.json
access-summary.rome500.json
official-constraint-summary.rome500.json
```

Les fichiers `rome-raw-skills.json` et les fichiers de debug sont utiles pour audit, mais ne sont pas chargés par défaut dans le matching.

Les données générées conservent leur provenance. Quand une information officielle manque, le moteur doit rester prudent et signaler la limite plutôt que combler silencieusement.

## Mapping sectoriel v0.7.3

Le mapping sectoriel local prioritaire se trouve dans :

```text
creations/boussolepro/data/local/rome-sector-mapping-v2.json
```

Il est aussi intégré dans `boussole-pro.html` pour préserver l’usage offline.

Points consolidés en v0.7.3 :

- `G1201` est classé en `hotellerie_hebergement`, avec `culture_communication` en secondaire.
- Les métiers d’art `B1101`, `B1201`, `B1303`, `B1401`, `B1502`, `B1604`, `B1701`, `B1803`, `B1805`, `B1806`, `B1808`, `B1816` ne doivent pas être exclus par défaut côté bâtiment.
- Un métier ROME avec secteur importé exploitable ne doit plus être marqué `ambiguous_unusable`.

Le script utile pour resynchroniser le mapping dans les JSON générés est :

```bash
node scripts/sync-rome500-sector-v2.mjs
```

## Accès métier et formation

La v0.7.3 renforce le résumé des conditions d’accès avec une lecture plus prudente :

- `requirementKind` : recommandé, obligatoire, réglementé, contradictoire, sans diplôme possible ou inconnu ;
- `minimumDiplomaLevel` et `maximumDiplomaLevel` pour garder les plages ;
- `specificCredentialRequired` et `requiredCredentialLabels` pour les diplômes d’État, cartes, permis, habilitations, agréments ou CQP ;
- `optionalCredentialLabels` pour les éléments cités comme atouts ;
- détection des négations : “aucune certification obligatoire”, “pas légalement obligatoire”, etc. ;
- `contradictoryEvidence` quand un texte contient à la fois une obligation et une absence d’obligation.

Exemples de cas surveillés :

- `G1201` : aucune formation spécifique exigée, Bac à Bac+2 recommandé, pas d’obligation.
- `K1201` : DEASS obligatoire ; un Bac+2 seul ne suffit pas.
- `N1210` : texte contradictoire à vérifier.
- `J1506`, `J1407`, `G1204`, `I1309`, `N4109`, `C1504` : qualification spécifique ou réglementation à traiter prudemment.

Le moteur sépare désormais la nature obligatoire ou réglementée de l’exigence, la qualification manquante, la durée documentée et l’exercice immédiat. Une qualification obligatoire n’est plus assimilée automatiquement à une formation longue. Quand sa durée n’est pas sourcée, le diagnostic indique « durée à vérifier » et conserve un statut prudent.

Pour les voies de concours, l’éligibilité à l’inscription, la réussite au concours et l’autorisation d’exercer sont évaluées séparément. `K2106` conserve ainsi ses trois voies CRPE sans inventer la nature juridique des expériences déclarées.

## Marché

La couche marché reste séparée :

```text
creations/boussolepro/data/generated/market/
```

Elle contient les volumes observés France, Occitanie et Aude, BMO 2026 normalisé en FAP 2021 et la tension Dares 2024 normalisée en FAP 2021. L’application sépare volume, présence territoriale, projets, difficulté, saisonnalité et tension. Chaque résultat exporte le poids marché demandé, le poids effectif et son effet en points, sans modifier la correspondance personnelle ni la faisabilité.

Limites actuelles :

- BMO et Dares restent descriptifs au niveau FAP tant qu’aucune table FAP 2021 vers ROME 4 officielle ou validée n’est fournie ;
- tension, difficulté et saisonnalité affichées comme non disponibles sur une fiche ROME en l’absence de rapprochement admissible ;
- offres individuelles non affichées ;
- fraîcheur et couverture variables selon territoire ;
- facteurs explicatifs de tension non attribués automatiquement.

## Import / export

Actions disponibles :

- importer / exporter un profil JSON ;
- importer / exporter les favoris avec le profil ;
- exporter les résultats en JSON ou Markdown ;
- exporter un diagnostic JSON ;
- importer un corpus JSON ;
- exporter le corpus actif ;
- exporter le rapport qualité ;
- revenir aux données sample.

Les exports anciens v0.5.x restent importables autant que possible. Quand un ancien profil ne contient pas `jobExperiences`, aucune expérience exacte n’est inventée.

## Sécurité

Ne jamais écrire `FT_CLIENT_SECRET` dans :

- le HTML ;
- un fichier JSON public ;
- `localStorage` ;
- le dépôt Git ;
- une URL ;
- une capture ou un export destiné au public.

GitHub Pages est statique : il ne peut pas protéger un secret côté serveur. Les synchronisations qui nécessitent OAuth doivent passer par GitHub Actions ou un proxy sécurisé.

Documentation complémentaire :

- `docs/API_FRANCE_TRAVAIL.md`
- `docs/API_PROXY.md`

## Commandes utiles

Avec le PATH Node NVM de Lu’uma :

```bash
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/sync-rome500-sector-v2.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/prepare-v071-local.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/validate-boussole-v073.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/validate-boussole-generated-data.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/validate-rome500-local.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/measure-boussole-rome500-browser.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/build-boussole-v076-delivery.mjs
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/validate-boussole-runtime-parity.mjs
```

Pour auditer les tailles et rapports de corpus :

```bash
/home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/audit-rome-500-generated.mjs
ROME_AUDIT_DIR=creations/boussolepro/data/generated/rome500-experimental /home/luuma/.config/nvm/versions/node/v24.18.0/bin/node scripts/audit-rome-500-generated.mjs
```

## Tests recommandés

Ouvrir `boussole-pro.html`, puis vérifier :

- ouverture sans erreur console ;
- mode jour/nuit ;
- sauvegarde après rechargement ;
- export/import profil ;
- export résultats JSON et Markdown ;
- import corpus JSON ;
- chargement ROME72 et ROME500 ;
- saisie d’un métier déjà exercé sans perte de focus ;
- coche et décoche **Poste actuel** ;
- affichage **Pourquoi** ;
- comparaison ;
- favoris ;
- Exploration, filtres et facettes ;
- impression ;
- responsive mobile ;
- absence de secret dans le code.

## Rapports

Les rapports de suivi temporaire doivent rester dans `tmp/` et ne pas être ajoutés à Git.

Les rapports générés dans `creations/boussolepro/data/generated/` documentent la qualité, la performance et les validations de corpus. Ils sont utiles pour audit, mais il faut choisir explicitement lesquels committer selon l’objectif de la branche.
