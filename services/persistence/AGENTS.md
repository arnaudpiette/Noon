# Instructions mémoire et persistance pour Noon

Les règles de `AGENTS.md` situé à la racine restent applicables. Ce fichier ajoute des contraintes spécifiques à la mémoire et aux données persistantes. `AGENTS_ARCHITECTURE.md` décrit les agents internes de Noon et ne doit pas être remplacé par ce fichier. En cas de règle plus restrictive ici, respecter la règle la plus restrictive.

## Préservation des données

- Ne provoquer aucune perte de données utilisateur.
- Ne jamais supprimer une base pour résoudre facilement un bug.
- Préserver les anciennes données et l’isolation entre conversations et contextes.
- Toute migration doit être idempotente autant que possible.
- Penser au redémarrage de l’application et vérifier le comportement réel après redémarrage.
- Sauvegarder avant toute migration destructive.
- Prévoir un rollback ou une récupération lorsque nécessaire.
- La mémoire personnelle doit rester locale conformément à l’architecture Noon.
- Une mémoire corrigée ne doit pas réapparaître sous son ancienne forme.
- Une mémoire oubliée ne doit pas ressusciter après redémarrage ou migration.
- Distinguer mémoire candidate, confirmée, corrigée et oubliée lorsque l’architecture le prévoit.
- Ne mettre aucune donnée privée dans Git.
- Ne pas remplacer un stockage existant sans analyser la migration nécessaire.
- Vérifier les repositories et services de persistance existants avant de créer un système parallèle.

## Préconditions de schéma et stockage

Avant toute modification de schéma ou de stockage, identifier explicitement :

1. les données existantes ;
2. le format actuel ;
3. la migration ;
4. la sauvegarde ;
5. la compatibilité descendante ;
6. les tests ;
7. le comportement après redémarrage.
