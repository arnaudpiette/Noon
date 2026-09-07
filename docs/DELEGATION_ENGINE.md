# Delegation Engine — étape 32

## Principe

Noon reste l’unique assistant, orchestrateur et détenteur d’autorité. Le
`DelegationEngine` peut répartir du raisonnement entre des spécialistes
éphémères, mais aucun spécialiste ne possède de mémoire, permission,
credential, outil, token d’approbation ou capacité d’écriture autonome.

Le rollout par défaut est `SHADOW` : la décision et le plan sont mesurés sans
appel spécialiste supplémentaire. Les modes `LIMITED` et `ON` peuvent être
activés via le Feature Flag `delegation.engine`. Le kill switch ramène
immédiatement les nouvelles demandes au chemin Noon direct.

## Audit de l’existant

- `lib/agent-router.js` : ancien routeur conceptuel Mail, Planning,
  OpenClassrooms, DEV et Design. Il n’est pas intégré à la nouvelle façade,
  car il confond spécialistes et outils. Il reste présent pour ne pas casser
  de compatibilité historique.
- `lib/codex-bridge.js` et `skills/codex/analyze-project.js` : pont Codex
  éphémère, limité au Focus et lancé en sandbox `read-only`. Il est conservé
  comme capacité DEV existante du pipeline officiel de Noon. Il ne devient
  pas une autorité du `DelegationEngine`.
- `services/workflows/dev-workflow.js` : diagnostic, proposition de diff,
  validation et soutenance. Conservé.
- `services/workflows/da-workflow.js` : analyse de brief et axes créatifs.
  Conservé.
- `PublicResearchEngine`, `PersonalSearchEngine`, `MultimodalEngine`,
  `MultiSourceSynthesisEngine` et `ArtifactEngine` restent les moteurs
  canoniques. Les spécialistes n’en créent aucun doublon.

## Composants

| Fichier | Responsabilité |
| --- | --- |
| `specialist-registry.js` | Définitions immuables et versionnées |
| `context-capsule-builder.js` | Capsule need-to-know, remote-safe et isolée |
| `delegation-engine.js` | Décision, plan, budgets, dépendances, runs et validation |
| `noon-orchestrator.js` | Parent, synthèse et retour éventuel vers les outils officiels |

## Spécialistes

- `DEV` : code, architecture, debugging, tests et plan d’implémentation.
- `DA` : direction artistique, UX/UI et analyse visuelle.
- `RESEARCH` : plan de recherche et lecture d’Evidence Packs ; aucun appel Web
  caché.
- `DOCUMENT` : structure et contenu ; aucun DOCX/PDF/PPTX écrit directement.
- `ANALYSIS` : comparaison complexe et diagnostic multi-source lorsque les
  quatre domaines précédents ne suffisent pas.

Chaque définition expose une version, des capacités, des types de preuves
acceptés, un backend indicatif et `authority: ANALYSIS_ONLY`. La liste
`allowedDelegatedOperations` est obligatoirement vide.

## Décision et plan

Les raisons de délégation sont `SPECIALIZED_DOMAIN`, `MULTI_DOMAIN_TASK`,
`PARALLELIZABLE`, `HIGH_COMPLEXITY`, `LARGE_EVIDENCE_SET` et
`ARTIFACT_PREPARATION`. Les raisons de chemin direct sont `SIMPLE_TASK`,
`LOW_EXPECTED_BENEFIT`, `BUDGET_LIMIT`, `PRIVACY_CONSTRAINT`,
`SPECIALIST_UNAVAILABLE`, `MAX_DEPTH` et `FEATURE_DISABLED`.

Les modes sont `NONE`, `SINGLE`, `PARALLEL` et `SEQUENTIAL`. Un document qui
dépend d’une analyse DEV attend son résultat. Une dépendance échouée produit
`SKIPPED`; les autres résultats restent disponibles sous un statut parent
`PARTIAL`. Il n’existe aucun mode swarm.

Une sous-tâche contient `subtaskId`, `parentTaskId`, `specialistId`, objectif,
dépendances, références d’entrée, sortie attendue, budget, priorité et état.
Les états admis sont `PLANNED`, `READY`, `RUNNING`, `COMPLETED`, `FAILED`,
`CANCELLED`, `SKIPPED` et `STALE`.

## Limites

- profondeur maximale : `1` ;
- itérations : `1` ;
- sous-tâches : `3` par défaut, maximum absolu `4` ;
- parallélisme : `2` ;
- un appel modèle maximum par sous-tâche ;
- aucun ToolRequest exécuté par un spécialiste ;
- budget normal par défaut : 12 000 tokens entrants, 4 000 sortants,
  45 secondes et estimation 0,08 USD pour le plan ;
