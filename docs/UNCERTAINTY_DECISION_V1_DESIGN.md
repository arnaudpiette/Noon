# Uncertainty & Decision Engine V1 — audit et design minimal

Date de l'audit : 2026-10-09

Portée : audit statique des fichiers suivis au commit de baseline ci-dessous.

Statut du document : `DESIGN_ONLY` — aucun moteur nouveau, aucun wiring et aucune migration ne sont implémentés dans cette phase.

## 1. Baseline et méthode de preuve

Baseline vérifiée avant l'audit :

- dépôt physique : `/Users/arnaudpiette/Noon` ;
- branche : `v2/multi-provider` ;
- HEAD : `862cf7c5afa4cfb79ec4b97b606e4d66c6ebc6b2` ;
- message : `feat(sandbox): add constrained dev execution sandbox` ;
- index : vide ;
- fichiers suivis modifiés : aucun ;
- seuls artefacts non suivis présents : `benchmark-workspaces/`, `dev-cost-ledger.json` et `dev-task-journal/`.

Ces trois artefacts ont été exclus des recherches générales. Ils n'ont été ni lus, ni modifiés, ni déplacés, ni stagés.

Niveaux de preuve utilisés dans ce document :

- **câblage statique** : un producteur et un consommateur effectif sont reliés dans le code de composition ;
- **implémentation statique** : un contrat ou un comportement existe, sans consommateur de production démontré ;
- **test disponible** : un test suivi couvre le comportement, sans prétendre qu'il a été relancé pendant cette phase ;
- **documentation** : décrit une intention ou un état historique, à confronter au code courant ;
- **non démontré** : aucun élément statique suffisant n'a été trouvé.

Aucun test, provider, réseau, processus Electron, benchmark, base personnelle ou runtime DEV n'a été exécuté pour cet audit. Les résultats de tests cités plus bas sont des tests disponibles dans le dépôt, pas des résultats nouvellement obtenus.

Sandbox V1 n'est pas réaudité. Son niveau reste `APPLICATION_CONSTRAINED`, sans confinement OS démontré.

## 2. Décisions d'architecture

1. **Ne pas créer un second moteur de décision.** `services/decision/decision-support-engine.js` est déjà le noyau canonique de comparaison non exécutoire. V1 doit faire évoluer ce moteur et préserver son API publique lorsque possible.
2. **Garder un moteur pur.** La première tranche de calcul reste synchrone, déterministe, locale, sans provider, outil, persistence ou side effect.
3. **Ne pas fusionner les autorités.** `AgentEvaluationEngine` qualifie le résultat d'une exécution ; `DecisionSupportEngine` compare des options. Le premier peut produire des preuves structurées pour le second, mais aucun des deux ne remplace l'autre.
4. **Réutiliser les primitives, pas les pipelines.** Les notions de racine indépendante, provenance, déduplication et conflit de `MultiSourceSynthesisEngine` sont réutilisables. Son extraction textuelle et son registre de passages restent séparés du moteur de décision.
5. **Aucun score n'est une probabilité.** Le score déterministe de support et la couverture des preuves sont publiés séparément. La confiance probabiliste reste `NOT_CALIBRATED` tant qu'une calibration empirique versionnée n'existe pas.
6. **Un verdict ne donne jamais d'autorité.** Même `DECIDED` ne peut ni autoriser, ni approuver, ni déclencher une action ou une vérification.
7. **Le premier consommateur de wiring recommandé est `PortfolioCapacityEngine`.** Il est déjà read-only, en `SHADOW`, injecte déjà `DecisionSupportEngine` et produit des données structurées. Il permet de valider le contrat sans provider ni action. Le branchement conversationnel dans `NoonOrchestrator` vient après.

## 3. Architecture existante

### 3.1 Matrice d'audit

