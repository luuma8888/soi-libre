# Projet canonique V3

Le contrat est `src/chronea/schema-v3.json`, embarqué dans le fichier final. Son validateur applique les types, champs requis, constantes, énumérations, alternatives, tableaux et références de ce contrat. Les contrôles métier complètent le schéma : identifiants uniques, dates possibles, direction temporelle, références résolues et arêtes non dupliquées. Il ne s’agit pas d’un validateur générique de tous les mots-clés JSON Schema.

## Objets

- Projet : `schemaVersion:3`, `id`, `title`, horodatages, `timelines`, `timeSystems`, `media`, `sources`, `metadata`.
- Chronologie : `id`, `title`, `timeSystemId`, `lanes`, `spans`, `events`, `relations`.
- Événement : identité, titre/type, résumé, Markdown, temporalité, libellé facultatif, fil, tags, lieu, références de médias/sources, liens, identifiants externes, horodatages.
- Fil : identité, nom, ordre, visibilité, couleur et description facultative.
- Période de fond : identité, titre, temporalité, fil facultatif, couleur.
- Relation : identité, `sourceId`, `targetId`, type, direction et note. Types : proximité, causalité, dépendance, précédence, inclusion, contradiction, soutien, même sujet.
- Source : référence partagée avec titre, citation, URL, note, type et provenance facultatifs.
- Média : métadonnées et `storageRef`, sans octets base64 dans le projet canonique. URL distante explicite ou Blob séparé ; checksum, texte alternatif et légende.

Les préférences d’écran ne sont pas des faits du projet. Un export natif produit `{app:"Chronéa",schemaVersion:3,kind:"project",project,assets}`. Les Data URL appartiennent uniquement à l’enveloppe JSON portable, jamais aux événements canoniques.

## Temporalité

```json
{
  "kind": "interval",
  "start": {
    "value": {"year":1998},
    "precision": "year",
    "qualifier": "exact",
    "notBefore": {"year":1998,"month":3},
    "notAfter": {"year":1998,"month":6}
  },
  "end": {
    "value": {"year":2001},
    "precision": "year",
    "qualifier": "approximate"
  }
}
```

`point` possède au plus un début, `interval` deux bornes, `openInterval` exactement une borne. Une borne contient valeur, précision et qualification (`exact`, `approximate`, `uncertain`), avec possibilités facultatives. Une absence de composants ne produit jamais une date artificielle.

Grégorien : année, mois, jour facultatifs ; horaires complets avec heure/minute/seconde, UTC ou TZID. Les coordonnées utilisent des jours grégoriens proleptiques, y compris de grandes années, sans dépendre des limites de `Date.UTC` pour les dates historiques. Un horaire zoné exige cependant une année 1–9999 et un fuseau pris en charge par `Intl`. Une heure inexistante au changement d’heure est refusée explicitement.

Numérique : nombre fini, unité et direction `1` ou `-1`, décimaux et négatifs admis. Un axe décroissant ordonne correctement `12.5 → 10`. Les très grands nombres restent limités par la précision flottante JavaScript.

Calendrier personnalisé : mois/cycles nommés et longueurs, jours intercalaires fixes de fin d’année, ères et décalages, unités supérieures facultatives en métadonnées et format d’affichage (`jour`, `mois`, `année`, `ère`). La définition est réutilisable. Les cycles irréguliers, années bissextiles fictives et conversions entre calendriers ne sont pas modélisés.

Les coordonnées, fenêtres, graduations et ancres sont dérivées. Une zone de précision couvre les composants inconnus ; une qualification sans bornes ne reçoit aucune marge temporelle inventée. EDTF demeure un adaptateur grégorien limité.

## Migration

V1 → V2 normalise sur copie ; V2 → V3 crée objets métier et extrait médias, fils, sources et relations. Les IDs hérités restent stables quand possible ; les collisions entre chronologies sont remappées, avec provenance `legacyChroneaId`. Les relations symétriques V2 deviennent une arête réciproque unique ; les relations ICS extérieures restent en provenance avec leurs UID. Les médias identiques sont dédupliqués.

Une date héritée invalide déclenche récupération, sans correction silencieuse. Les fixtures V1/V2/V3 vérifient migration, source inchangée et aller-retour par JSON et paquet.

## Paquet `.chronea`

ZIP documenté : `manifest.json`, `project.json`, `media/<id>`. Manifest : application Chronéa, format `chronea-package`, version 1, schéma 3, chemins et checksums. L’encodeur écrit du ZIP stocké (sans compression). Le lecteur accepte aussi DEFLATE lorsque `DecompressionStream('deflate-raw')` est disponible.

Limites : fichier 256 Mio, média 20 Mio, 2 048 entrées ZIP dont les deux fichiers JSON. ZIP64, chiffrement, chemins relatifs dangereux et entrées dupliquées sont refusés. CRC32 vérifie chaque entrée ; SHA-256 vérifie les médias lorsque disponible, avec fallback CRC32 déclaré. Ce sont des contrôles de corruption, pas un chiffrement.
