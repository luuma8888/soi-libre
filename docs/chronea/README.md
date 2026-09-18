# Chronéa 3.0 — atelier temporel hors ligne

Ouvrir `creations/chronea.html` ou `dist/chronea.html` : les deux livraisons sont identiques et autonomes. Aucun serveur, CDN, compte ou accès réseau n’est nécessaire. Les modules du dossier `src` servent au développement ; seul le HTML est nécessaire à l’usage.

Chronéa accompagne les souvenirs, archives, recherches et univers imaginaires. Les vues **Récit**, **Texte** et **Médias** facilitent la lecture ; **Échelle** représente les distances et durées ; **Données** permet les modifications groupées ; **Relations** affiche un graphe et une liste navigable.

## Parcours conseillé

1. Créer un projet et ajouter un repère, même avec une année seule.
2. Compléter résumé, Markdown, lieu, fils, tags, sources et pièces jointes.
3. Utiliser « Temporalité avancée » pour horaires, possibilités, qualifications indépendantes et intervalles ouverts. Les paramètres de chronologie définissent aussi axes numériques et calendriers fictifs.
4. Comparer les fils sur l’Échelle, zoomer au curseur, déplacer la fenêtre ou utiliser la vue globale. Un regroupement ouvre les événements exacts dans Données.
5. Enregistrer régulièrement un fichier `.chronea` ou un **Projet complet JSON**. Le cache du navigateur facilite la reprise, mais le fichier constitue la copie portable.
6. À l’import, choisir ajout indépendant, fusion, mise à jour par identifiant externe ou restauration complète. L’aperçu précède toute application ; l’action peut être annulée.
7. Passer en Publication pour SVG, PNG, HTML statique et dossier PDF via l’impression du navigateur.

Les dates inconnues restent inconnues. Les anciennes données V1/V2 sont migrées sur copie ; les anciennes clés locales restent intactes. Les propriétés et nuances perdues dans les formats externes sont annoncées. Les médias distants ne sont jamais chargés automatiquement.

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
- [Bilan final et performances](REPORT_3_0.md)

Les livraisons V2 originale et 2.1 sont conservées dans `backup/chronea/`. Aucun script ne fait de commit ou push.
