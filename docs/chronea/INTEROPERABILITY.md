# Formats et fidélité

L’import détecte, parse et valide sur copie, puis affiche aperçu et rapport avant la destination et confirmation. Les mutations sont transactionnelles et annulables. Aucun format externe ne remplace le modèle canonique. Une matrice de capacités précède les exports d’échange.

| Format | Import | Export | Fidélité et limites |
|---|---|---|---|
| Chronéa JSON V1/V2/V3 | Oui | V3 | Migration historique ou restitution V3 ; médias locaux inclus en enveloppe |
| Paquet `.chronea` | Oui | Oui | Projet canonique et Blobs séparés sans perte ; limites documentées dans DATA_MODEL |
| CSV Chronéa V3 | Oui | Oui | Temporalité, systèmes, fils, spans, sources et relations conservés dans colonnes JSON ; octets locaux omis, références distantes gardées |
| CSV historique / générique / Preceden | Oui | Oui | Historique conservé ; mapping générique explicite ; Preceden ne porte pas tous les concepts |
| TimelineJS | Oui | Oui | Dates partielles et horaires ; nuances avancées transformées en libellé ; un média par événement ; relations/sources omises |
| iCalendar | Oui | Oui | Dates complètes exactes ; horaires UTC, TZID ou flottants ; journées avec fin exclusive convertie correctement ; UID et RELATED-TO hérités préservés |
| JSCalendar | Oui | Oui | Sous-ensemble Event/Group, dates complètes exactes, durée, fuseau IANA, UID, texte, tags, lieux, relatedTo ; autres propriétés gardées en provenance |
| JSON-LD Schema.org | Non | Oui | Projection descriptive ; dates complètes exactes grégoriennes seulement ; n’est pas un format de restauration |
| Markdown / HTML / TeX | Non | Oui | Rapports selon paramètres Publication ; textes, lieu, tags, fils, sources, liens, relations, fichiers ; images locales intégrables dans HTML/SVG |
| SVG / PNG | Non | Oui | Publication autonome continue ; rendu graphique, pas données éditables |
| PDF | Non | Impression | Impression navigateur de la chronologie ou du projet complet ; aucun moteur PDF externe |

## CSV

Les séparateurs virgule, point-virgule et tabulation, BOM, guillemets et sauts de ligne cités sont supportés. Import Studio montre premières lignes, séparateur, colonnes, destinations et erreurs avec numéros de lignes. Le texte est décodé UTF-8 ; il n’y a pas de détection fiable d’autres encodages. Toute erreur bloque l’application, sans import partiel silencieux.

Le CSV V3 porte `project_json` une seule fois, puis `event_json`, colonnes simples et `temporal_json`, `tags_json`, `external_ids_json`. Les colonnes simples et JSON spécifiques peuvent être éditées et deviennent prioritaires sur leurs copies dans `event_json`. Les relations exigent que leurs événements soient encore présents. Les médias locaux nécessitent l’export natif. Les profils de mapping ne sont pas ajoutés : la détection et les choix restent visibles pour chaque fichier.

Ajout indépendant : rebase des identifiants et de toutes leurs références, y compris chemins de médias. Fusion : systèmes temporels identiques requis. Mise à jour : correspondance par namespace et valeur d’identifiant externe ; ambiguïtés refusées ; éléments sans correspondance ajoutés. Les titres ne servent jamais d’identité.

## iCalendar et JSCalendar

[iCalendar — RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html) et [JSCalendar — RFC 8984](https://www.rfc-editor.org/rfc/rfc8984.html) sont les références utilisées pour les adaptateurs. Les allers-retours sont comparés sur leurs valeurs temporelles et UID, pas sur l’ordre des propriétés.

iCalendar : repli UTF-8 de lignes, échappements et catégories sont testés. Dates vagues, partielles ou complexes omises plutôt que converties en faux 1er janvier. Récurrences, fuseaux personnalisés et composants non pris en charge sont refusés avec explication. Les relations typées canoniques ne deviennent pas arbitrairement des RELATED-TO.

JSCalendar : `start` LocalDateTime à secondes entières, `duration` en semaines/jours/heures/minutes/secondes entières. Les jours s’ajoutent au calendrier local, puis les heures en temps absolu. `updated` accepte les fractions de seconde. `showWithoutTime` conserve la valeur horaire sous-jacente. Une date canonique à la journée s’exporte avec minuit et une durée entière en jours, conversion explicitement déclarée. Les récurrences, secondes fractionnaires de `start`/durée, descriptions HTML et fuseaux personnalisés sont refusés. Une heure inexistante est refusée : le sous-ensemble ne simule pas les règles de discontinuité complètes du RFC.

`externalIds.icalUid` et `externalIds.jscalendar` restent stables. relatedTo est projeté vers des relations simples/dépendance ; les nuances originelles restent dans la provenance. Des propriétés héritées non éditées ne sont pas une prise en charge complète de leur comportement.

## Publication

SVG autonome : textes vectoriels, images locales embarquées, aucune ressource distante. PNG rasterisé localement, avec choix 1 024/2 048/4 096 pixels et garde-fous de taille ; une publication trop longue doit utiliser SVG/HTML ou une plage réduite. PDF : planche temporelle et dossier multipage via navigateur.

Markdown conserve le texte Markdown. HTML le convertit en balises sûres ; TeX convertit titres, listes, emphases, citations et liens, en échappant les commandes importées. Aucun fichier TeX n’a été compilé dans la recette. HTML/SVG peuvent intégrer les images locales ; Markdown et TeX listent les médias.

GEDCOM, TEI et GraphML ne sont pas ajoutés, conformément au plan qui les réserve à un usage concret.
