# Proxy API optionnel

Un proxy serverless peut etre utilise par un organisme qui veut interroger France Travail sans passer par GitHub Actions.

Options possibles :

- Cloudflare Worker ;
- Netlify Function ;
- Vercel Function ;
- serveur interne d'organisme.

## Role du proxy

Le proxy garde `FT_CLIENT_SECRET` cote serveur, obtient un token France Travail, appelle les endpoints ROME autorises, puis renvoie seulement des donnees normalisees ou un JSON public sans secret.

## Ce que le front-end ne doit pas faire

- ne pas contenir le Client Secret ;
- ne pas stocker un token dans localStorage ;
- ne pas envoyer le profil utilisateur a France Travail ;
- ne pas rendre l'API obligatoire pour utiliser Boussole Pro.

Si un Client Secret a ete partage dans un outil externe, une conversation ou un depot, il est recommande de le regenerer dans France Travail IO avant usage durable.

## Flux conseille

1. Le proxy lit ses secrets depuis l'environnement serveur.
2. Le proxy appelle France Travail.
3. Le proxy normalise ou transmet un corpus.
4. Boussole Pro importe le JSON ou charge un fichier statique genere.

Cette version v0.2.alpha ne fournit pas de proxy finalise. Elle documente l'architecture pour une version organisme.
