# Boussole Pro

**Version :** v0.7.4-alpha
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

## Modes de lecture

La v0.7.3 distingue trois niveaux d’usage :

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
- le corpus ROME500 expérimental dans `creations/boussolepro/data/generated/rome500-experimental/`.

Le corpus ROME500 est expérimental : il est utile pour tester le moteur, la couverture et la diversité, mais les données d’accès, de marché, de contexte ou de formations restent à vérifier auprès des sources officielles avant décision.

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

Le moteur ne déduit plus une formation courte à partir d’un simple écart de niveau quand une qualification spécifique obligatoire manque. Dans ce cas, la piste reste possible après vérification ou formation longue, mais pas “accessible maintenant” par raccourci.

## Marché

La couche marché reste séparée :

```text
creations/boussolepro/data/generated/market/
```

Elle contient les volumes observés France, Occitanie et Aude quand les fichiers sont disponibles. L’application affiche ces signaux comme contexte de décision, sans les confondre avec la correspondance personnelle ni la faisabilité.

Limites actuelles :

- tension métier non calculée ;
- offres individuelles non affichées ;
- fraîcheur et couverture variables selon territoire ;
- BMO / FAP encore à consolider.

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
