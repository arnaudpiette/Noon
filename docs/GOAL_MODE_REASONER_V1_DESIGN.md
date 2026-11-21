# Goal Mode 5.0D — Reasoner vers proposition 5.0C (design V1)

> **Statut au 21/11/2026 : design livré, conservé comme trace de conception.**
> Le document de référence sur le comportement actuel est
> [`GOAL_MODE_DEV_EXECUTION.md`](GOAL_MODE_DEV_EXECUTION.md). En cas d'écart,
> le code et ce document de référence priment.
>
> | Tranche décrite ici | Livrée par |
> |---|---|
> | 5.0D-0, réservation du budget de planning avant l'appel | `eb4a0e1` |
> | 5.0D, appel de planning borné validé par 5.0C | `a774ad2` |
> | Propositions d'étape durables | `0dbccc6` |
> | 4C-1A/B/C, remise exacte, recheck réservé, approbation unique | `adb6bc1`, `4c0ee1c` |
> | 4C-1D et 4C-2, statut, annulation, réconciliation | `1d8e1bb` |
> | Branchement serveur B1 à B4c | `e2cf271` … `ea27330` |

Statut d'origine (20/10/2026) : design ciblé, sans wiring ni appel fournisseur. La sortie du modèle est une
assertion non fiable. Seul le planner canonique peut produire une proposition
validée ; celle-ci n'est ni une permission, ni une réservation de l'étape future.

## Réutilisation et frontière actuelle

- `services/goals/goal-mode-run-contract.js` (5.0A) fixe le Goal confirmé,
  `goalVersion`, scope, `localOnly`, plafonds de capacités et limites globales
  `maxSteps`, `maxRetries`, `maxProviderCalls`, `maxDuration`,
  `maxEstimatedCost`. Son `assessGoalModeBudget()` est un contrôle, pas une
  réservation.
- `services/goals/goal-mode-run-state.js`,
  `services/goals/goal-mode-run-store.js` et
  `services/persistence/repositories/goal-mode-run-repository.js` (5.0B)
  conservent l'accounting strict et des snapshots append-only. `consume()`
  exige `expectedRevision` ; SQLite utilise `BEGIN IMMEDIATE` et un CAS sur
  la révision. Le fallback JSON ne garantit pas le CAS inter-processus.
- `services/goals/goal-mode-next-step-planner.js` (5.0C) relit le run depuis
  le store et le Goal via `GoalStrategyEngine.registry.get`, vérifie version,
  empreintes, scope et état `RUNNING`, puis sélectionne une cible canonique.
  `validate({ runId, selection, proposal })` relit et recalcule la sélection :
  révision du run, version du Goal et `targetFingerprint` doivent rester
  cohérents. `STOP` ou `BLOCKED` ne déclenchent aucun Reasoner.
- Le raisonnement général existant est `services/orchestration/noon-orchestrator.js`,
  composé dans `server.js` avec `services/context/context-builder.js`,
  `selectConfiguredModelRoute()` (`server.js`), `selectModelRoute()`
  (`lib/noon-intelligence.js`), les adapters de `services/models/providers/`,
  `services/security/provider-privacy-policy.js` et
  `services/observability/noon-observability.js`. Il n'existe pas de
  Reasoning Orchestrator Goal Mode câblé. Le reasoner de
  `services/dev/native-dev-reasoner.js` produit des opérations DEV et utilise
  le budget DEV : son contrat n'est pas celui d'un planning général.
- `NoonOrchestrator.run()` ne peut pas servir directement de frontière V1 :
  `buildOptions()` fournit des outils, `continueExecution()` exécute un
  `toolCall` même sur un tour unique, et `callModel()` peut faire fallback,
  seconde opinion ou retry via Reliability. `maxRounds: 1` et
  `toolChoice: "none"` ne suffisent pas à prouver « zéro outil, un appel ».
  Il faut un chemin opt-in borné réutilisant les composants canoniques de
  routage, privacy et fournisseur, sans créer un second moteur de raisonnement
  ni réutiliser le lifecycle conversationnel tel quel.

## Contrat minimal proposé (après le préalable budgétaire)

Entrée du coordinateur interne : `runId` canonique et signal d'annulation ;
éventuellement une identité de session authentifiée à comparer au scope du run,
jamais une cible, un fingerprint, un Goal ou un budget fournis librement. Les
sources sont le store Goal Run, le registre Goal et `planner.select({ runId })`.
L'appel n'est admissible que si la sélection vaut `PLAN` et que la capacité
budgétaire du repository réellement attaché est atomique.