| Brique | Responsabilité et autorité | Entrées / sorties | Consommateurs effectifs | Primitives réutilisables | Limites démontrées | Preuves disponibles |
| --- | --- | --- | --- | --- | --- | --- |
| `NoonOrchestrator` | Coordonne contexte, routage, provider, outils, approvals et exécution transactionnelle. Il n'est pas une autorité de preuve factuelle. | Requête normalisée et contexte ; résultat conversationnel, appels outils, métriques et éventuelle suspension d'approval. | Chat serveur ; enveloppé par `AgentEvaluationRuntime`. | `executionId`, boucle bornée, signal d'annulation, reason codes, tool results, privacy et pipeline sécurité. | Aucune comparaison formelle d'hypothèses. Le maximum de tours est borné à 1–20, 3 par défaut ; l'épuisement produit une réponse de fin, pas un verdict de décision. | Câblage dans `server.js`; tests dans `test/noon-orchestrator.test.js` sur limite de tours, privacy, approvals, contenu externe et exécution transactionnelle. |
| `DecisionSupportEngine` | Compare des options et formule une recommandation non exécutoire. C'est le propriétaire existant à étendre. | `DecisionRequest` normalisé ; classement, évaluations, trade-offs, inconnues, recommandation et propositions de prochaine étape. | Routes `/api/decision/compare` et `/api/decision/record`; `PortfolioCapacityEngine`; test d'intégration depuis Goal. Aucun client `public/` ou `electron/` trouvé pour les routes de décision. | critères pondérés, contraintes dures, valeurs `UNKNOWN`, scopes, cache éphémère, fingerprint, what-if, `actionAuthorized: false`. | La présence d'un `evidenceRef` donne actuellement `HIGH`; pas de polarité, provenance vérifiée, dépendance, fraîcheur calculée ou déduplication ; stale/conflit restent visibles mais ne bloquent pas la recommandation ; IDs aléatoires si absents ; critères/enum invalides ont souvent un fallback silencieux. | Implémentation et câblage statiques ; `test/decision-support-engine.test.js`. |
| `GoalStrategyEngine` / Goal Mode | Source de vérité stratégique pour objectifs, outcomes, jalons, stratégies et progression. Ne possède ni priorité opérationnelle, ni planning, ni exécution. | Objectifs confirmés, preuves et liens canoniques ; Goal, reviews, alignement et critère `STRATEGIC_FIT`. | API Goals, `ContextBuilder`, surfaces de santé et `DecisionSupportEngine` via un critère dans les tests. | confirmation explicite, `UNKNOWN`, evidence refs, relations `CONFLICTS_WITH`, progression factuelle, `decisionRefs`. | Les champs `confidence` numériques ne sont pas calibrés. Un alignement explicite accepte une confiance déclarée. La documentation affirme encore un repository mémoire de rollout, mais `server.js` injecte maintenant `goalStrategyRepository` persistant : le code courant prime. | Câblage statique ; `test/goal-strategy-engine.test.js`; repository SQLite/JSON suivi. |
| `AgentEvaluationEngine` | Agrège des preuves d'exécution selon l'autorité `DETERMINISTIC > SYSTEM > HUMAN > AGENT`. Il ne décide pas entre options. | Statut d'exécution, preuves bornées, critères, IDs requis ; `PASS`, `PARTIAL`, `FAIL`, `INSUFFICIENT_EVIDENCE`. | `AgentEvaluationRuntime`, qui enveloppe `NoonOrchestrator.run()` et `resume()` et ajoute `metadata.agentEvaluation`. Aucun autre consommateur runtime trouvé. | niveaux d'autorité, preuve requise, échec critique bloquant, séparation déclaration agent / preuve indépendante, sorties sans contenu brut. | Pas de provenance détaillée, scope, fraîcheur, contradiction, dépendance ou calibration. `confidence` est une étiquette de politique fixe, pas une probabilité. | Câblage statique ; `test/agent-evaluation-engine.test.js` et `test/agent-evaluation-runtime.test.js`. |
| `AdaptiveRoutingService` et Model Router | Le Model Router est l'autorité canonique du choix provider/modèle. Adaptive Routing ne propose qu'une route shadow à partir d'agrégats historiques stables. | Signaux de requête, contraintes de capacité/coût/latence et snapshots de performance ; route active et comparaison shadow. | `selectConfiguredModelRoute()` dans `server.js`; chat, briefs et DEV passent par le routeur configuré. | filtres d'éligibilité avant score, reason codes, minimum d'échantillons, latence/coût, marge de stabilité, `INSUFFICIENT_EVIDENCE`. | Les scores adaptatifs sont heuristiques et globaux, non calibrés et sans scope profil/projet. Le moteur de décision ne doit pas devenir un second Model Router. | Câblage statique ; tests de routing, cost-aware et adaptive disponibles. |
| `MemoryEngine` | Façade canonique de lecture et de proposition de candidats mémoire. Chaque stockage conserve son cycle de vie. | Requête et scopes ; contextes local/distant, provenance, IDs, statuts, erreurs et métriques. | `ContextBuilder`, voix, recherche, routes mémoire et review learning. | filtrage local-only, consentement, expiration, déduplication, budgets de taille, erreurs partielles, relecture par autorité. | Une mémoire n'est pas une preuve par sa seule présence. `confidence` des sources n'est pas une calibration commune. Le moteur de décision ne doit ni relire les stores directement ni persister une conclusion en mémoire. | Câblage statique ; `test/memory-engine.test.js`. |
| Code Brain / équivalent réel | Aucun moteur persistant nommé Code Brain n'existe. Le parcours DEV utilise un `Repository Context Manifest` éphémère de métadonnées avant `PLAN`, puis des lectures bornées et hashées. | Contrat/workspace/preflight ; manifeste sans contenu, fichiers lus, recherches et indisponibilités. | `NativeDevImplementationEngine` puis `NativeDevReasoner` pour le premier `PLAN`. | chemins bornés, hashes, exclusions, `UNTRUSTED`, fichiers indisponibles, télémétrie de contexte. | Pas d'index persistant ni graphe sémantique. Le manifeste décrit le dépôt ; il ne prouve pas qu'une affirmation fonctionnelle est vraie. | Câblage statique ; `docs/CODE_CONTEXT_AUDIT.md`, `test/repository-context-manifest.test.js` et tests DEV disponibles. |
| `MultiSourceSynthesisEngine` | Normalise des passages, extrait/déduplique des claims et rend les conflits visibles. Il synthétise ; il ne choisit pas une action. | `EvidencePack`; claims, conflits, timeline, état courant, citations et limites. | Personal Search / skill de synthèse selon son wiring existant. | `independentRoots`, `derivedFrom`, fingerprint, types de conflit, provenance, `untrustedContent`, budget de passages. | L'extraction de claims est heuristique et textuelle. `sourceAuthority` et `confidenceFor()` ne sont pas calibrés. Son contenu et son cache ne doivent pas devenir le stockage du moteur de décision. | Implémentation statique ; `test/multi-source-synthesis-engine.test.js`. |
| Budgets et arrêts | Les autorités sont réparties selon le domaine : budget mensuel global dans `server.js`, Model Router pour l'éligibilité coût, `DevCostBudgetService` pour réservations DEV, `DelegationEngine` pour sous-budgets, orchestrateurs pour tours/durée. | Snapshots et limites existants ; refus, interruption, timeout ou résultats partiels. | Orchestrator, DEV, délégation, recherche et jobs. | snapshots read-only, modes `NORMAL/ECO/PROTECTION/BLOCKED`, réservations, max rounds/iterations/wall time, `AbortSignal`. | Il n'existe pas un budget universel à recopier. Un manque de budget n'est pas une preuve négative et ne doit pas être confondu avec un échec intellectuel. | Câblage et tests spécialisés disponibles. |
| Chaîne de sécurité | Autorités souveraines : `OperationalSecurityPolicy` puis `InterventionPermissionEngine`, Approval Engine canonique, `TransactionalExecutionEngine`, handlers/side effects. | `ActionRequest`, PolicyDecision, approval exacte, plan immuable et vérification. | Tool loop de `NoonOrchestrator` et mutations migrées. | fail-closed, empreinte exacte, rechecks, single-use approval, idempotence, vérification, `UNKNOWN_OUTCOME`. | `DecisionSupportEngine` n'est dans aucune de ces autorités et doit rester hors de leur chemin de décision permissive. | Câblage statique ; tests security, approval et transactional execution disponibles. |

### 3.2 État précis du moteur de décision existant

Le pipeline actuel est :

```text
DecisionRequest
  -> normalizeDecisionRequest()
  -> resolveCriteria()
  -> filterEvidence()
  -> evaluateOption()
  -> keyTradeoffs()
  -> recommendation()
  -> résultat non exécutoire
```

Ce noyau satisfait déjà plusieurs invariants utiles :

- au moins deux options ;
- au plus 20 options, 30 critères, 30 contraintes et 100 preuves ;
- une valeur absente reste `UNKNOWN` ;
- une contrainte dure violée produit `INFEASIBLE` ;
- une égalité ne produit pas de faux gagnant ;
- les scopes workspace/profil et `localOnly` sont filtrés ;
- aucune recherche, aucun provider et aucune action ;
- une préférence durable n'est jamais créée automatiquement ;
- un `DecisionRecord` exige `userConfirmed: true`.

Mais ce contrat n'est pas encore un Uncertainty Engine :

- `evidenceRefs` est attaché à l'option entière, puis réutilisé pour tous ses critères ;
- une référence existante suffit à faire passer la confiance d'une cellule à `HIGH`, sans vérifier ce qu'elle prouve ;
- `stale` et `conflict` sont de simples booléens observables ; ils ne modifient pas l'éligibilité à une recommandation ;
- plusieurs copies de la même source peuvent compter plusieurs fois ;
- aucune distinction n'existe entre preuve pour, preuve contre, absence, preuve négative et assertion LLM ;
- les contraintes dures dont la valeur est absente ne sont pas marquées bloquantes ;
- le `comparisonIndex` mélange performance et disponibilité de données ;
- les IDs générés par UUID rendent une requête sans IDs non reproductible ;
- `DecisionHistoryService` reste en mémoire dans la composition serveur, car aucun repository ne lui est injecté ; le flag `decision.history` reste `OFF` ;
- le cache est uniquement mémoire et dépend d'un `contextVersion` fourni par l'appelant.

