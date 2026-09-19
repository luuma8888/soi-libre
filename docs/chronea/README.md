# Chronéa 3.1 — atelier temporel hors ligne

Ouvrir `creations/chronea.html` ou `dist/chronea.html` : les deux livraisons sont identiques et autonomes. Aucun serveur, CDN, compte ou accès réseau n’est nécessaire. Les modules du dossier `src` servent au développement ; seul le HTML est nécessaire à l’usage.

Chronéa accompagne les souvenirs, archives, recherches et univers imaginaires. Les vues **Récit**, **Texte** et **Médias** facilitent la lecture ; **Échelle** représente les distances et durées ; **Données** permet les modifications groupées ; **Relations** affiche un graphe et une liste navigable.

## Parcours conseillé

1. Choisir la temporalité du projet dans **Projet** : temps réel, axe imaginaire ou calendrier imaginaire. Ajouter un **Repère**, même avec une année seule, ou une **Période** avec début et fin.
2. Compléter au besoin la précision des dates, une fourchette ou une heure. Les champs utiles apparaissent progressivement dans le même éditeur. Ajouter résumé, Markdown, lieu, fil, tags, sources structurées et pièces jointes.
3. Comparer les fils sur l’Échelle. Molette, curseur, boutons `−`/`+`, pincement et minimap modifient seulement la fenêtre graphique ; **De / À** filtre volontairement toutes les vues. Un regroupement ouvre les événements exacts dans Données.
5. Enregistrer régulièrement un fichier `.chronea` ou un **Projet complet JSON**. Le cache du navigateur facilite la reprise, mais le fichier constitue la copie portable.
6. À l’import, choisir ajout, fusion, mise à jour par identifiant externe ou restauration complète. L’aperçu précède toute application ; un système incompatible demande la création d’un nouveau projet. L’action peut être annulée.
7. Passer en Publication pour SVG, PNG, HTML statique et dossier PDF via l’impression du navigateur.

Les dates inconnues restent inconnues. Les anciennes données V1/V2 sont migrées sur copie ; les projets V3 restent lisibles et leurs anciens types textuels sont conservés. Un ancien projet à plusieurs systèmes reste consultable en mode compatibilité et peut être séparé depuis **Projet**. Les propriétés et nuances perdues dans les formats externes sont annoncées. Les médias distants ne sont jamais chargés automatiquement.

## Construction et vérification

```sh
python3 scripts/build-chronea.py
python3 scripts/test-chronea.py
```

Le build utilise Python standard. La recette utilise Chromium local, lancé avec `--password-store=basic`, et le paquet Python `websockets` déjà disponible ; aucune dépendance n’est ajoutée à l’application.

- [Architecture](DEVELOPMENT.md)
- [Modèle V3 et migrations](DATA_MODEL.md)
- [Interopérabilité et pertes](INTEROPERABILITY.md)
- [Tests et limites de vérification](TESTING.md)
- [Historique](CHANGELOG.md)
- [Bilan des corrections 3.1](REPORT_3_1.md)
- [Bilan 3.0 et performances historiques](REPORT_3_0.md)

Les livraisons V2 originale, 2.1 et 3.0 sont conservées dans `backup/chronea/`. Aucun script ne fait de commit ou push.
