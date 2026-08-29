# Inventaire des tests Noon

## Niveaux

1. Les tests `node:test` sous `test/` valident les fonctions et moteurs isolés.
2. Les tests d'intégration couvrent l'orchestrateur, la persistance, les routes et les contrats Electron.
3. `Noon Evaluation Engine` rejoue des scénarios transverses, compare une baseline et applique les quality gates.

## Carte des dépendances évaluées

| Domaine | Composant principal | Couverture |
| --- | --- | --- |
| Mémoire et contexte | `services/memory`, `services/context` | tests unitaires + contrats d'isolation |
| Routage | `lib/noon-intelligence.js` | corpus Luna/Terra/Sol + evals réelles du routeur |
| Recherche et synthèse | `services/search`, `services/synthesis` | tests moteurs + provenance/scoping |
| Intentions et approvals | `services/intents`, `services/approvals` | tests moteurs + invariants critiques |
| Sécurité et exécution | `services/security`, `services/execution` | tests transactionnels + tolérance zéro |
| Planning, brief, proactif | services dédiés | tests déterministes hors ligne |
| Artefacts et voix | `services/artifacts`, `services/voice` | contrats de preview et identité stable |
| Fiabilité, performance, coût | moteurs dédiés + evals | dégradation, latence et zéro appel live |

Les trous à traiter ensuite concernent surtout les évaluations live opt-in, les mesures de qualité sémantique avec juge externe et les performances sur corpus volumineux. Ils restent séparés de la suite locale afin d'éviter coût, nondéterminisme et fuite de données.