### 3.3 Câblage actuel à ne pas confondre avec une validation complète

- Le moteur est créé en `SHADOW` dans `server.js`, mais la route locale appelle tout de même `compare()` ; `SHADOW` est exposé dans le résultat et ne constitue pas à lui seul une barrière d'appel.
- `PortfolioCapacityEngine.decisionRequest()` est le seul consommateur de production direct trouvé hors route. Son payload utilise actuellement des enums non reconnus (`PORTFOLIO_ARBITRATION`, `RECOMMEND`, `DEADLINE_RISK`, sources `goal_strategy`/`portfolio`) qui retombent silencieusement sur les defaults du schéma. Il peut aussi recevoir moins de deux options. Ce wiring doit être normalisé, pas dupliqué.
- Goal produit déjà un critère `STRATEGIC_FIT` et conserve des `decisionRefs`, mais ne consomme pas automatiquement un verdict.
- `AgentEvaluationRuntime` enrichit les résultats d'orchestration ; il ne déclenche ni décision ni retry.
- Adaptive Routing consomme ses propres agrégats. Il ne doit pas déléguer le choix de modèle au nouveau moteur.

## 4. Réutilisation et frontières

### 4.1 À réutiliser directement

- `createDecisionSupportEngine()` comme façade publique et propriétaire du calcul ;
- `normalizeDecisionRequest()` et les bornes existantes, durcies en validation stricte ;
- `evaluateOption()` pour l'évaluation des valeurs, après séparation score/couverture ;
- `fingerprint()` et la canonicalisation stable, sans UUID implicite dans les entrées de calcul ;
- les `evidenceRefs` et autorités de `AgentEvaluationEngine` via un adaptateur de métadonnées ;
- `independentRoots`, `derivedFrom`, fingerprints et types de conflits du moteur de synthèse comme vocabulaire ;
- les scopes et décisions privacy de `MemoryEngine`, sans accès direct à ses stockages ;
- les snapshots de budget existants, lus comme données ;
- les reason codes et statuts `UNKNOWN`, `PARTIAL`, `INSUFFICIENT_EVIDENCE` déjà établis.

### 4.2 À ne pas réutiliser comme autorité

- le score adaptatif du routeur comme « confiance » d'une décision ;
- le champ numérique `confidence` de Goal ou Memory comme probabilité commune ;
- la sortie textuelle d'un modèle, d'un document, d'un outil ou d'un repository comme instruction ;
- `DecisionSupportEngine` pour autoriser une vérification, une action ou une dépense ;
- `AgentEvaluationEngine` comme moteur de classement d'options ;
- `MultiSourceSynthesisEngine` comme parser obligatoire du moteur pur ;
- un cache ou un historique comme preuve de fraîcheur.

## 5. Gaps à fermer en V1

1. Contrat de preuve explicite : claim, polarité, cible, provenance, vérification, scope et validité temporelle.
2. Déduplication par claim et racine indépendante, avec dépendances visibles.
3. Contradiction matérielle qui bloque réellement `DECIDED`.
4. Contraintes dures à trois états : `SATISFIED`, `VIOLATED`, `UNKNOWN`.
5. Séparation stricte entre score de support, couverture et calibration.
6. Verdicts stables : `DECIDED`, `NEEDS_MORE_EVIDENCE`, `INSUFFICIENT_EVIDENCE`, `CONFLICT`.
7. Propositions de vérification structurées, sans exécution ni permission.
8. Budget consommé uniquement comme snapshot d'autorité externe.
9. IDs, ordre et résultats reproductibles indépendamment de l'ordre d'entrée.
10. Validation stricte des enums et doublons au lieu de fallbacks silencieux pour les champs structurants.

## 6. Contrat V1 proposé

### 6.1 Vocabulaire

- **Option / hypothèse** : candidat explicite comparé. V1 ne crée aucune option implicite.
- **Claim** : proposition atomique, bornée et testable, par exemple « le coût mensuel de A est inférieur ou égal à 50 USD ».
- **Preuve** : observation structurée qui soutient ou contredit un claim et expose une provenance vérifiable. Une référence seule n'est pas une preuve suffisante.
- **Assertion** : déclaration non vérifiée, notamment issue d'un LLM. Elle peut proposer une piste, jamais satisfaire un prérequis `DECIDED`.
- **Inconnue** : claim requis dont aucune preuve éligible n'établit la valeur.
- **Contradiction** : preuves éligibles incompatibles sur le même claim et la même portée/temporalité.
- **Contrainte dure** : prédicat obligatoire. Sa violation exclut l'option ; son état inconnu empêche `DECIDED` pour cette option.
- **Vérification** : opération proposée pour réduire une inconnue ou résoudre un conflit. Le moteur ne l'autorise et ne l'exécute jamais.

### 6.2 Interfaces minimales

Les interfaces ci-dessous sont un contrat documentaire pour JavaScript. Les objets retournés doivent être sérialisables, bornés et sans fonction.

