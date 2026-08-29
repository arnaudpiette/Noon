# Execution Tracking Engine

Le suivi d’exécution sépare strictement ce qui était prévu de ce qui est réellement prouvé. Un bloc Calendar écoulé devient `unknown` et jamais `completed` sans preuve supplémentaire.

## États et preuves

La machine d’état utilise `planned`, `in_progress`, `completed`, `missed`, `delayed`, `blocked`, `cancelled`, `deferred` et `unknown`. Les preuves reconnues sont les confirmations explicites, Reminders terminés, résultats exacts d’outils, états projet autorisés, annotations Noon et sessions Focus. Une session Focus ne prouve jamais la fin.

`completed` et `cancelled` sont terminaux sans réouverture explicite. Les mises à jour portent une version optimiste et une clé d’événement idempotente.

## Dérive

Le moteur détecte `START_DELAY`, `OVERRUN`, `UNCONFIRMED_BLOCK`, `MISSED_BLOCK`, `BLOCKED`, `DEFERRED`, `MANUAL_MOVE`, `DEPENDENCY_DELAY` et `CAPACITY_LOSS`. La sévérité mesure l’impact sur le plan ; elle ne remplace pas le score du Priority Engine.

Les retards faibles restent silencieux. Une dérive importante devient un signal local du Proactive Engine, qui peut demander au Planning Engine un replan minimal. Aucun Calendar n’est modifié directement.

## Persistance et confidentialité

Les états, événements techniques et statistiques de durée utilisent la base personnelle SQLite existante. Les journaux excluent titres, contenus de notes, e-mails et fichiers. Les profils restent séparés par `subjectScope`. Les événements détaillés terminés ont une rétention configurable de 90 jours.

## Durées

Les durées réelles ne sont calculées que lorsque `actualStart`, `actualEnd` et une preuve suffisamment fiable existent. Moyenne, médiane, erreur moyenne et nombre d’échantillons restent locaux. Une préférence permanente ne peut être créée que par le Memory Engine et son workflow de validation.
