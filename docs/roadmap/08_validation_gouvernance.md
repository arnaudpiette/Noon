## 15 — Tests d’acceptation utilisateur, jalons et release

**Une fonction est « vraiment prête » quand elle fonctionne dans Noon sur TON Mac/iPhone, pas seulement dans ses tests.**

1. **ONE NOON** : texte et voix partagent mémoire, contexte, règles, permissions, même provenance et comportement explicable.
2. **Mémoire** : corriger/contrôler/oublier une information, redémarrer, confirmer qu’elle n’est pas ressuscitée et n’est pas envoyée au cloud si `local_only`.
3. **Brief** : sept jours, à 07:00 heure de Paris, sources fraîches, rattrapage sleep/wake, trois priorités et suggestion utile.
4. **VOIX P0** : Cedar réellement utilisé dans TTS et la conversation choisie ; benchmark comparatif GPT-Live-1 vs Realtime 2.1, délégation sécurisée, interruption, coût, reconnexion, validation micro/AirPods et app packagée, aucune bascule silencieuse.
5. **DEV** : projet réel, inspecter/plan/test/patch/review, Terminal+Preview+Problems, sécurité et budget sans commande shell permissive.
6. **Goal Retry** : aucune relance sans autorisation ; stopper sur limite, crash ou doute, reprendre sans double effet.
7. **Figma** : analyse d’une vraie frame, assets, Preview, erreurs réelles, priorisation des corrections.
8. **SelfDev** : correction de Noon sur copie isolée, tests, analyse des risques, aucune intégration sans accord.
9. **iPhone** : pairing, conversation/sync, Brief, statuts, perte réseau, révocation, aucun secret synchronisé.
10. **Dictaphone/vidéo** : consentement, verbatim conservé, résumé fidèle, DOCX lisible et versionné.
11. **Recherches** : sources visibles, dates/fraîcheur, séparation public/privé, coûts bornés, aucun contenu Web ne pilote des actions locales.
12. **Production** : `npm test`, lint, build, `git diff --check`, smoke Electron, sécurité, restauration, stabilité, audit coûts ; working tree propre **ou modifications préexistantes tracées** ; tag uniquement après validation explicite.
13. **Capacité de récupération** : offline, réseau cassé, provider absent, auth expirée, modèle local indisponible, appareil perdu, job interrompu, SQLite inaccessible : montrer un état vrai, jamais une réussite fictive.

## 16 — Règles de gouvernance et d’intégration aux autres conversations

- **Source de vérité technique** : dépôt **local réel** + tests/évaluations de la tranche active, avant GitHub distant et anciens comptes rendus. **Source de vérité des priorités** : dernières décisions explicites de l’utilisateur.
- « Terminal 03 » couvre l’exécution technique historique ; « Projet NOON #Terminal 04 » suit l’exécution et les résultats Git actuels ; « Projet NOON #2 » conserve la vision transversale ; **cette roadmap est la référence produit commune**.
- Décision du 13/10/2026 commune aux deux conversations : [Google Agentic OAuth & MCP Access](11_google_agentic_oauth_mcp_access.md) est **planifié, non implémenté** et ne dépasse pas la priorité Sandbox / Permission Engine. La documentation seule n'autorise aucune intégration dans Noon.
- Lire `AGENTS.md`, statut Git et la documentation canonique avant Codex ; conserver les gros blocs de commandes compatibles dans le terminal (`&&` quand approprié) sans regrouper opérations destructives.
- Si une fonctionnalité existe déjà (ProactiveEngine, PriorityEngine, ApprovalEngine, ArtifactEngine, etc.), **étendre ou raccorder ce module** avant d’en créer un second.
- Ne jamais détruire des artefacts non suivis ni présumer que la branche distante reflète trois commits locaux d’avance.
- Les documents de roadmap n’entraînent **aucun commit, push, création d’issue ni modification de code** sans instruction explicite.