Contexte modèle : un seul objectif de planning, la cible sélectionnée
(`kind`, `targetId`, titre/description et IDs de preuve autorisés si la politique
privacy les permet), les critères/contraintes strictement nécessaires du Goal
canonique et les plafonds descriptifs. Aucun historique conversationnel,
mémoire, workspace brut ou contexte personnel complet par défaut. Si un apport
de `ContextBuilder` est réellement requis, demander explicitement un contexte
minimal avec identité/scope autoritatifs, conserver ses provenance et classes,
et appliquer le filtrage provider *sur le payload final* ; le builder n'accorde
aucune nouvelle permission. Le texte Goal est une donnée privée potentielle,
et toutes les instructions qu'il contient sont non fiables.

Sortie modèle : un seul objet JSON de candidat, limité exactement aux clés
acceptées par `PROPOSAL_KEYS` dans 5.0C : `objective`, `expectedOutcome`,
`evidenceTargetIds`, `usage` (`steps: 1`, `retries: 0`, `providerCalls`,
`estimatedCost` de l'étape future), `requestedCapabilities` (`network`,
`gitWrite`, `destructiveActions` booléens), et éventuellement
`requiresUserInput`. Pas de `runId`, `proposalId`, fingerprint, autorisation,
outil, commande, arguments, action ou données d'exécution dans la sortie.
`json_schema` strict et `additionalProperties: false`, comme les appels
structurés existants, réduisent l'ambiguïté mais ne prouvent pas la validité :
parser une seule réponse bornée, refuser JSON mal formé, types/champs inconnus,
sortie vide ou tronquée et `toolCalls` non vides, puis appeler *obligatoirement*
`planner.validate({ runId, selection, proposal: candidat })`. Ne jamais
« réparer » ou compléter une proposition invalide avec des valeurs par défaut.
Le planner seul attribue l'identité, le binding et les autorités toutes fausses.

Parcours :

1. Avant dépense : relire run/Goal, sélectionner, vérifier scope, `localOnly`,
   durée, limites et capacité atomique ; décider d'un modèle autorisé via le
   routeur effectif et le contrôle privacy. Une route legacy peut ignorer le
   plafond de coût : vérifier indépendamment modèle, capacité structurée,
   estimation finie et plafond avant la réservation. Interdire second avis,
   shadow, fallback, compatibilité-retry et délégation sur ce chemin.
2. Réserver durablement *avant* l'appel une seule tentative de planning, avec
   `expectedRevision` et place pour un providerCall et un coût estimé borné.
   Si conflit, recharger et refuser ou recommencer seulement le préflight
   **sans** appel ; jamais de retry de modèle implicite. Marquer durablement
   l'entrée en zone « may have started » avant d'invoquer le fournisseur.
3. Appeler une fois l'adapter canonique, `store: false`, sans tools ni streaming,
   avec signal et timeout bornés ; inspecter statut terminal, sortie et usage.
   Réconcilier l'observation réellement reçue et l'issue durablement avant
   toute nouvelle dépense. Un succès de planning peut coûter même si le
   candidat est invalide, refusé, annulé après départ ou devenu stale.
4. Après l'appel asynchrone : relire run/Goal et faire passer le candidat par
   `planner.validate()`. Si réserver ou réconcilier incrémente `runRevision`,
   la sélection initiale devient stale *par nos propres écritures*. Le
   protocole doit conserver la chaîne exacte de révisions appartenant à cette
   tentative, sélectionner sur le snapshot post-réservation, puis, après
   réconciliation, comparer Goal/version/cible/fingerprint à ceux du départ
   et sélectionner sur le snapshot terminal uniquement si **toutes** les
   révisions intermédiaires sont attribuables à cette tentative. Donner cette
   dernière sélection à `planner.validate()` ; ne jamais réécrire les IDs ou
   le fingerprint du candidat pour masquer un changement externe. Si une
   autre mutation intervient, rejeter le candidat comme `STALE`, même si
   l'issue comptable doit encore être enregistrée durablement. Tester Goal,
   run et cible modifiés pendant l'attente, ainsi qu'un conflit de
   réconciliation : celui-ci ne doit ni perdre l'issue ni valider le candidat.

