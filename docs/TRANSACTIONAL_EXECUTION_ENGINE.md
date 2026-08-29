# Transactional Execution Engine

## Rôle

Le moteur transforme une action déjà qualifiée par l'Orchestrator et la politique
de sécurité en exécution fiable. Il ne remplace ni l'intention, ni la politique,
ni l'approbation, ni les handlers du `SkillRegistry`.

```text
Intent → Policy → Approval → Plan → Preconditions → Execute → Verify → Journal
```

« Transactionnel » signifie ici journalisation, idempotence, vérification,
résultat partiel et compensation bornée. Noon ne prétend pas fournir une
transaction distribuée atomique sur Gmail, Calendar, Git ou le filesystem.

## Source de vérité

| Responsabilité | Service canonique |
|---|---|
| Intention | `IntentCommandEngine` |
| Décision métier | `NoonOrchestrator` |
| Autorisation | `OperationalSecurityPolicy` |
| Approbation exacte | `ApprovalEngine` |
| Plan et cycle d'exécution | `TransactionalExecutionEngine` |
| Handlers et schémas | `SkillRegistry` |
| Retryabilité et circuits | `ReliabilityEngine` |
| Journal | `TransactionalExecutionRepository` |

## Modèle

Une `ExecutionRequest` référence l'intention, l'ActionRequest, la PolicyDecision,
l'approbation, le profil, le workspace, le projet, la session et la conversation.

Le plan immuable contient :

- une version et une empreinte ;
- des étapes aux identifiants uniques ;
- les dépendances ;
- une politique d'échec ;
- une atomicité explicitement `best_effort`.

Chaque étape contient le skill, l'opération, les arguments en mémoire, leur
empreinte persistée, une clé d'idempotence, les préconditions, la vérification,
la compensation éventuelle et la classe d'action.

## Journal et confidentialité

SQLite stocke uniquement les identifiants, empreintes, états, timestamps,
références pseudonymisées et reason codes. Aucun argument brut, corps d'e-mail,
contenu de fichier, token ou credential n'est écrit dans ce journal.

Le fallback JSON suit le même modèle. Une mutation n'est pas lancée si le
checkpoint critique initial ne peut pas être écrit.

## États

Exécution : `PLANNED`, `VALIDATING`, `AWAITING_APPROVAL`, `READY`, `RUNNING`,
`VERIFYING`, `SUCCEEDED`, `PARTIAL`, `FAILED`, `UNKNOWN_OUTCOME`, `INTERRUPTED`,
`COMPENSATING`, `COMPENSATED`, `CANCELLED`.

Étape : `PENDING`, `READY`, `RUNNING`, `APPLIED`, `VERIFYING`, `SUCCEEDED`,
`FAILED`, `UNKNOWN_OUTCOME`, `SKIPPED`, `SKIPPED_DEPENDENCY`, `COMPENSATED`.

`APPLIED` n'est jamais synonyme de `VERIFIED`.

## Idempotence et retries

Une même action exacte conserve la même clé lors d'une reprise. Un nouvel ordre
utilisateur possède une nouvelle exécution. Deux appels simultanés avec le même
`executionId` partagent la même Promise et une exécution terminale n'est pas
rejouée.

Les retries sont exclusivement délégués au `ReliabilityEngine` :

- lectures : retries bornés possibles ;
- écriture prouvée idempotente : retry borné possible ;
- mutation non idempotente : aucun retry aveugle ;
- effet distant incertain : `UNKNOWN_OUTCOME` puis vérification/récupération.

## Vérification

Niveaux : `NONE`, `BASIC`, `STRONG`. Le succès final exige le niveau demandé.
Les stratégies peuvent utiliser la réponse autoritative du provider, un
read-after-write, une comparaison de hash, une validation d'artefact ou une
comparaison d'état distant.

## Échecs, résultats partiels et compensation

Politiques : `STOP`, `CONTINUE_INDEPENDENT`, `RETURN_PARTIAL`, `COMPENSATE`.
Le résultat liste séparément les étapes réussies, échouées, compensées, ignorées
et en récupération.

Une compensation automatique est permise uniquement si elle est déclarée à
l'avance, `autoSafe`, vise une cible créée par la même exécution et repasse par
la validation de sécurité. Un e-mail envoyé n'est jamais compensé. Une suppression
Calendar visible n'est pas automatique sans politique exacte.

## Crash et redémarrage

Au démarrage, les exécutions `RUNNING`, `VERIFYING` ou `COMPENSATING` deviennent
`INTERRUPTED`. Leurs étapes actives deviennent `UNKNOWN_OUTCOME`. Aucune mutation
n'est rejouée automatiquement. Une future procédure de récupération doit vérifier
le provider avant toute nouvelle tentative.

## Migration

Les mutations provenant du tool loop de `NoonOrchestrator` passent maintenant par
le moteur. Les lectures restent sur le chemin léger. Les connecteurs et
l'ArtifactEngine conservent leurs garde-fous et idempotences locales comme défense
en profondeur. Les écritures directes hors tool loop seront migrées progressivement
après parité et tests dédiés.
