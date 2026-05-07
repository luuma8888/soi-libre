# AGENTS.md — Instructions Codex pour les applications web offline de Lu’uma

# 1. Intention générale

Ce dépôt sert à créer, corriger, enrichir ou maintenir des applications web autonomes, sobres, lumineuses, ergonomiques et consultables hors-ligne.

Les applications doivent être pensées comme des outils pratiques, clairs, doux à utiliser, mais aussi solides techniquement. Elles doivent guider l’être humain pas à pas, sans l’écraser sous la complexité.

Le style recherché : simple, propre, fiable, sensible, pédagogique, maintenable, évolutif, avec une esthétique pastel, positive, apaisante et symboliquement reliée au thème de l’application.

# 2. Règles fondamentales non négociables

Sauf demande explicite contraire de l’utilisateur, toute application web créée ou modifiée doit respecter ces règles :

- Application web single-page.
- Un seul fichier HTML autonome.
- Aucun CDN.
- Aucune dépendance externe obligatoire.
- Fonctionnement hors-ligne.
- Tout le HTML, CSS, JavaScript, SVG, données de démonstration et petites ressources nécessaires doivent être inclus dans le fichier.
- Pas d’appel réseau au démarrage.
- Pas d’API externe.
- Pas de tracking.
- Pas de télémétrie.
- Pas de chargement de police externe.
- Pas de framework externe type React, Vue, Angular, Bootstrap, Tailwind via CDN, etc.
- JavaScript simple, lisible, commenté, maintenable.
- CSS intégré dans `<style>`.
- JavaScript intégré dans `<script>`.
- Icônes SVG inline ou dessinées en CSS.
- Données internes en objets JavaScript ou JSON intégré.
- Sauvegarde locale avec `localStorage`.
- Export JSON.
- Import JSON.
- Mode jour/nuit.
- CSS d’impression.
- Interface responsive desktop/tablette/mobile.
- Préserver la sobriété et la clarté avant d’ajouter des effets décoratifs.

Si une demande nécessite vraiment plusieurs fichiers, une dépendance externe ou une architecture plus lourde, l’indiquer clairement avant modification et proposer d’abord une solution compatible avec le format autonome.

# 3. Manière de travailler avec Git

Codex doit respecter strictement la branche de travail prévue.

Avant de modifier le code :

- Vérifier la branche courante avec `git branch --show-current`.
- Vérifier l’état du dépôt avec `git status -sb`.
- Lire ce fichier `AGENTS.md`.
- Ne jamais modifier directement `main` ou `master`, sauf demande explicite.
- Ne jamais faire de commit sans demande explicite.
- Ne jamais faire de push sans demande explicite.
- Ne jamais réécrire l’historique Git sans demande explicite.
- Ne jamais supprimer de fichier important sans expliquer pourquoi.

Après modification :

- Afficher ou résumer les fichiers changés.
- Résumer les changements importants.
- Mentionner les risques possibles.
- Recommander les tests à lancer.
- Inviter à relire le diff avant commit.

# 4. Philosophie UX

L’application doit aider l’utilisateur à avancer sans fatigue mentale.

Priorités UX :

- Une interface claire dès l’ouverture.
- Un chemin naturel : comprendre, remplir, visualiser, sauvegarder, exporter, imprimer.
- Des libellés humains, pas trop techniques.
- Des boutons visibles et explicites.
- Des états vides utiles : expliquer quoi faire au lieu d’afficher une zone vide.
- Des messages de confirmation doux mais précis.
- Des alertes non agressives.
- Une progression étape par étape lorsque le sujet est complexe.
- Un mode “vue synthèse” lorsque beaucoup d’informations sont saisies.
- Un mode impression lisible et propre.
- Une navigation utilisable sur smartphone.

Éviter :

- Interfaces trop denses.
- Trop d’onglets sans orientation.
- Scores froids ou verdicts définitifs.
- Jargon inutile.
- Tableaux trop larges sur mobile.
- Boutons ambigus comme “OK” ou “Valider” sans contexte.
- Icônes seules sans texte ou `aria-label`.

# 5. Langage et posture de l’application

Lorsque l’application accompagne l’humain, elle doit guider plutôt qu’étiqueter.

Préférer des formulations comme :

- “hypothèse à vérifier”
- “piste possible”
- “prochaine marche”
- “pilier à nourrir”
- “point d’attention”
- “ressource disponible”
- “observation”
- “éclairage”
- “suggestion”
- “à ajuster selon le terrain”