Sorties du coordinateur : `VALIDATED_PROPOSAL` (objet immuable retourné par
5.0C), `BLOCKED`, `INVALID`, `STALE`, `CANCELLED`, `TIMED_OUT` ou
`USAGE_UNCERTAIN`, avec codes bornés et métadonnées locales. Aucune sortie
n'est un tool call, un statut de succès du Goal ou une instruction d'exécuter.

## Budget, concurrence et coût honnête : préalable bloquant

Le `usage` dans un candidat 5.0C estime **l'étape future** ; il ne paie pas
l'appel Reasoner. Les providerCalls et le coût de ce dernier doivent compter
séparément dans les limites globales du même run, même si le modèle ne produit
aucune proposition valide. `estimatedCost` du contrat est une limite
**estimée**, pas une facture exacte ni une preuve d'un plafond monétaire
fournisseur. Un prix inconnu ou une borne de tokens non justifiable bloque
l'appel ; ne pas convertir l'inconnu en zéro.

Ni `planner.validate()` ni `runStore.consume()` après l'appel ne suffisent :
deux appels concurrents peuvent passer un préflight, dépenser, puis seulement
l'un gagner le CAS. `services/dev/dev-cost-budget-service.js` a bien
`reserve/reconcile/markUnknown`, mais ce ledger JSON est de portée DEV, n'a
pas le CAS inter-processus Goal Run et n'est pas l'autorité des limites 5.0A.
La télémétrie `NoonObservability` est également descriptive, pas un ledger.

Préalable 5.0D-0 : étendre le *store/repository Goal Mode canoniques* avec un
état de tentative de planning borné, append-only, lié à `runId`, révision et
scope, et un protocole atomique « réserve → départ possible → réconcilie ».
Le CAS SQLite doit compter, dans une même décision, dépenses observées,
réservations et issues incertaines pour `maxProviderCalls` et
`maxEstimatedCost`, sans consommer un `step` futur. Une réservation perdante
ne lance rien. L'état `may have started` ou une persistance de réconciliation
échouée garde la capacité bloquée jusqu'à constat explicite ; ni expiration
automatique, ni redémarrage, ni timeout ne la libèrent comme si aucun appel
n'avait eu lieu. Une panne avant réservation durable interdit l'appel. Le
fallback JSON et un repository inconnu refusent cette capacité. Les snapshots
antérieurs restent lisibles ; aucune absence de donnée d'usage introduite par
le nouveau protocole ne devient un zéro observé. Ce préalable nécessite un
contrat versionné et des tests de compatibilité, pas une migration ici.

Les adapters normalisent actuellement les tokens manquants à `0`
(`services/models/providers/openai-provider.js` et
`services/models/providers/gemini-provider.js`) ; `NoonObservability` fait de
même pour certains métriques. Une intégration réelle doit conserver un signal
fiable « usage absent/incomplet » avant cette normalisation. `0` explicitement
observé reste zéro ; absence d'usage, erreur réseau, annulation ou réponse
ambiguë restent `UNKNOWN` et bloquent une nouvelle dépense tant que leur
issue ne peut être réconciliée. Le plafond par appel doit être borné avant
départ ; une simple estimation moyenne du routeur n'est pas un maximum prouvé.

## Confidentialité, erreurs et observabilité

`ProviderPrivacyPolicy` doit inspecter le payload final et autoriser le
provider exact par son token interne avant tout appel. `ContextBuilder`
distingue `localContext` et `remoteModelContext` et expose provenance,
classifications et exclusions ; une citation ou métadonnée n'autorise pas
l'egress. `localOnly` du run ou d'une source interdit tout provider distant,
sans fallback. `services/runtime/local-model-adapter.js` existe mais
`server.js` le compose sans modèle prêt par défaut ; le registre local n'est
pas une route structurée équivalente dans `selectModelRoute()`. Faute de
capacité locale réellement prête et contractuellement compatible :
`LOCAL_MODEL_UNAVAILABLE`, zéro appel distant et aucune prétention de
proposition valide. Un futur modèle local devrait passer le même parser et 5.0C.

