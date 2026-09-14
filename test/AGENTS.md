# Instructions QA et non-régression pour Noon

Les règles de `AGENTS.md` situé à la racine restent applicables. Ce fichier ajoute des contraintes spécifiques aux tests et à la validation. `AGENTS_ARCHITECTURE.md` décrit les agents internes de Noon et ne doit pas être remplacé par ce fichier. En cas de règle plus restrictive ici, respecter la règle la plus restrictive.

## Discipline de test

- Ne jamais modifier un test uniquement pour faire disparaître un échec.
- Rechercher d’abord si l’échec révèle une vraie régression ou une hypothèse devenue fausse.
- Privilégier le test le plus ciblé pendant le développement.
- Élargir ensuite les tests selon l’impact du changement.
- Utiliser les scripts déjà présents dans `package.json`.
- Ne jamais inventer un résultat de test.
- `PASS` signifie que la commande a réellement réussi.
- Documenter ce qui n’a pas pu être testé.

Toujours distinguer explicitement :

- test automatisé ;
- test manuel ;
- test matériel ;
- test Electron ;
- test de l’application packagée.

Tester les fonctionnalités voisines d’un système modifié, pas uniquement le chemin nominal directement touché.

## Commandes et couverture

Selon le contexte et l’impact, prendre notamment en compte les commandes existantes : `npm run lint`, `npm run eval:critical`, `npm test`, `npm run noon:check` et `npm run build`. Utiliser aussi les évaluations spécialisées déjà définies dans `package.json` lorsque le sous-système concerné le justifie.

Ne pas lancer inutilement toutes les suites à chaque petite modification; choisir d’abord une validation ciblée, puis élargir de manière justifiée.