- `ECO`, `PROTECTION` et `BLOCKED` désactivent la délégation ;
- Sol n’est jamais sélectionné du seul fait qu’une délégation existe : chaque
  run passe par le `ModelRouter` central.

Les valeurs `delegation.maxSubtasks`, `delegation.maxParallel` et
`delegation.maxWallTimeMs` sont centralisées dans Runtime Config.

## Capsule de contexte

Une capsule contient les références parent, le workspace, le profil, le mode,
l’objectif, les contraintes, les références de preuves, les faits pertinents
remote-safe, les résumés de dépendances et les exigences de sortie. Elle ne
copie jamais la conversation globale, le workspace complet, les credentials,
les permissions, les mémoires `local_only` ou les données d’un autre profil.

La clé du cache court inclut workspace, profil et empreinte de capsule. Une
modification de l’objectif ou des entrées change l’empreinte. Aucun cache
privé n’est partagé entre workspaces ou profils. Les runs sont éphémères et
ne sont pas repris automatiquement après redémarrage.

## Résultat et sécurité

`SpecialistResult` contient identifiants, statut, résumé, findings typés,
recommandations, références, hypothèses, incertitudes, actions proposées,
ToolRequests proposés, artefacts suggérés et métriques. Le schéma est validé
avant ingestion. Un fait sans preuve est marqué non supporté.

Une ToolRequest a toujours `authority: UNTRUSTED_PROPOSAL` et ne produit
aucun effet avant une approbation utilisateur explicite. Noon applique
**l’option A** : après approbation exacte, la proposition repasse par
`OperationalSecurityPolicy`, les contrôles juste-à-temps de l’Approval
Engine et `TransactionalExecutionEngine`, puis le résultat de l’exécution
est rendu explicitement à l’utilisateur. Une décision `DENY` ou un rejet
utilisateur ne déclenche aucune exécution. Aucun approval token ou credential
n’entre dans une capsule.

Les preuves peuvent contenir des injections de prompt ou de rôle : elles sont
explicitement traitées comme données non fiables. Les prompts complets et les
capsules brutes ne sont pas journalisés.

## Intégrations canoniques

- recherche personnelle → `PersonalSearchEngine` ;
- recherche publique → `PublicResearchEngine` ;
- média → `MultimodalEngine`, puis Evidence Pack pour DA ;
- contradictions → `MultiSourceSynthesisEngine` ou synthèse parent ;
- contenu document → `DOCUMENT`, puis `ArtifactEngine` ;
- mutations → policy, approval et exécution transactionnelle.

## Observabilité et fiabilité

Les événements disponibles sont `delegation_evaluated`,
`delegation_plan_created`, `delegation_skipped`, `context_capsule_built`,
`specialist_run_started`, `specialist_run_completed`,
`specialist_run_failed`, `specialist_run_cancelled` et
`specialist_result_reused`. Ils ne contiennent ni requête, ni capsule brute,
ni contenu privé. Les cinq spécialistes sont enregistrés comme composants
optionnels dans `ReliabilityEngine`; leur panne laisse le chemin direct actif.

## Source of truth

| Responsabilité | Service canonique |
| --- | --- |
| Orchestration utilisateur | `NoonOrchestrator` |
| Décision de délégation | `DelegationEngine` |
| Définitions spécialistes | `SpecialistRegistry` |
| Contexte spécialiste | `ContextBuilder` / `ContextCapsuleBuilder` |
| Sélection modèle | `ModelRouter` (`selectConfiguredModelRoute`) |
| Retrieval personnel | `PersonalSearchEngine` |
| Retrieval public | `PublicResearchEngine` |
| Compréhension média | `MultimodalEngine` |
| Synthèse multi-source | `MultiSourceSynthesisEngine` |
| Création de fichiers | `ArtifactEngine` |
| Sécurité | `OperationalSecurityPolicy` |
| Approbation | `ApprovalManager` |
| Side effects | `TransactionalExecutionEngine` |
| Santé runtime | `ReliabilityEngine` |
| Évaluation | `NoonEvaluationEngine` |

## Étape suivante — non implémentée

Construire un moteur central de jobs et de travail en arrière-plan pour les
tâches longues, différées ou périodiques, avec queue persistante, priorités,
budgets, cancellation, reprise après redémarrage et notifications sûres.

## Limites de validation actuelles

Les comparaisons direct/délégué, coût et latence sont couvertes par des tests
et évaluations hors ligne déterministes. Aucun benchmark qualitatif live sur
les modèles distants n’est exécuté par défaut, afin d’éviter de doubler les
appels et les coûts en production. La promotion de `SHADOW` vers `LIMITED` ou
`ON` doit rester conditionnée à un corpus A/B approuvé et à des mesures réelles.