Refus privacy, absence de modèle, sortie invalide, refus modèle, timeout et
annulation donnent un échec explicite, jamais une proposition de substitution
ni un retry automatique. Après départ, l'absence de réponse n'établit pas
l'absence de dépense. Aucune mutation du Goal, milestone ou critère ; aucune
permission, approval, réservation d'étape ou action externe. Security,
Intervention, Approval et Transactional Execution gardent leurs autorités.

Observabilité : réutiliser les codes/compteurs sûrs de
`services/observability/noon-observability.js` pour route, provider, durée,
état de réservation, validité, stale et usage connu/inconnu. Ne jamais y
écrire prompt, réponse, titre/description du Goal, contenu de contexte,
secret, chemin privé ou token privacy. Ses coûts calculés et comptes de
tokens normalisés ne sont pas, à eux seuls, la preuve comptable durable.

## Tests déterministes et première tranche

Pour 5.0D-0 : deux connexions SQLite, réservations concurrentes près des
plafonds, CAS perdant sans départ, JSON/unknown fail-closed, redémarrage en
état `may have started`, persistance échouée, sortie/usage inconnus distincts
de zéro observé, historique append-only, refus de libération automatique,
compatibilité des anciens snapshots et des tests 5.0A/5.0B/5.0C. Utiliser
horloge et adapters simulés, aucune requête réelle.

Pour le câblage ultérieur 5.0D : un seul appel, zéro outil/fallback/retry,
scope et privacy sur payload final, `localOnly` sans egress, JSON strict et
champs interdits, budget du planning distinct de `proposal.usage`, refus,
timeout/annulation, absence d'usage, échec de réconciliation, mutation Goal/run
pendant l'attente, validation 5.0C réelle et absence d'effet. Vérifier
explicitement les options de routage legacy et les sorties provider tronquées.

Première tranche recommandée : **5.0D-0, protocole de réservation et d'issue
incertaine dans le Goal Mode Run Store/State/Repository SQLite**, avec tests
directs, sans appel modèle ni wiring. Fichiers de départ :
`services/goals/goal-mode-run-state.js`,
`services/goals/goal-mode-run-store.js`,
`services/persistence/repositories/goal-mode-run-repository.js` et leurs tests
`test/goal-mode-run-state.test.js`, `test/goal-mode-run-persistence.test.js`,
`test/goal-mode-run-contract.test.js`. Définir la politique de borne par appel
et de traitement de l'usage absent avant la tranche d'intégration Reasoner.

## Prérequis ciblés de 5.0D-4C-1 — remise, révision et autorisation DEV

Cette section complète le design précédent ; elle ne rend pas 4C-1 exécutable.
La proposition 5.0C, l'admission 5.0D-3, la projection 4B et la réservation
4C-0 sont quatre frontières distinctes. Leurs fingerprints ne sont ni des
permissions ni des preuves d'intention humaine.

### Contrat A : remise de la projection exacte

- `services/goals/goal-mode-step-admission-service.js::admit()` exige que
  `planningRef.proposalRunRevision` égale la révision courante, un Goal
  ACTIVE/confirmé et une cible recalculée via 5.0C. Toutes ses autorités
  restent `false` ; projection d'action, Security, Intervention et Approval
  restent nécessaires.
- `services/goals/goal-mode-dev-projection-service.js::project()` relit run,
  step, Goal, workspace, projet et dépôt, puis calcule `devContract` :
  `runRef.runRevision`, fingerprint, taskId, root/branch, quotas et restrictions
  viennent des sources canoniques. Ce contrat contient potentiellement objectif,
  contraintes et chemins privés : jamais de log, résultat public ou télémétrie.
- `services/goals/goal-mode-run-store.js::reserveExecution()` recalcule 4B
  dans la réservation, vérifie ses champs critiques, puis persiste par CAS un
  binding et `PREPARED`. Il ne retourne que le snapshot. Le binding contient
  révision initiale, Goal/version, step/fingerprint, taskId et cible, pas le
  `devContract`, les instructions projet ou une permission.
- `services/goals/goal-dev-execution-service.js::run()` reprojecte aujourd'hui
  Goal→DEV depuis sa requête ; `services/dev/native-dev-orchestrator-facade.js`
  délègue ensuite l'input à Native. Transmettre des champs du binding à ce
  chemin ne garantit donc pas le contrat 4B exact.