```ts
type DecisionVerdict =
  | "DECIDED"
  | "NEEDS_MORE_EVIDENCE"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICT";

type DecisionRequestV1 = {
  schemaVersion: 2;
  decisionId: string;                 // requis, stable, <= 160 caractères
  question?: string;                  // local/sensible, <= 4 000 caractères
  decisionType: "CHOOSE" | "COMPARE" | "RANK" | "TRADEOFF" | "GO_NO_GO" | "WHAT_IF" | "REVIEW_DECISION";
  evaluationAt: string;               // ISO-8601 fourni, jamais Date.now() caché
  scope: DecisionScope;
  options: DecisionOptionV1[];         // 2..20
  criteria: DecisionCriterionV1[];     // 1..30
  constraints?: DecisionConstraintV1[];// 0..30
  evidence?: DecisionEvidenceV1[];     // 0..100
  verificationProposals?: VerificationProposalV1[]; // 0..30
  budget?: DecisionBudgetSnapshotV1;   // snapshot read-only, optionnel
  recommendationRequested?: boolean;
  outputMode?: "QUICK" | "BALANCED" | "DETAILED" | "TABLE" | "COMPARE_ONLY";
  contextVersion: string;              // requis, stable, <= 120 caractères
};

type DecisionScope = {
  profileScope: string;                // requis
  workspaceId?: string | null;
  projectId?: string | null;
  purpose: "LOCAL_ANALYSIS" | "REMOTE_MODEL_CONTEXT";
};

type DecisionOptionV1 = {
  optionId: string;                    // requis, unique, stable
  label: string;                       // 1..180
  description?: string;                // <= 1 200
  source: "USER_PROVIDED" | "DISCOVERED" | "CURRENT_STATE" | "SYNTHESIZED";
  assumptions?: string[];              // <= 20, chacune <= 500
  values?: Record<string, ScalarValue | "UNKNOWN">;
};

type DecisionCriterionV1 = {
  criterionId: string;                 // requis, unique, stable
  label: string;                       // 1..180
  type: "COST" | "LATENCY" | "QUALITY" | "RISK" | "TIME" |
        "REVERSIBILITY" | "COMPLEXITY" | "MAINTENANCE" |
        "PRIVACY" | "SECURITY" | "PERFORMANCE" |
        "LEARNING_VALUE" | "STRATEGIC_FIT" | "USER_DEFINED";
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  direction: "MINIMIZE" | "MAXIMIZE" | "MATCH";
  requiredEvidence: "NONE" | "VERIFIED";
  range?: { min: number; max: number } | null;
};

type DecisionEvidenceV1 = {
  evidenceId: string;                  // requis, unique, stable
  claimId: string;                     // requis
  optionId: string;                    // requis
  criterionId: string;                 // requis
  stance: "SUPPORTS" | "OPPOSES" | "NEUTRAL";
  value?: ScalarValue | null;
  kind: "DETERMINISTIC_CHECK" | "SYSTEM_OBSERVATION" |
        "HUMAN_CONFIRMATION" | "SOURCE_PASSAGE" |
        "LLM_ASSERTION" | "INFERENCE";
  authority: "DETERMINISTIC" | "SYSTEM" | "HUMAN" |
             "EXTERNAL_SOURCE" | "AGENT";
  verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" |
                      "UNVERIFIED" | "FAILED";
  critical?: boolean;
  provenance: EvidenceProvenanceV1;
  scope: DecisionScope;
  observedAt?: string | null;
  validUntil?: string | null;
  freshnessRequirement?: "LIVE" | "RECENT" | "CURRENT" |
                         "EVERGREEN" | "HISTORICAL";
  claimFingerprint: string;            // hash canonique, sans contenu brut
  independenceKey: string;             // racine réelle commune
  derivedFromEvidenceIds?: string[];   // <= 20, DAG uniquement
  localOnly?: boolean;
  allowedForRemoteModel?: boolean;
  untrustedContent?: boolean;
};

type EvidenceProvenanceV1 = {
  producer: string;                    // service canonique, <= 120
  sourceType: string;                  // <= 80
  sourceRef?: string | null;           // référence locale/pseudonymisée
  locatorRef?: string | null;          // référence, jamais contenu brut
  method: string;                      // test, read-after-write, user-confirmation...
  rootEvidenceId?: string | null;
};

type DecisionConstraintV1 = {
  constraintId: string;                // requis, unique
  optionId?: string | null;            // null = toutes les options
  criterionId: string;
  operator: "MAX" | "MIN" | "EQUALS" | "IN";
  expected: ScalarValue | ScalarValue[];
  strength: "HARD" | "SOFT";
  evidenceRequirement: "VERIFIED";
};

type VerificationProposalV1 = {
  verificationId: string;              // déterministe
  resolvesClaimIds: string[];           // 1..20
  type: "DETERMINISTIC_CHECK" | "READ_AUTHORIZED_SOURCE" |
        "ASK_USER" | "REFRESH_SOURCE";
  requiredAuthority: "DETERMINISTIC" | "SYSTEM" | "HUMAN";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  estimatedCost?: { currency: "USD"; amount: number | null };
  estimatedLatencyMs?: number | null;
  estimatedModelCalls?: number;
  estimatedToolRequests?: number;
  proposedOnly: true;
  authorizationState: "NOT_REQUESTED";
};

type DecisionBudgetSnapshotV1 = {
  authorityRef: string;                // ex. global, DEV ou délégation
  state: "AVAILABLE" | "CONSTRAINED" | "EXHAUSTED" | "UNKNOWN";
  remainingCost?: number | null;
  remainingModelCalls?: number | null;
  remainingToolRequests?: number | null;
  remainingWallTimeMs?: number | null;
};
```

Le résultat minimal :

```ts
type DecisionResultV1 = {
  schemaVersion: 2;
  engineVersion: "decision-support-v2";
  decisionId: string;
  verdict: DecisionVerdict;
  recommendedOptionId: string | null;
  reasonCodes: string[];
  rankedOptions: OptionComparisonV1[];
  constraints: ConstraintResultV1[];
  unknowns: DecisionUnknownV1[];
  conflicts: DecisionConflictV1[];
  verificationProposals: VerificationProposalV1[];
  stopReason: string;
  evidenceSummary: {
    eligible: number;
    excluded: number;
    stale: number;
    duplicate: number;
    dependent: number;
  };
  supportScore: {
    scale: "ORDINAL_0_4_WEIGHTED";
    byOption: Record<string, number | null>;
    calibratedProbability: null;
    calibrationStatus: "NOT_CALIBRATED";
  };
  evidenceCoverage: {
    byOption: Record<string, number>;   // 0..1, fraction descriptive
    criticalCellsComplete: boolean;
  };
  recommendationIsAction: false;
  actionAuthorized: false;
  verificationAuthorized: false;
  decisionContextFingerprint: string;
  publicMetadata: PublicDecisionMetadataV1;
};
```

### 6.3 Validation et bornes

- IDs requis, non vides, uniques dans leur collection et limités à 160 caractères.
- Les références d'option, critère, claim et preuve doivent exister.
- Les dépendances de preuve doivent former un DAG ; cycle, self-reference ou profondeur supérieure à 12 : `DECISION_EVIDENCE_DEPENDENCY_INVALID`.
- Les enums structurants invalides sont refusés. Aucun fallback silencieux pour `decisionType`, criterion `type`, `source`, `stance`, `authority` ou `verificationStatus`.
- Nombres non finis, ranges inversés et dates invalides sont refusés.
- Plus de 20 options, 30 critères, 30 contraintes, 100 preuves ou 30 propositions : erreur explicite, jamais troncature silencieuse du calcul.
- Les tableaux de texte secondaires peuvent rester tronqués selon les bornes actuelles, avec un indicateur `inputTruncated`; les structures qui changent le verdict ne sont jamais tronquées.
- L'ordre de sortie est déterministe : options et critères dans l'ordre canonique par ID ; preuves, unknowns, conflits, contraintes et reason codes triés par clés stables. L'ordre d'entrée ne départage jamais une égalité.

## 7. Sémantique des preuves

### 7.1 Ce qui constitue une preuve

Une preuve éligible à `DECIDED` doit simultanément :

1. viser un `optionId`, un `criterionId` et un `claimId` existants ;
2. porter une polarité et une valeur compatibles avec le critère ;
3. avoir une provenance structurée ;
4. être `VERIFIED` ;
5. avoir une autorité admissible pour le claim ;
6. correspondre exactement au scope demandé ou être explicitement `GLOBAL` dans un futur contrat ;
7. ne pas être expirée ou stale selon `evaluationAt` et `freshnessRequirement` ;
8. respecter privacy/local-only pour la finalité courante ;
9. ne pas dépendre d'une preuve exclue ou circulaire.