Éviter les formulations trop définitives :

- “diagnostic certain”
- “vérité absolue”
- “profil figé”
- “score final”
- “tu es comme ça”
- “échec”
- “mauvais résultat”

Utiliser de préférence le mot “être” plutôt que “personne” quand on parle d’un humain, sauf dans un contexte technique où “personne” est nécessaire.

# 6. Structure recommandée du fichier HTML

Pour un nouveau fichier, utiliser une structure claire et maintenable :

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nom de l’application</title>
  <style>
    /* =========================================================
       1. Design tokens
       2. Reset léger
       3. Layout général
       4. Composants
       5. Formulaires
       6. États / toasts / modales
       7. Responsive
       8. Mode sombre
       9. Impression
       ========================================================= */
  </style>
</head>
<body>
  <div id="app"></div>

  <script>
    /*
      Architecture suggérée :
      - CONFIG
      - I18N
      - DEFAULT_DATA
      - State
      - Store
      - Model
      - View
      - Controller
      - ImportExport
      - Print
      - App initialization
    */
  </script>
</body>
</html>
```

Dans le JavaScript, privilégier une organisation de ce type :
```
const App = {
  config: {},
  i18n: {},
  state: {},
  data: {},
  store: {},
  model: {},
  view: {},
  controller: {},
  importExport: {},
  print: {},
  init() {}
};
```

Ne pas disperser la logique partout. Éviter le code spaghetti. Même dans un fichier unique, l’architecture doit rester lisible.

# 7. Design visuel

Le design doit être clair par défaut, lumineux, doux et apaisant.

Préférences :

Couleurs pastel.
Contraste suffisant.
Fond clair doux, jamais blanc agressif pur si possible.
Mode sombre confortable.
Couleurs symboliquement reliées au thème :
nature : vert doux, mousse, sauge, terre claire ;
eau/source : bleu pâle, turquoise doux ;
joie/paix : doré léger, crème, rose très doux ;
ciel/galactique : indigo doux, bleu nuit, argent léger ;
pédagogie/enfance : couleurs chaleureuses, rassurantes, lisibles.
Coins arrondis.
Espacements généreux.
Cartes lisibles.
Ombres très légères.
Animations discrètes, jamais indispensables.

Éviter :

Couleurs criardes.
Trop de dégradés.
Effets “waouh” au détriment de la lisibilité.
Trop d’icônes décoratives.
Apparence trop froide ou administrative.
Interfaces sombres par défaut, sauf thème explicitement nocturne.

# 8. Accessibilité

Toute application doit être utilisable avec confort.

À respecter :

button pour les actions, pas des div cliquables.
Labels associés aux champs.
Focus visible.
Contraste lisible.
Taille de police confortable.
Navigation clavier raisonnable.
aria-label si une icône seule est utilisée.
Messages d’erreur compréhensibles.
Ne pas dépendre uniquement de la couleur pour transmettre une information.
Prévoir une mise en page mobile correcte.
Ne pas bloquer l’usage si localStorage est indisponible ; afficher une explication.

Option appréciée quand pertinent :

Mode contraste renforcé.
Mode police plus lisible.
Taille de texte ajustable.
Réduction des animations.

# 9. Sauvegarde locale

Toute application doit inclure une sauvegarde locale robuste.

Règles :

Utiliser localStorage.
Sauvegarder automatiquement les données importantes.
Afficher une indication du dernier enregistrement si pertinent.
Prévoir une fonction “réinitialiser”.
Prévoir une confirmation avant suppression massive.
Ne pas stocker de secrets.
Ne pas stocker d’informations sensibles non nécessaires.
Utiliser une clé de stockage claire et versionnée.

Exemple :
```
const STORAGE_KEY = "luuma_app_nom_v1";
```

La structure sauvegardée doit idéalement contenir :
```
{
  "app": "nom-application",
  "version": "1.0.0",
  "updatedAt": "2026-05-07T00:00:00.000Z",
  "settings": {},
  "data": {}
}
```

Prévoir une migration simple si la structure évolue.

# 10. Export / import JSON

Toute application doit permettre :

Exporter les données en JSON.
Importer un JSON précédemment exporté.
Vérifier le format avant import.
Prévenir avant de remplacer les données existantes.
Gérer les erreurs d’import avec un message clair.
Ne pas planter si le JSON est incomplet.
Garder une compatibilité raisonnable avec les anciennes versions.

Lorsque l’application utilise des “packs” de contenu, préférer :

Packs JSON importables.
Packs séparés du moteur logique.
Contenu éditable sans devoir modifier le code principal.
Possibilité de sélectionner ce qu’on importe.
Déduplication si possible.
Messages clairs après import.

Un pack JSON devrait être pensé comme du contenu, pas comme du code.

# 11. Impression

Toute application doit prévoir un CSS d’impression.

Objectifs :

Impression propre.
Fond blanc ou très clair.
Texte noir ou très lisible.
Masquer les boutons, menus, toasts, contrôles inutiles.
Éviter les coupures laides.
Prévoir l’impression de l’onglet courant.
Prévoir si possible l’impression de l’ensemble des onglets ou sections.
Ajouter des titres clairs.
Conserver les informations essentielles.

Exemple CSS attendu :
```
@media print {
  .no-print,
  nav,
  button,
  .toolbar {
    display: none !important;
  }

  body {
    background: #fff !important;
    color: #111 !important;
  }

  .print-section {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
```

Si l’application a plusieurs onglets, prévoir un mécanisme du type :

print-current
print-all

# 12. Internationalisation

Même si l’application est d’abord en français, prévoir une structure compatible avec l’internationalisation.

Recommandation :
```
const I18N = {
  fr: {
    appTitle: "Titre",
    save: "Sauvegarder",
    export: "Exporter",
    import: "Importer"
  }
};
```

Éviter de disperser tous les textes importants directement dans les fonctions. Pour une petite application, il est acceptable de garder certains textes statiques en HTML, mais les textes récurrents, boutons, messages et libellés importants doivent être faciles à retrouver.

# 13. Données, modèles et contenus

Pour les applications riches en contenu :

Séparer les données de référence de la logique.
Utiliser des structures JSON lisibles.
Prévoir des identifiants stables.
Prévoir des catégories.
Prévoir des tags si utile.
Prévoir des champs title, description, notes, createdAt, updatedAt lorsque pertinent.
Éviter les données dupliquées.
Prévoir des exemples de démonstration sobres.

Pour les contenus pédagogiques, spirituels, symboliques ou alternatifs :

Présenter comme pistes, hypothèses, inspirations ou éclairages.
Ne pas imposer de vérité unique.
Distinguer clairement observation, interprétation, proposition et action concrète.
Pour les sujets sensibles, ajouter une prudence claire et protectrice.
Ne pas donner de conseils médicaux, juridiques ou financiers comme certitudes professionnelles.

# 14. Sécurité et confidentialité

L’application doit protéger l’utilisateur.

Règles :

Tout reste local par défaut.
Aucun envoi de données.
Aucun tracking.
Pas de script tiers.
Pas de dépendance externe.
Pas de clé API dans le code.
Pas de secret dans le dépôt.
Ne pas inventer de chiffrement si non demandé.
Si une option de confidentialité est utile, proposer :
mode “ne rien sauvegarder” ;
suppression rapide des données ;
export manuel ;
avertissement clair sur les données stockées localement.

Pour les données sensibles, prévoir des formulations prudentes et des options de suppression.

# 15. Robustesse JavaScript

Le code doit fonctionner dans un navigateur moderne sans compilation.

À respecter :

Pas de build obligatoire.
Pas de TypeScript obligatoire.
Pas d’import ES module externe.
Pas de dépendance npm dans l’application finale.
Éviter les fonctions trop longues.
Nommer clairement les fonctions.
Encadrer les opérations risquées avec try/catch.
Vérifier l’existence des éléments DOM avant de les manipuler.
Éviter les variables globales dispersées.
Prévoir un fallback si structuredClone n’est pas disponible.
Ne pas casser l’application si une donnée manque.
Gérer les imports JSON invalides.
Ne pas utiliser innerHTML avec des données utilisateur non échappées.
Préférer textContent pour injecter du texte utilisateur.
Si innerHTML est nécessaire pour des templates contrôlés, s’assurer que les données utilisateur sont échappées.

# 16. Performance

Même en fichier unique, l’application doit rester fluide.

Règles :

Éviter les rendus complets inutiles si l’application grossit.
Garder des fonctions de rendu ciblées.
Éviter les écouteurs d’événements dupliqués.
Utiliser la délégation d’événements si pertinent.
Compresser mentalement la complexité avant d’ajouter une fonctionnalité.
Ne pas intégrer d’images base64 énormes sans avertir.
Pour les ressources base64, expliquer le poids et les impacts.

# 17. Responsive mobile

Toute interface doit être pensée pour mobile.

À vérifier :

Les onglets ne débordent pas.
Les tableaux deviennent lisibles, scrollables ou transformés en cartes.
Les boutons restent accessibles.
Les formulaires sont confortables.
La taille de texte reste lisible.
Les zones importantes ne sont pas trop petites.
Les modales ne dépassent pas l’écran.
Les barres d’action restent utilisables.

Si une section est trop complexe pour mobile, proposer une version “cartes” ou “vue synthèse”.

# 18. Types de fonctionnalités souvent attendues

Quand le sujet s’y prête, proposer ou préserver :

Tableau de bord.
Vue d’ensemble.
Onglets thématiques.
Mode question par question.
Checklists.
Priorités.
Filtres.
Recherche.
Tags.
Notes libres.
Favoris.
Progression douce.
Journal ou historique.
Export JSON.
Import JSON.
Impression de la vue courante.
Impression complète.
Données de démonstration.
Aide intégrée.
Bouton “Pourquoi cette question ?”
Bouton “Autre angle” si l’application guide un processus intérieur ou créatif.
Bouton “Question trop floue” si l’application pose des questions.
Bouton “Question trop forte” si l’application touche à l’intime ou au sensible.

Ne pas ajouter toutes ces fonctions automatiquement. Les choisir selon le thème, la simplicité et l’utilité réelle.

# 19. Applications pour enfants, pédagogie ou accompagnement

Quand l’application touche aux enfants, à l’éducation ou à la transmission :

Prioriser la protection, la joie, la paix, la clarté et le respect du rythme.
Éviter les étiquettes figées.
Ne pas réduire un enfant à un score.
Préférer l’observation fine.
Distinguer faits observés, hypothèses, besoins possibles et prochaines actions.
Proposer des formulations bienveillantes.
Préserver la liberté intérieure de l’enfant.
Prévoir des conseils concrets, simples et applicables.
Ne pas surcharger l’enseignant ou l’accompagnant.

Préférer des mots comme :

“observation”
“besoin possible”
“piste d’accompagnement”
“rythme”
“ressource”
“élan”
“prochaine marche”

# 20. Applications créatives

Quand l’application accompagne l’écriture, la création, les histoires, les jeux, la comédie musicale, les cartes ou les projets imaginaires :

Prévoir une progression étape par étape.
Prévoir une vue synthèse.
Prévoir des modèles.
Prévoir des champs libres.
Prévoir des exemples inspirants mais non envahissants.
Permettre de travailler par fragments.
Permettre l’export/impression d’un dossier clair.
Préserver l’âme du projet avant les détails techniques.
Favoriser la joie, le jeu, le mouvement, l’imaginaire et la cohérence.

# 21. Applications avec calculs ou estimations

Quand l’application calcule des besoins, quantités, durées, priorités ou ressources :

Séparer clairement les constantes de calcul.
Expliquer les hypothèses.
Permettre l’ajustement des paramètres.
Ne pas présenter les résultats comme absolus.
Afficher les unités.
Arrondir de manière lisible.
Indiquer les marges ou limites.
Prévoir une synthèse imprimable.
Tester plusieurs cas simples.

Pour les sujets de préparation, autonomie ou survie :

Prioriser l’eau, la sécurité, l’abri, la nourriture, la santé, l’hygiène, l’organisation, la paix collective.
Ne pas oublier l’aspect joie, coopération, clarté relationnelle et équilibre émotionnel.
Éviter les conseils dangereux ou illégaux.
Favoriser les actions concrètes, sobres et protectrices.

# 22. Versioning interne

Quand une version est demandée :

Conserver les fonctionnalités existantes sauf demande contraire.
Ajouter une mention de version visible ou dans les métadonnées.
Documenter brièvement les nouveautés.
Ne pas casser les anciens exports JSON si possible.
Prévoir une fonction de migration simple si le format de données change.

Exemple :
```
const APP_VERSION = "1.3.0";
```

# 23. Commentaires dans le code

Les commentaires doivent aider un développeur humain.

À faire :

Commenter les grandes sections.
Expliquer les choix d’architecture.
Expliquer les structures de données.
Expliquer les fonctions critiques.
Expliquer les zones faciles à enrichir.
Ajouter des repères comme :
// CONFIG
// DATA MODEL
// STORAGE
// RENDERING
// CONTROLLERS
// IMPORT / EXPORT
// PRINT

À éviter :

Commentaires inutiles sur chaque ligne.
Commentaires qui répètent exactement le code.
Blocs trop longs et vagues.

# 24. Procédure avant modification

Avant d’écrire du code, Codex doit :

Lire la demande.
Vérifier la branche.
Vérifier git status.
Identifier le fichier principal.
Lire les zones concernées.
Résumer le plan en quelques points.
Indiquer les risques s’il y en a.
Modifier seulement ce qui est nécessaire.

Pour une correction de bug :

Reproduire mentalement ou techniquement le bug.
Identifier la cause probable.
Corriger minimalement.
Vérifier qu’aucune fonctionnalité proche n’est cassée.

Pour une nouvelle version :

Préserver l’existant.
Intégrer les améliorations de manière cohérente.
Mettre à jour le numéro de version.
Mettre à jour l’aide intégrée si nécessaire.
Vérifier sauvegarde, export, import, impression et thème.

# 25. Procédure après modification

Après toute modification, Codex doit fournir :

Fichiers modifiés.
Résumé clair des changements.
Points à tester.
Risques ou limites.
Commandes utiles si elles existent.
État Git attendu.

Ne pas faire de commit automatiquement.

# 26. Checklist de test manuel obligatoire

Après modification d’une application HTML offline, vérifier au minimum :

L’application s’ouvre sans erreur console.
Le mode jour/nuit fonctionne.
La sauvegarde localStorage fonctionne.
Le rechargement de page conserve les données.
L’export JSON télécharge un fichier.
L’import JSON restaure les données.
L’impression de la vue courante est propre.
L’impression complète est propre si disponible.
Le responsive mobile ne casse pas la navigation.
Les boutons principaux sont visibles.
Les textes restent lisibles.
Les champs principaux fonctionnent.
Aucun appel réseau n’est nécessaire.
Aucun CDN n’est utilisé.
Aucun secret n’est présent dans le code.

# 27. Commandes utiles

Comme les applications sont généralement des fichiers HTML autonomes, il peut ne pas y avoir de build.

Commandes possibles selon le dépôt :

git status -sb
python3 -m http.server 8000

Puis ouvrir :

http://localhost:8000

Si aucun serveur local n’est nécessaire, ouvrir directement le fichier HTML dans le navigateur.

Si des tests spécifiques existent dans le dépôt, les lire dans le README avant d’en proposer de nouveaux.

# 28. Interdictions spécifiques

Ne pas faire ceci sans demande explicite :

Transformer l’application en projet React/Vue/Angular.
Ajouter Vite/Webpack/Parcel.
Ajouter Tailwind via CDN.
Ajouter Bootstrap via CDN.
Ajouter une police Google Fonts.
Ajouter une dépendance npm.
Séparer l’application en plusieurs fichiers.
Retirer le mode offline.
Retirer localStorage.
Retirer export/import JSON.
Retirer le CSS print.
Retirer le mode jour/nuit.
Ajouter des appels réseau.
Ajouter analytics/tracking.
Changer brutalement le style visuel.
Réécrire toute l’application alors qu’une correction ciblée suffit.
Remplacer un moteur simple par une architecture trop complexe.

# 29. Ce qu’il faut privilégier

Privilégier :

Simplicité robuste.
Lisibilité.
Code autonome.
Architecture claire.
Design doux.
Ergonomie mobile.
Données exportables.
Respect de la vie privée.
Progression pas à pas.
Vues synthétiques.
Impression utile.
Contenu structuré.
Commentaires utiles.
Petites améliorations cohérentes.
Refactorisation progressive plutôt que grand chamboulement.

# 30. Ton attendu dans les réponses de Codex

Répondre en français, clairement, avec un ton naturel, précis et encourageant.

Éviter :

Trop de jargon.
Réponses trop sèches.
Optimisme vague.
Longues explications inutiles.
Promesses non vérifiées.

Préférer :

“J’ai corrigé…”
“J’ai préservé…”
“Le point à vérifier est…”
“La limite actuelle est…”
“Je recommande de tester…”

# 31. Définition d’un travail terminé

Un travail est considéré terminé seulement si :

La demande principale est traitée.
Le fichier reste autonome et offline.
Les fonctionnalités essentielles sont préservées.
Le code ne dépend d’aucun CDN.
La sauvegarde locale n’est pas cassée.
L’export/import JSON n’est pas cassé.
Le mode jour/nuit n’est pas cassé.
L’impression n’est pas cassée.
Le responsive reste utilisable.
Les changements sont résumés clairement.
Les limites sont indiquées honnêtement.
Aucun commit/push n’a été fait sans demande explicite.