Proposition : une variante **interne** de la réservation remet seulement
après CAS réussi `{ snapshot, handoff }`. `handoff` est une copie détachée,
strictement formée, profondément immuable de la projection 4B qui a produit
le binding ; elle lie `reservationId`, révision d'admission `r`, révision
persistée `r+1`, `runRef`, `stepRef`, `taskRef`, quotas et `devContract`.
Aucun contrat libre du caller, ni stockage durable de contenu privé ou de
permissions périssables. Une marque interne de provenance peut prévenir une
confusion de composition JavaScript, sans être une capacité cryptographique
ou une isolation OS. L'API historique de `reserveExecution()` reste inchangée.

Le service aval doit comparer handoff et réservation canonique, puis livrer
**ce même** `devContract.devInput` à Native sans refaire
`projectGoalDevExecution()`. Avant départ, il recharge droits effectifs,
règles/projet (`projectInstructions`), état workspace/dépôt et privacy : ces
données courantes ne peuvent que refuser ou restreindre, jamais modifier
silencieusement objective, root, branch, allowedPaths, taskId, `localOnly`,
quotas ou capacités réservés. Un contrat devenu différent est stale/refus.
Après restart, le handoff a disparu : binding et fingerprint seuls interdisent
dispatch et reconstruction « équivalente ». Une projection recalculée
identique ne vaut pas autorisation.

### Contrat B : recheck du step déjà réservé

Soit `r` la révision admise conservée dans le binding. Le CAS de réservation
produit exactement `r+1` avec le dernier record `PREPARED` ; le CAS
`markExecutionMayHaveStarted()` produit exactement `r+2` avec le même
`reservationId` et `MAY_HAVE_STARTED`. Le recheck vérifie ces transitions
attribuables à **cette** tentative, l'historique append-only, step durable,
Goal/version, cible/fingerprint, scope et restrictions encore actuelles.
Il refuse mutation étrangère ou révision inattendue ; `> r` ne suffit pas.
Une mutation gagnant entre contrôle et marquage doit faire échouer le CAS.
Après `MAY_HAVE_STARTED`, une modification externe ne rend jamais l'effet
rejouable : conserver la charge incertaine et traiter la clôture en 4C-2.

Créer un `recheckReservedExecution` distinct de `admit()` : ce dernier refuse
correctement `r+1` pour **un nouveau** step. Le recheck relit le run/step
canoniques et recalcule la cible sans exiger que `proposalRunRevision` devienne
`r+1`. Il ne supprime aucun contrôle substantiel de Goal, dépendances, cible,
scope ou budget ; la révision attendue est explicite, jamais remplacée par
la dernière. Le préflight Native (`services/delegation/repository-preflight.js`)
vérifie ensuite root/branch courants, sans prouver leur stabilité ultérieure.

### Contrat C : autorisation du lancement et des opérations

`services/dev/native-dev-implementation-engine.js::authorize()` construit
actuellement `origin:"explicit_user_chat"`, `explicitOrder:true` et
`currentPermissions.allowed:true` avec code `READ_WRITE_WORKSPACE` ou
`TERMINAL_SAFE` littéral. `executeSkill()` fournit ensuite
`explicitOrder:true`, `confirmed:true` à `skills/registry.js` et une
précondition transactionnelle toujours valide. Ce chemin Native historique
n'établit pas un ordre ou une confirmation humaine pour Goal Mode.
`services/delegation/dev-task-contract.js` borne la tâche mais n'approuve
aucune opération. La policy a elle-même un fallback `allowed:true` si aucun
permissionProvider n'est fourni : l'intégration Goal Mode doit refuser ce
fallback et obtenir la permission effective depuis la composition canonique.

Chaîne requise : ActionRequest d'origine Goal Mode non usurpée + permission
effective → `services/security/operational-security-policy.js` →
`services/security/intervention-permission-engine.js` →
`services/approvals/approval-engine.js` si nécessaire → contrôle JIT Native et
`services/execution/transactional-execution-engine.js` → skill. `DENY` et
`UNAVAILABLE` refusent ; `CONFIRM` attend une action exacte ; `PROCEED` ne
porte que sur l'opération évaluée. Une origine `model_generated` mutative
est DENY par défaut : `isSpecialistProposal` ne devient pas vrai du seul fait
qu'un modèle propose l'action. Approval ne contourne ni DENY, privacy,
local_only, sandbox APPLICATION_CONSTRAINED, budget ou préconditions JIT.