Une sortie d'outil n'est pas automatiquement une preuve : son adaptateur doit indiquer la méthode de vérification. Une réponse autoritative, un read-after-write, un hash, un test déterministe ou une confirmation humaine exacte peuvent produire `VERIFIED`.

### 7.2 Assertion LLM

`LLM_ASSERTION` et toute preuve d'autorité `AGENT` ont un poids de satisfaction nul pour :

- une contrainte dure ;
- une cellule `requiredEvidence: VERIFIED` ;
- une transition vers `DECIDED`.

Elles peuvent seulement :

- créer une hypothèse explicitement marquée ;
- expliquer une option ;
- proposer une vérification ;
- contribuer à `NEEDS_MORE_EVIDENCE`.

Une multiplication d'assertions LLM ne change jamais cette règle.

### 7.3 Scope et fraîcheur

- `profileScope` doit être identique.
- Une preuve liée à un workspace ou projet différent est exclue, pas rétrogradée.
- Une preuve sans date reste utilisable uniquement pour un claim `EVERGREEN` ou si le contrat indique explicitement que la date est non pertinente ; sinon elle devient une inconnue de fraîcheur.
- `validUntil < evaluationAt` produit `EVIDENCE_EXPIRED`.
- La fraîcheur est calculée depuis les dates et la politique du critère, jamais depuis un booléen fourni seul.
- Rafraîchir une source crée une nouvelle preuve ; l'ancienne reste référencée comme historique et ne ressuscite pas par cache.

### 7.4 Doublons et preuves dépendantes

Déduplication en deux niveaux :

1. même `claimFingerprint`, cible, stance, scope et période : doublon exact ; une seule occurrence est éligible ;
2. `independenceKey` identique ou chemin `derivedFromEvidenceIds` commun : preuves dépendantes ; seule la meilleure vérification de la racine contribue au score et à la couverture.

Les autres occurrences restent dans les compteurs et la traçabilité. Elles ne sont pas supprimées du diagnostic.

Deux publications qui recopient la même source primaire ne constituent qu'une racine indépendante. Deux tests différents qui observent le même artefact peuvent être indépendants seulement si leurs méthodes et points de défaillance le sont réellement ; cette information doit venir du producteur, pas être devinée par le moteur.

### 7.5 Absence de preuve et preuve négative

- **Absence** : aucune preuve éligible pour le claim. Résultat `UNKNOWN`; aucune pénalité et aucune valeur zéro n'est inventée.
- **Preuve négative** : preuve éligible `OPPOSES`, avec valeur/méthode/provenance. Elle compte explicitement contre l'option.
- **Échec de récupération** : ne prouve pas le contraire. Il crée `SOURCE_UNAVAILABLE` ou `VERIFICATION_FAILED`, donc une inconnue.
- **Zéro observé** : valeur réelle `0` seulement si une preuve vérifiée l'établit. Il reste distinct de `null` et `UNKNOWN`.

### 7.6 Contraintes et échecs bloquants

Une contrainte dure produit exactement :

- `SATISFIED` si une preuve vérifiée établit le prédicat ;
- `VIOLATED` si une preuve vérifiée établit sa négation ; l'option devient `INFEASIBLE` ;
- `UNKNOWN` sinon ; l'option n'est pas déclarée faisable pour `DECIDED`.

Une preuve critique négative et vérifiée n'est jamais compensée par plusieurs signaux faibles, preuves dépendantes, assertions LLM ou critères favorables. Les contraintes privacy, security, local-only, capacité obligatoire et budget maximum sont évaluées avant le score comparatif.

## 8. Contradictions, égalités et verdicts

### 8.1 Contradictions

Une contradiction existe lorsque deux racines indépendantes et éligibles produisent des valeurs ou polarités incompatibles pour le même claim, même scope et même fenêtre temporelle.

Types V1 :

- `VALUE_CONFLICT` ;
- `STATUS_CONFLICT` ;
- `VERSION_CONFLICT` ;
- `TEMPORAL_AMBIGUITY` ;
- `SOURCE_DISAGREEMENT`.

Une succession datée n'est pas un conflit si les périodes ne se chevauchent pas. Une preuve proposée ne contredit pas une preuve courante vérifiée ; elle reste une hypothèse. Une contradiction matérielle sur une contrainte dure, un critère `CRITICAL` ou un fait pouvant changer le gagnant produit `CONFLICT`. Elle n'est jamais absorbée dans une moyenne.

### 8.2 Score, couverture et calibration

Le moteur peut conserver l'échelle ordinale actuelle `POOR=0` à `EXCELLENT=4`, pondérée par importance. Ce nombre devient explicitement `supportScore` :

- il compare seulement les cellules connues ;
- il ne mesure ni vérité, ni probabilité, ni confiance ;
- une option avec peu de cellules connues ne devient pas meilleure grâce à l'absence de données ;
- les critères durs sont exclus du mécanisme compensatoire ;
- le score brut et la couverture sont publiés séparément.

`evidenceCoverage` est la fraction de cellules requises possédant au moins une racine de preuve éligible. La couverture des critères `HIGH` et `CRITICAL` est aussi exposée séparément.

V1 publie toujours :

```text
calibrationStatus = NOT_CALIBRATED
calibratedProbability = null
```

Le mot `confidence` ne doit pas être utilisé pour le score de décision dans le nouveau résultat. Les anciens champs peuvent rester dans une section de compatibilité marquée `legacyHeuristic` pendant la migration.

### 8.3 Conditions des verdicts

`DECIDED` exige toutes les conditions suivantes :

1. au moins une option faisable ;
2. toutes les contraintes dures de l'option gagnante sont `SATISFIED` ;
3. aucune inconnue sur ses critères `CRITICAL` ;
4. toutes ses cellules `requiredEvidence: VERIFIED` sont couvertes ;
5. aucun conflit matériel non résolu ;
6. son `supportScore` est strictement supérieur au suivant parmi les options faisables ;
7. les critères qui créent cet avantage possèdent des preuves éligibles ;
8. aucune raison bloquante globale.

`CONFLICT` s'applique lorsqu'un conflit matériel empêche une comparaison honnête, même si une moyenne donnerait un gagnant.

`NEEDS_MORE_EVIDENCE` s'applique lorsqu'une ou plusieurs vérifications concrètes et autorisables pourraient résoudre les inconnues, le tie ou le conflit non matériel, et que le snapshot de budget n'est pas `EXHAUSTED`.

`INSUFFICIENT_EVIDENCE` s'applique lorsque :

