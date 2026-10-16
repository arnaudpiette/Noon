## 3 — V2 historique : les extensions déjà entreprises (par versions et chantiers)

### V2.1 à V2.4 · Providers et routeur
- **V2.1 :** abstraction des fournisseurs, interfaces/health/erreurs/capacités.
- **V2.2 :** Provider Privacy Policy (`local_only`, secrets, données protégées, données dérivées).
- **V2.3–V2.4 :** routeur multi-provider, coût/latence/qualité, fallbacks revérifiant la privacy et **second opinion** sur déclencheur explicite plutôt que systématique.
- Modèles et fournisseurs explorés : OpenAI **Luna / Terra / Sol / Astra en SHADOW** ; Gemini, Claude et local (Ollama/llama.cpp) selon permission, disponibilité et besoins. Un fournisseur envisagé n’est pas automatiquement activé ni validé.
- **À faire :** apprentissage réel du routage basé sur mesures, suivi des budgets journée/mois, benchmarks représentatifs, activation progressive des providers réellement configurés.

### V2.5 · Agents spécialistes et Code Brain
- Delegation Engine, spécialiste Codex, `DevTaskContract`, `RepositoryPreflight`, vérification du code et des tests indépendamment du message « réussi » d’un agent.
- Profils de travail : architecte, implémentation, QA/review, sécurité/release, DA/DEV, projets ; délégation bornée.
- B3 architecture multi-agents : Noon Orchestrator, DEV Orchestrator, Codebase Analyst, Implementation Agent, Review/Validation Agent. **B3 a été déclaré fermé en septembre** ; ne pas multiplier cinq exécutions sur une petite tâche.
- **À faire :** améliorer les vrais résultats, latence, coût, qualité de revue et utilité du Code Brain ; expérience contrôlée avant graphes sémantiques complexes.

### V2.6–V2.8 · DEV Core et Workspace
- Workspace canonique, règles projet (`AGENTS.md`, règles DEV et permissions par workspace), vérification Git, `Repository Context Manifest` éphémère, DEV Native sous feature flag.
- Terminal intégré multi-sessions **USER / NOON / SYSTEM**, preview `WebContentsView`, dev server, HMR/port, panneau **Problems**, Source Control read-only, Git Diff, capture/inspection visuelle, mises au point UI (splitter/focus/autocomplete).
- Boucle Agent Execution Loop V1 : démarrage, statuts, annulation, étapes, prompts bornés, journal, comparaison avant/après, pas de reset destructif.
- UI Validation isolée en fixtures A/B, isolation de profils et refus des pouvoirs hors périmètre ; contrôles `IPC` et validation avant action.
- Native DEV : inspecter → planifier → proposer patch exact → lancer validations allowlistées → réexaminer → rapport, avec budget, politique, diff et approbation. Les actions Git distantes sont distinctes.
- **Preuves historiques :** #4 Agent Loop déclaré fermé, #5 Visual Inspection poursuivi ; nombreuses validations 1500+ rapportées ; une preuve de tests n’implique pas le succès du parcours Electron utilisateur actuel.

### V2 — Organisation et cognition structurées
- **Noon Orchestrator** unique, Reasoning Orchestrator et **Task Engine** ; Context Builder/Context Offloader ; mémoire et Focus par projet.
- **Goal & Strategy Engine** (WHY/HOW distincts de WHAT/WHEN) : objectifs, critères, horizons, stratégies, jalons, projets liés, consentement pour buts inférés ; progrès fondé sur preuve et non activité supposée.
- **Priority Engine, Planning Engine, Portfolio Capacity Engine, Execution Tracking, Review/Learning Engine** : chacun a un propriétaire canonique, sans concurrence de classement/planning.
- **Notification & Attention Engine**, **Proactive Engine événementiel**, Daily Brief unifié et **Action/Suggestion Center** à rendre utilisable dans l’interface.
- **Evaluation Runtime**, Decision Support / Uncertainty & Decision, evidence packs sourcés, synthèse multi-source.
- **Observability et Progress UI** : états PLANIFIÉ/EN COURS/TERMINÉ/VÉRIFIÉ/ERREUR, temps/coûts, activité agent, raisons d’arrêt, sans exposer de secrets ni contenu privé.

### V2 — Couche de sécurité plus avancée
- **Intervention Permission Engine** et **Approval Engine** intégrés : le droit de demander une action n’est jamais une autorisation d’exécution.
- **Sandbox V1 livrée** pour une enveloppe de validations DEV contraintes au niveau de l’application, dans un périmètre limité. **Pas de sandbox générale de processus prouvée au niveau OS** : un script npm autorisé peut exécuter du code arbitraire ; ne jamais annoncer `OS_SANDBOXED` sans preuve.
- Transactional Execution, idempotence SQLite, reprise/crash, refus des extensions de droits via agents, goals, modèles ou retries.
- **À faire :** connexion E2E des mêmes permissions, budgets, sandbox et validations pour DEV/Goal/Figma/SelfDev, et scénarios réels défavorables.

