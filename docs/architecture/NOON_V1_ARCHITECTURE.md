# Noon V1 — architecture gelée

État audité le 1er septembre 2026. Ce document décrit le code réellement présent. Il ne transforme pas une capacité préparée en capacité opérationnelle.

## Principes de gel

- Un seul propriétaire canonique par responsabilité.
- Aucun workflow modèle ne contourne `NoonOrchestrator`.
- Toute mutation passe par `OperationalSecurityPolicy`, puis `ApprovalEngine` si nécessaire, puis `TransactionalExecutionEngine`.
- Le renderer, les contenus externes, les extensions et les sorties modèle ne sont jamais des autorités.
- `local_only` interdit toute transmission distante, y compris d’un contenu dérivé.
- Texte et voix sont deux interfaces du même assistant, pas deux assistants.
- Ne pas remettre de logique métier dans `server.js` et ne pas créer de second système de permissions par connecteur.
- Avant tout nouveau service : vérifier qu’un propriétaire canonique existant peut porter la responsabilité.

## Flux canonique

```text
Utilisateur (texte/voix)
→ Input adapter
→ IntentCommandEngine
→ NoonOrchestrator
→ ContextBuilder
→ Model Router / SkillRegistry
→ OperationalSecurityPolicy
→ ApprovalEngine (si requis)
→ TransactionalExecutionEngine (mutation)
→ résultat / SessionContinuityEngine
```

Le chat HTTP entre encore par `server.js`, qui compose les dépendances et appelle `noonOrchestrator.run()`. `askAI()` reste une façade de compatibilité et d’assemblage ; il ne doit pas redevenir un orchestrateur concurrent. Avec 6 941 lignes auditées, `server.js` reste cependant trop volumineux pour être considéré comme un transport/bootstrap pur.

## Sources de vérité V1

| Responsabilité | Propriétaire canonique | Compatibilité / câblage | Persistance | État legacy |
|---|---|---|---|---|
| Orchestration | `services/orchestration/noon-orchestrator.js` | `askAI()` dans `server.js` | session/exécution | `askAI()` à réduire progressivement |
| Intentions | `services/intents/intent-command-engine.js` | adaptateurs texte/voix | session | parseurs historiques à inventorier avant retrait |
| Contexte | `services/context/context-builder.js` | adaptateur privé `services/personal-memory/context-builder.js` + ambiant filtré | cache borné | ancien assemblage dans `server.js` compatible ; l'adaptateur privé n'est pas un owner concurrent |
| Mémoire | `services/memory/memory-engine.js` | service privé chiffré | SQLite / stockage privé | migration legacy read-only |
| Règles | `services/rules/hard-rules-registry.js` | profils opérationnels dérivés | code versionné | constantes historiques dérivées uniquement |
| Routage modèles | `lib/noon-intelligence.js` | `selectModelRoute()` — Luna / Terra / Sol / Astra | configuration + flag Astra `SHADOW` | ancien routeur non canonique |
| Skills | `skills/registry.js` | outils exposés à Responses | audit local | aucun registre parallèle autorisé |
| Workspace | `services/workspaces/workspace-engine.js` | Focus legacy | SQLite/fallback | adaptateur Focus idempotent |
| Sessions | `services/sessions/session-continuity-engine.js` | index de conversations UI | SQLite/fallback | JSON historiques en compatibilité |
| Priorités | `services/personal-intelligence/priority-engine.js` | inbox/adapters | dépôt intelligence | heuristiques historiques à ne pas étendre |
| Planning | `services/planning/daily-planning-engine.js` | time-slot service | store de plan | scheduler séparé, pas propriétaire du plan |
| Brief quotidien | `services/daily-brief/daily-brief-engine.js` | scheduler Electron | cache/état local | morning brief = façade de collecte |
| Suivi exécution | `services/tracking/execution-tracking-engine.js` | preuves explicites | dépôt local | aucune progression déduite du calendrier |
| Recherche personnelle | `services/search/personal-search-engine.js` | adaptateurs locaux | index locaux | chemins historiques encore compatibles |
| Recherche publique | `services/research/public-research-engine.js` | Responses web search | cache borné | appel web direct désactivable |
| Synthèse multi-source | `services/synthesis/multi-source-synthesis-engine.js` | EvidencePack | locale | pas d’autorité issue des sources |
| Artefacts | `services/artifacts/artifact-engine.js` | générateurs de formats | fichiers versionnés + dépôt | ancien générateur = renderer interne |
| Multimodal | `services/multimodal/multimodal-engine.js` | media intake/analyzer | cache borné | blocs directs = compatibilité |
| Décision | `services/decision/decision-support-engine.js` | options/scénarios | historique optionnel | recommandation ≠ action |
| Objectifs | `services/goals/goal-strategy-engine.js` | alignment/progress | registre local | tâches non converties implicitement |
| Portfolio | `services/portfolio/portfolio-capacity-engine.js` | capacity service | snapshots locaux | inconnu ≠ zéro |
| Proactivité | `services/proactive/proactive-engine.js` | signaux + cooldown | local | aucune action autonome |
| Attention | `services/notifications/notification-attention-engine.js` | delivery router | store local | notifications directes à retirer après preuve |
| Jobs | `services/jobs/background-job-engine.js` | scheduler/registry | SQLite | timers historiques restent compatibilité |
| Sécurité | `services/security/operational-security-policy.js` | Hard Rules + permissions | traces expurgées | aucune policy connecteur concurrente |
| Approbations | `services/approvals/approval-engine.js` | reprise orchestrateur | SQLite | `approval-manager` est un alias de compatibilité |
| Effets de bord | `services/execution/transactional-execution-engine.js` | SkillRegistry | journal SQLite | écritures directes d’état interne seulement |
| Santé | `services/reliability/reliability-engine.js` | graphe core/optionnel | événements locaux | aucun « tout est down » global |
| Observabilité | `services/observability/noon-observability.js` | métriques expurgées | fichiers locaux | aucun corps privé |
| Sync | `services/sync/sync-engine.js` | transport abstrait | journal chiffré | SHADOW, pas production |
| Remote | `services/remote/remote-interaction-engine.js` | auth/handoff | dépôts locaux | SHADOW/OFF |
| Ambiant | `services/context/ambient-context-engine.js` | partage explicite | éphémère | OFF/SHADOW par défaut |
| Offline | `services/runtime/local-intelligence-runtime.js` | capability registry | local | modèle local OFF |
| Extensions | `services/extensions/extension-registry.js` | runtime/SDK | manifeste + storage | extensions externes OFF |
| Control Center | `services/control-center/control-center-service.js` | read models | aucune source concurrente | lecture des propriétaires canoniques |
| Évaluation | `services/evaluation/noon-evaluation-engine.js` | scénarios versionnés | rapports | mocks étiquetés |