- aucune comparaison utile n'est possible ;
- aucune vérification concrète n'est disponible ;
- le budget est épuisé avant d'obtenir les preuves requises ;
- une égalité demeure sans critère ou preuve capable de la départager ;
- toutes les options ont une contrainte dure `UNKNOWN` et aucune vérification admissible.

Une égalité de score seule ne produit jamais `DECIDED`. Elle produit `NEEDS_MORE_EVIDENCE` si une vérification ciblée peut la départager, sinon `INSUFFICIENT_EVIDENCE` avec `NO_CLEAR_ADVANTAGE`. Une égalité issue de preuves incompatibles produit `CONFLICT`.

## 9. Vérifications, budgets et conditions d'arrêt

### 9.1 Suggestion versus autorisation

Le moteur peut ordonner des `VerificationProposalV1` par valeur d'information déterministe : d'abord contraintes dures, puis conflits matériels, puis critères critiques inconnus, puis critères susceptibles de départager le premier et le second.

Chaque proposition reste :

```text
proposedOnly = true
authorizationState = NOT_REQUESTED
verificationAuthorized = false
```

Son exécution future doit repasser par les autorités existantes adaptées au domaine. Le moteur ne réserve aucun coût, n'appelle aucun outil et ne crée aucune approval.

### 9.2 Réutilisation des budgets existants

- Conversation générale : snapshot de `getBudgetStatus()` / limites runtime, sans déplacer cette politique dans le moteur.
- DEV : snapshot de `DevCostBudgetService`; toute réservation reste `RESERVE -> CALL -> RECONCILE` dans ce service.
- Délégation : budget du `DelegationEngine`, sans sous-budget parallèle.
- Recherche : budget du `ResearchPlanner` et de l'adapter.
- Temps et annulation : `AbortSignal`, deadlines et limites du consommateur.

Le moteur lit seulement `DecisionBudgetSnapshotV1`. Si le snapshot est absent ou illisible, l'état est `UNKNOWN`, jamais « illimité » ou zéro.

### 9.3 Arrêts

Le calcul pur est un passage fini, pas une boucle agentique. Il expose un `stopReason` parmi :

- `DECISION_COMPLETE` ;
- `MATERIAL_CONFLICT` ;
- `REQUIRED_EVIDENCE_MISSING` ;
- `NO_CLEAR_ADVANTAGE` ;
- `NO_FEASIBLE_OPTION` ;
- `BUDGET_EXHAUSTED` ;
- `NO_AUTHORIZABLE_VERIFICATION` ;
- `INPUT_INVALID`.

Un budget épuisé ne dégrade pas un résultat déjà suffisamment prouvé : `DECIDED` reste possible à partir des preuves présentes. Sinon le verdict devient `INSUFFICIENT_EVIDENCE` avec `BUDGET_EXHAUSTED`; les vérifications proposées restent visibles mais `SKIPPED_BUDGET` dans leur diagnostic.

## 10. Lifecycle et persistence

```text
1. RECEIVE
   -> validation stricte, IDs et scope
2. NORMALIZE
   -> ordre canonique et fingerprint
3. FILTER
   -> privacy, scope, fraîcheur, vérification
4. COLLAPSE
   -> doublons et racines dépendantes
5. EVALUATE CONSTRAINTS
   -> SATISFIED / VIOLATED / UNKNOWN
6. DETECT CONFLICTS
   -> matériel / non matériel
7. COMPARE
   -> supportScore + coverage, séparés
8. PROPOSE VERIFICATIONS
   -> aucune exécution
9. VERDICT
   -> verdict, reason codes et stopReason
10. RETURN
   -> résultat pur et métadonnées sûres
```

La première tranche n'a besoin d'aucune persistence :

- la requête contient toutes les références nécessaires ;
- le calcul est reproductible depuis `evaluationAt` et `contextVersion` ;
- le cache reste éphémère et peut être désactivé sans changer le résultat ;
- les contenus de preuve restent chez leurs propriétaires canoniques.

La persistence d'un choix reste dans `DecisionHistoryService` et exige une confirmation utilisateur. Elle est hors tranche tant que `decision.history` est `OFF` et qu'un repository canonique n'est pas explicitement décidé. Aucun résultat de décision ne devient automatiquement mémoire, règle, objectif, préférence ou signal adaptatif.

Expiration : un cache ne doit jamais dépasser le plus proche `validUntil` des preuves éligibles et doit toujours inclure `evaluationAt`, `contextVersion`, policy version et fingerprint des preuves dans sa clé. Une preuve révoquée invalide le contexte via son producteur ; V1 ne maintient pas un second registre de révocation.

### 10.1 Métadonnées publiques et données locales sensibles

Peuvent être exposés aux logs/métriques :

- version du moteur ;
- verdict et reason codes ;
- compteurs d'options, critères, preuves, doublons, conflits et inconnues ;
- couverture agrégée ;
- stop reason et durée ;
- fingerprints tronqués non réversibles.

Restent locaux et absents des logs :

- question, labels et descriptions ;
- valeurs privées ;
- contenu brut, snippet, prompt ou réponse ;
- chemins absolus, URL privées et locators complets ;
- identité personnelle, destinataire ou cible sensible ;
- arguments de vérification ;
- mémoire, document ou code source brut.

## 11. Points d'intégration

| Système | Intégration V1 recommandée | Ce qu'il ne doit pas faire |
| --- | --- | --- |
| Reasoning / `NoonOrchestrator` | Après validation du moteur isolé, router uniquement une intention `COMPARE` déjà structurée vers un adaptateur Decision, puis rendre le résultat. Les options extraites par un LLM restent `LLM_ASSERTION` jusqu'à vérification. | Autoriser un outil depuis `DECIDED`, créer des preuves depuis le texte du modèle, lancer automatiquement les vérifications. |
| Goal | Fournir critères `STRATEGIC_FIT`, contraintes et evidence refs. Après choix utilisateur, conserver seulement le `decisionRecordId` dans une stratégie versionnée. | Transformer automatiquement un verdict en objectif, priorité, jalon atteint ou stratégie active. |
| Agent Evaluation | Adapter ses preuves bornées en `DecisionEvidenceV1` pour une décision explicitement demandée sur des résultats d'exécution. Garder ses verdicts propres. | Remplacer `PASS/FAIL` par `DECIDED`, ou laisser un score de décision contredire un échec critique déterministe. |
| Adaptive Router | Fournir coûts, latences et qualité comme valeurs/observations lorsque l'utilisateur compare des routes. Rester l'unique autorité du routage actif. | Consommer `DECIDED` pour changer le modèle ou contourner les filtres d'éligibilité. |
| Memory | Fournir des références déjà filtrées et des métadonnées de provenance via `MemoryEngine`; conserver local-only et consentements. | Devenir un store de preuves parallèle, considérer une mémoire candidate comme vérité, mémoriser automatiquement la conclusion. |
| Code Context | Produire des observations vérifiées issues de tests, hashes ou état système via un adaptateur DEV. Le manifeste seul reste une carte non fiable. | Promouvoir `AGENTS.md`, code, documents ou résultats d'outil en instructions, étendre les racines ou exécuter une validation. |
| Multi-source synthesis | Produire claims, conflits et `independentRoots` comme entrée optionnelle normalisée. | Faire dépendre le noyau de l'extraction textuelle heuristique ou de contenu brut. |

