# Instructions sécurité pour Noon

Les règles de `AGENTS.md` situé à la racine restent applicables. Ce fichier ajoute des contraintes spécifiques à la sécurité. `AGENTS_ARCHITECTURE.md` décrit les agents internes de Noon et ne doit pas être remplacé par ce fichier. En cas de règle plus restrictive ici, respecter la règle la plus restrictive.

## Règles obligatoires

- Appliquer le local-first par défaut.
- Ne jamais exposer de secret dans les logs, traces, erreurs ou événements d’observabilité.
- Ne jamais hardcoder une clé API.
- Ne jamais ajouter de token OAuth ou de mot de passe dans Git.
- Ne jamais stocker de secret dans `localStorage`.
- Respecter `safeStorage` lorsque l’architecture Noon l’utilise.
- Respecter les systèmes existants d’approbation.
- Maintenir deux niveaux de permission distincts pour la lecture externe et l’écriture externe.
- Aucune écriture distante silencieuse.
- Ne jamais désactiver une protection simplement pour faire passer un test.
- Réduire les données privées envoyées à un service distant au strict nécessaire.
- Préserver les règles de confidentialité existantes.
- Respecter `PERMISSIONS_AND_APPROVALS.md` et `PRIVACY_AND_PERMISSIONS.md` lorsqu’ils sont pertinents.
- Ne permettre à aucun sous-système de contourner les permissions via une autre API.
- Les messages d’erreur et les logs ne doivent jamais exposer de secrets, tokens, données privées ou chemins sensibles.

En cas de doute entre facilité de développement et protection des données utilisateur, choisir l’option la plus restrictive et signaler le problème.