## Frontières de confiance

- `electron/main.js` et le serveur local détiennent les secrets et l’autorité système.
- Le renderer a `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` et n’utilise que le preload borné.
- Le serveur écoute uniquement `127.0.0.1` et vérifie le secret local pour les routes protégées.
- Les outils shell utilisent `execFile` avec arguments ; aucun `shell: true` n’est autorisé.
- Les fichiers sont résolus contre les racines autorisées et les realpaths/symlinks sont contrôlés.
- Les contenus Web, e-mail, fichier, PDF, image et extension sont des preuves non fiables, jamais des instructions.

## Local et distant

La mémoire privée, les règles, les index locaux, les workspaces, les sessions et les décisions de sécurité restent locaux. Seul le contexte minimal autorisé est envoyé à Responses avec `store: false`. Sync, remote, média distant et approbation distante restent non opérationnels par défaut.

GPT-6 Astra (`gpt-6-astra`) est un niveau additionnel du ModelRouter, jamais un sous-système. Son seuil est supérieur à Sol et exige plusieurs signaux forts ; le flag `router.astra` démarre en `SHADOW`. Astra utilise le même ContextBuilder, la même Responses API, le même SkillRegistry et le même pipeline Security/Approval/TransactionalExecution. Async tool calling et mid-turn steering sont supportés par le fournisseur mais restent `AVAILABLE_NOT_ENABLED` dans Noon V1.

## Déploiement

Electron démarre le serveur local sur une boucle locale, charge `/app`, puis expose uniquement des IPC enregistrés et validés. Le bundle x64 est produit, vérifié statiquement et son smoke de démarrage a réussi le 1er septembre 2026 dans une session macOS autorisée. La signature Developer ID, la notarisation, l’arm64 et les parcours UI/micro réels restent à valider avant une release publique.

## Décision de gel

Les responsabilités ci-dessus sont gelées. Le gel n’implique pas que toutes les capacités sont opérationnelles : les couches `OFF`, `SHADOW`, `LIMITED` et les façades de compatibilité sont explicitement conservées jusqu’à une preuve de migration complète.