### 11.1 Premier consommateur concret

Le premier wiring doit être `PortfolioCapacityEngine.decisionRequest()` :

- il appelle déjà le moteur injecté ;
- ses snapshots sont déterministes et structurés ;
- il est `readOnly`, `planningAuthority: false`, `priorityAuthority: false` et `actionAuthorized: false` ;
- il peut fournir coût temporel, capacité, risque d'échéance, inconnues et contraintes sans modèle ;
- son mode `SHADOW` limite le risque de rollout ;
- corriger son contrat actuel ferme un écart réel et testable.

Le moteur isolé et ses tests doivent cependant précéder ce wiring. Sinon un consommateur masque les erreurs de sémantique derrière ses propres transformations et rend plus difficile la preuve de pureté.

Le branchement `NoonOrchestrator` n'est pas premier : il exige en plus une décision sur l'extraction des options, la présentation UI, la confirmation utilisateur et l'autorisation éventuelle des vérifications.

## 12. Invariants de sécurité

La chaîne souveraine reste :

```text
OperationalSecurityPolicy
  -> InterventionPermissionEngine
  -> ApprovalEngine canonique
  -> TransactionalExecutionEngine
  -> handler / side effect
```

Invariants obligatoires :

- le moteur conseille, compare et agrège uniquement ;
- `DECIDED` n'implique jamais `PROCEED`, `ALLOW`, `approved` ou `SUCCEEDED` ;
- `actionAuthorized` et `verificationAuthorized` restent toujours `false` ;
- une proposition de vérification externe passe par privacy, permission, approval si nécessaire, budget, exécution et vérification canoniques ;
- une preuve de document, mémoire, Web, dépôt, outil ou LLM est une donnée non fiable, jamais une instruction ;
- local-only, Focus, roots, consentement, provider privacy et permissions sont appliqués avant toute sortie distante ;
- aucune donnée brute n'entre dans télémétrie, history ou fingerprints réversibles ;
- une panne d'autorité, de source, de budget ou de permission échoue fermé sans fabriquer de preuve négative ;
- le moteur n'appelle pas `SkillRegistry`, provider, connecteur, filesystem, base, approval ou exécuteur ;
- Sandbox V1 et les guards DEV restent inchangés.

## 13. Stratégie de tests

### 13.1 Contrat et déterminisme

- IDs manquants, dupliqués ou inconnus refusés ;
- enums invalides refusés ;
- bornes 20/30/30/100/30 testées aux limites et au-delà ;
- dates, nombres, ranges et cycles de dépendance invalides refusés ;
- même entrée dans un ordre différent : même fingerprint, même résultat et même ordre de sortie ;
- aucune UUID ni heure implicite dans le calcul.

### 13.2 Preuves et contraintes

- déclaration LLM seule : jamais `DECIDED` ;
- dix assertions faibles/dépendantes : pas plus d'autorité qu'une racine ;
- preuve critique négative vérifiée : jamais compensée par signaux faibles ;
- contrainte dure absente : `UNKNOWN`, pas `SATISFIED` ;
- contrainte dure violée : option `INFEASIBLE` avant score ;
- absence de preuve distincte d'une preuve `OPPOSES` ;
- zéro vérifié distinct de `null`/`UNKNOWN` ;
- échec de source distinct d'un résultat négatif.

### 13.3 Scope, fraîcheur et dépendances

- preuve d'un autre profil/workspace/projet exclue ;
- local-only exclu du contexte distant mais disponible localement ;
- preuve expirée ou trop ancienne exclue du verdict ;
- date inconnue sur claim courant : unknown de fraîcheur ;
- doublon exact sans double comptage ;
- preuves dérivées d'une même racine sans double comptage ;
- cycle de dépendance refusé ;
- révocation/contextVersion change le fingerprint.

### 13.4 Contradictions et égalités

- conflit matériel non masqué : `CONFLICT` ;
- évolution datée non chevauchante : pas de faux conflit ;
- égalité départageable : `NEEDS_MORE_EVIDENCE` ;
- égalité non départageable : `INSUFFICIENT_EVIDENCE` ;
- ordre d'entrée inversé : aucun faux gagnant ;
- contradiction d'une contrainte dure : `CONFLICT`, pas moyenne.

### 13.5 Budget et arrêts

- budget épuisé avec preuves suffisantes : `DECIDED` possible sans vérification ;
- budget épuisé avec preuve manquante : `INSUFFICIENT_EVIDENCE` + `BUDGET_EXHAUSTED` ;
- budget absent : `UNKNOWN`, pas illimité ;
- proposition de vérification sans appel outil/provider/réservation ;
- maximum de propositions respecté de façon déterministe.

### 13.6 Pureté, confidentialité et autorités

- aucune mutation d'entrée ;
- mêmes entrées, même sortie hors durées optionnelles ;
- zéro appel provider, réseau, filesystem, DB, approval et outil ;
- résultat et observabilité sans contenu privé brut ;
- `actionAuthorized`, `verificationAuthorized` et `recommendationIsAction` toujours `false` ;
- les tests de sécurité/approval/exécution existants restent inchangés ;
- un échec `AgentEvaluationEngine` critique reste bloquant même si une comparaison favorise l'option ;
- le Model Router garde seul la sélection active.

### 13.7 Tests de wiring Portfolio

- payload exclusivement composé d'enums V1 valides ;
- au moins deux options exigées avant appel ;
- snapshots inconnus restent `UNKNOWN`, jamais zéro ;
- risque échéance et capacité ont des evidence refs vérifiées ;
- `SHADOW`, read-only et absence d'autorité inchangés ;
- aucune écriture Goal, Planning, Calendar ou projet.

## 14. Plan de migration

### Tranche 1 — contrat strict, sans changement de verdict

Fichiers exacts :

- `services/decision/decision-schema.js` ;
- `test/decision-support-engine.test.js` ;
- `docs/UNCERTAINTY_DECISION_V1_DESIGN.md` uniquement si un détail de contrat doit être synchronisé.

Travail :

- ajouter les enums et normalisateurs V2 ;
- rendre requis les IDs structurants pour `schemaVersion: 2` ;
- valider références, bornes, dates et DAG ;
- conserver la normalisation V1 actuelle derrière `schemaVersion: 1` pour compatibilité ;
- n'appeler encore le nouveau calcul depuis aucun consommateur.

Critères d'acceptation :

- tests table-driven des entrées valides/invalides et bornes ;
- ordre canonique/fingerprint stable ;
- aucune dépendance, migration, schema DB, provider ou side effect ;
- API V1 existante non cassée.

Validation :

