# Agent Evaluation Engine V1

## Rôle

`AgentEvaluationEngine` évalue le résultat réel d'une exécution agentique à partir de preuves structurées.

Il est distinct du `NoonEvaluationEngine`, qui reste dédié aux scénarios comportementaux hors ligne, aux baselines et aux release gates.

## Autorité

Ordre de confiance :

1. validations déterministes ;
2. état système vérifié ;
3. confirmation humaine ;
4. déclaration de l'agent.

Une déclaration `SUCCESS` ou `PASS` de l'agent n'est jamais suffisante pour satisfaire une preuve obligatoire.

Un échec déterministe critique ne peut jamais être transformé en `PASS`.

## Verdicts

- `PASS`
- `PARTIAL`
- `FAIL`
- `INSUFFICIENT_EVIDENCE`

## V1

V1 est :

- déterministe ;
- local ;
- sans provider ;
- sans persistence ;
- sans retry automatique ;
- sans side effect ;
- sans changement de modèle ;
- sans autorité sur l'Execution Engine.

Il consomme uniquement des métadonnées bornées : identifiants, statuts, autorités et reason codes.

Aucun prompt, contenu utilisateur, stdout/stderr complet, secret ou raisonnement interne n'est conservé dans le résultat.

## Intégration future

Le wiring runtime devra se faire après la production des preuves déterministes et avant l'annonce user-facing d'un succès.

Les validations existantes restent sources de vérité. `AgentEvaluationEngine` les agrège mais ne les remplace pas.

Le résultat pourra ensuite être consommé par :

- Progress & Observability ;
- NoonOrchestrator ;
- Goal Engine ;
- Learning / Adaptive Routing.

Ces consommateurs ne sont pas raccordés dans V1.