Le lancement borné porte seulement sur tâche, Goal/run/step/réservation,
workspace, root/branch, egress/provider et plafonds vérifiés. Si la route
ou les droits requis ne peuvent être établis avant départ, refus sans appel.
Cela n'autorise pas globalement validations, commandes ou éditions inconnues.
Le reasoner Native peut dépenser dès PLAN, avant une édition
(`services/dev/native-dev-implementation-engine.js`,
`services/dev/native-dev-reasoner.js`) : persister `PREPARED`, rechecker les
droits, puis persister `MAY_HAVE_STARTED` **avant** `runTask()` ou tout appel
modèle. Une attente pré-départ n'autorise ni release automatique ni reprise
après perte du handoff.

Les skills réels incluent `noon_dev_run_validation`
(`skills/dev/run-validation.js`) et `noon_dev_apply_edit`
(`skills/dev/apply-edit.js`) via `skills/registry.js`. Les éditions exactes ne
sont connues qu'après PLAN/EDIT. La pause doit être **avant**
`authorize()/executeSkill()` pour chaque action concrète, avec args/target et
préconditions exacts. `CONFIRM` prépare une approval one-shot sans lancer le
skill ; en mémoire, la reprise garde l'opération immuable sans nouvel appel
modèle. `ApprovalEngine.resumeApprovedAction()` revalide token, décision,
exactAction, expiration, règles, permission et préconditions avant le même
contrôle JIT et Transactional Execution. Le précédent
`services/goals/goal-dev-approved-retry-service.js` montre un binding interne
Retry et un CAS JIT, pas une permission Goal Mode générale.

Native n'offre aujourd'hui ni pause ni reprise à cette frontière.
`TransactionalExecutionEngine` peut marquer `AWAITING_APPROVAL`, mais refuse
de réexécuter le plan actif et son journal ne garde pas les arguments exacts.
Après crash/perte de l'opération, aucun resume, deuxième modèle ou édition
automatique. Une issue ambiguë après `MAY_HAVE_STARTED` reste restrictive
(`UNKNOWN` seulement si sa transition durable est justifiée), jusqu'à une
récupération explicite ; 4C-2 reste hors périmètre. Refus, expiration ou stale
de l'approval ne sont pas remplacés par une action voisine.

### Ordre des travaux et tests déterministes

1. **4C-1A, remise exacte sans dispatch** : variante interne de réservation
   rendant le contrat 4B copié/figé après succès CAS, sans changer l'API
   historique ni la persistance. Tester CAS perdant, identité exacte,
   mutation impossible, aucune fuite publique et impossibilité de repartir
   du seul fingerprint. Fichiers : `services/goals/goal-mode-run-store.js`,
   `test/goal-mode-execution-reservation.test.js`.
2. **4C-1B, recheck réservé sans dispatch** : distinguer admission neuve du
   recheck `r → r+1 → r+2`, reservationId, historique, Goal, step, cible et
   restrictions. SQLite temporaire à deux connexions/barrières, mutation
   entre contrôle et CAS, Goal modifié hors run, step historique. Fichiers
   envisagés : `services/goals/goal-mode-step-admission-service.js`,
   `services/goals/goal-mode-run-store.js` et leurs tests directs ; arrêter
   l'extraction minimale de cible avant patch.
3. **4C-1C, autorisation sans effet** : permissions réelles, Policy et
   Intervention pour lancement et actions exactes ; tester DENY/GUIDE/
   CONFIRM/PROCEED, local_only, branch, budget, origine et absence de
   `explicitOrder`/`confirmed` fabriqués. Identifier le point de composition
   serveur avant patch, sans booléen d'autorité caller.
4. **4C-1D, pause Native et dispatch contrôlé** : suspension avant chaque
   skill, approval d'action exacte one-shot, recheck JIT puis Transactional
   Execution. Préserver les callers Native explicites. Avec reasoner/skills
   simulés, tester zéro appel avant MAY, refus/attente, changement après
   approval, crash/restart sans replay, appels/effets et verdicts inchangés.
   Fichiers probables : moteur Native, composition Goal Mode/Goal DEV et tests
   ciblés ; périmètre exact à arrêter après 4C-1A/B/C.

Cette séquence ne crée ni engine, ni repository Approval, ni Budget Manager
parallèle. 4C-1D produirait une observation DEV, jamais une réconciliation
comptable `RECONCILED` sans lecteur canonique 4C-2.