```bash
node --test test/decision-support-engine.test.js
git diff --check
```

### Tranche 2 — moteur pur de preuve et verdicts

Fichiers exacts :

- `services/decision/decision-support-engine.js` ;
- `services/decision/option-evaluator.js` ;
- `services/decision/decision-schema.js` ;
- `test/decision-support-engine.test.js` ;
- `docs/DECISION_SUPPORT_ENGINE.md` ;
- `docs/UNCERTAINTY_DECISION_V1_DESIGN.md` si le contrat accepté évolue.

Travail : filtrage éligible, fraîcheur, dépendances, déduplication, contraintes trois états, conflits matériels, score/couverture séparés, verdicts et propositions de vérification.

Critères d'acceptation : tous les cas de la section 13 passent ; moteur sync/pur ; aucun import provider, outil, persistence ou sécurité opérationnelle ; compatibilité V1 explicitement testée.

Validation :

```bash
node --test test/decision-support-engine.test.js test/agent-evaluation-engine.test.js test/multi-source-synthesis-engine.test.js
git diff --check
```

### Tranche 3 — premier wiring Portfolio en shadow

Fichiers exacts :

- `services/portfolio/portfolio-capacity-engine.js` ;
- `test/portfolio-capacity-engine.test.js` ;
- `test/decision-support-engine.test.js` si un fixture d'intégration est nécessaire ;
- `docs/DECISION_SUPPORT_ENGINE.md`.

Travail : remplacer les enums hors contrat, construire au moins deux options, produire des preuves structurées depuis les snapshots, appeler le contrat V2 et conserver toutes les autorités à `false`.

Critères d'acceptation : verdict stable sur capacité connue/inconnue, aucune mutation, aucune donnée privée dans les métriques, mode `SHADOW`, résultats V1 inchangés hors surface explicitement migrée.

Validation :

```bash
node --test test/portfolio-capacity-engine.test.js test/decision-support-engine.test.js
git diff --check
```

### Tranche 4 — adaptateurs de producteurs, séparés

Sous-tranches indépendantes, chacune avec ses fichiers exacts :

1. Evaluation : `services/decision/agent-evaluation-evidence-adapter.js` (nouveau), `services/evaluation/agent-evaluation-runtime.js`, `test/decision-agent-evaluation-adapter.test.js` (nouveau) et `test/agent-evaluation-runtime.test.js` — projection optionnelle de métadonnées en preuves, sans changer le verdict d'exécution ;
2. Goal : `services/goals/goal-strategy-engine.js` et `test/goal-strategy-engine.test.js` — critère/contraintes V2 et conservation d'un `decisionRecordId` après confirmation seulement ;
3. Synthesis : `services/decision/synthesis-evidence-adapter.js` (nouveau) et `test/decision-synthesis-evidence-adapter.test.js` (nouveau) — projection des claims, conflits et racines indépendantes sans contenu brut dans le résultat ;
4. DEV : `services/decision/dev-evidence-adapter.js` (nouveau) et `test/decision-dev-evidence-adapter.test.js` (nouveau) — projection optionnelle des validations et hashes, sans changer Code Context ni Sandbox.

Chaque sous-tranche doit pouvoir être annulée sans modifier le noyau.

### Tranche 5 — Reasoning / UI, après décision produit

Cette tranche est volontairement différée. Elle nécessite de décider :

- comment une comparaison est explicitement demandée ;
- qui fournit les options et critères ;
- comment les preuves non vérifiées sont présentées ;
- comment l'utilisateur autorise une vérification ;
- comment un choix est confirmé et éventuellement enregistré.

Elle ne doit pas commencer par modifier la boucle outil de `NoonOrchestrator`.

Une fois ces décisions prises, le périmètre de code prévu est :

- `services/decision/decision-orchestrator-adapter.js` (nouveau) ;
- `services/orchestration/noon-orchestrator.js` ;
- `server.js` ;
- `test/decision-orchestrator-adapter.test.js` (nouveau) ;
- `test/noon-orchestrator.test.js` ;
- les fichiers renderer/preload ne seront ajoutés à cette liste qu'après choix explicite de l'UX et de la frontière IPC.

Critères d'acceptation minimaux : intention `COMPARE` explicite seulement, résultat read-only, aucune exécution de vérification, aucune mutation depuis `DECIDED`, confirmation distincte avant `recordChoice()`, et pipeline de sécurité inchangé.

## 15. Risques et décisions encore bloquantes

Risques maîtrisables par le design :

- migration de l'ancien `recommendationType` vers les quatre verdicts ;
- divergence de vocabulaire entre Evaluation, Synthesis et Decision ;
- consumers actuels dépendant des fallbacks d'enums ;
- confusion entre score heuristique et confiance ;
- fuite de contenu via citations/locators ;
- cache conservant une preuve après révocation ;
- tentation d'utiliser `DECIDED` comme permission.

Décisions réellement bloquantes pour des phases ultérieures, mais pas pour les tranches 1–3 :

1. activer ou non une persistence durable de `DecisionRecord` et choisir son repository canonique ;
2. définir l'UX de confirmation et de vérification avant le wiring conversationnel ;
3. définir un protocole de calibration si Noon veut un jour publier une probabilité.

Protocole futur de calibration, non implémenté : constituer un corpus versionné de décisions avec outcomes observables, séparer entraînement/validation temporellement, mesurer Brier score et diagrammes de fiabilité par domaine, documenter la dérive et n'activer un champ probabiliste qu'après seuils pré-définis. Jusque-là : `NOT_CALIBRATED`.

## 16. Première tranche prête à confier à Codex

**Périmètre : contrat V2 strict uniquement.** Aucun changement de calcul, consumer, route, provider, persistence, package, schema DB ou UI.

Fichiers autorisés :

- `services/decision/decision-schema.js` ;
- `test/decision-support-engine.test.js` ;
- `docs/UNCERTAINTY_DECISION_V1_DESIGN.md` seulement si une incohérence de contrat est découverte.

Implémentation attendue :

1. ajouter les constantes et normalisateurs des structures `DecisionRequestV1` documentées ici sous `schemaVersion: 2` ;
2. exiger IDs stables, références valides, dates explicites et enums stricts ;
3. valider unicité, bornes et graphe de dépendances ;
4. canonicaliser l'ordre pour un fingerprint stable ;
5. préserver intégralement le chemin `schemaVersion: 1` existant ;
6. exporter seulement les primitives nécessaires au futur moteur pur.

Critères d'acceptation :

- une fixture V2 complète est normalisée sans perte de champ structurant ;
- tous les cas invalides produisent un code d'erreur stable ;
- l'ordre d'entrée ne change pas la forme canonique ni le fingerprint ;
- aucune UUID et aucune horloge cachée pour V2 ;
- aucun import réseau/provider/DB/filesystem ;
- tests existants V1 et nouveaux tests V2 ciblés passent ;
- `git diff --check` passe ;
- aucun staging, commit ou push.
