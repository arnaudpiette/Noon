## 4 — Situation opérationnelle à la date du document

### Évidence Git et conversations
- Branche de travail rapportée : `v2/multi-provider`.
- Branche distante vérifiée (commits visibles au 10/10) : `041d44ce` Agent Evaluation Runtime (08/10) ; `862cf7c5` Sandbox contrainte (09/10) ; `4a5889fd` Uncertainty Decision V1 (09/10) ; `ffd0e3b6` Goal → Decision V2 (09/10) ; `2f2b23d0` Synthesis Evidence (10/10) ; `9aad9687` snapshot ↔ terminal review (10/10) ; `e97a0ece` Native DEV evidence → Decision (10/10).
- Dernière **baseline locale rapportée** dans « Terminal 03 »/« Projet Noon #2 » (11/10) : HEAD **`ad123a2f26a4489b0bcfdbcc236d041df3aa0f64`**, branch `v2/multi-provider`, *ahead 3*, index vide et tracked files propres ; **non revérifié ici**, sans push.
- Artefacts de travail non suivis à préserver explicitement : `benchmark-workspaces/`, `dev-cost-ledger.json`, `dev-task-journal/`. Ne pas les stager ni les effacer par défaut.
- Les tranches **4.2 (Goal → Decision V2), 4.3 (Evidence Adapter), 4.4 (snapshots et preuves DEV), 4.5B/C/D (Goal ↔ Native DEV ↔ Agent Evaluation)** ont été rapportées comme développées ou validées dans les échanges. Les portions précises et le HEAD local doivent être revérifiés avant toute modification.
- **4.5D** distingue `STOP` / `REVIEW` / `RETRY_CANDIDATE`. Le candidat retry **n’autorise ni programmation ni exécution**.
- **4.6 Goal Retry Chain V1** est **la prochaine tranche identifiée**, et non terminée d’après les preuves reprises. Respect strict des budgets et permissions.

### Matrice par macro-capacité

| Macro-capacité | État prudent au 12/10 | Preuve/limite et prochaine preuve |
|---|---|---|
| Electron, Focus, projets, mémoire/SQLite | Développé, tests nombreux ; quotidien PARTIEL | vérifier démarrage, profils, données, backup/recovery en usage réel |
| Chat streaming / contexte / conversation | Développé et tests API ; UX réelle PARTIELLE | longues conversations, restart, stop/retry en app packagée |
| **Voix, Cedar, nouveaux modèles GPT-Live/Realtime, wake word et AirPods** | **P0 / PARTIEL** | comparer `gpt-live-1` + délégation vs `gpt-realtime-2.1` + mini ; vérifier voix Cedar sur TTS/Live, micro, interruption, sécurité, sommeil/réveil ; Arbor API non confirmée |
| Gmail / Calendar / Notes / Reminders / GitHub | PARTIEL variable | connexions et limites permission réelles, données fraîches |
| Daily Brief enrichi + Proactive Engine | Moteurs présents ; UX/fiabilité PARTIELLES | 7 jours à 7 h, 3 priorités, signaux pertinents, anti-spam |
| Mémoire privée et contrôle | Implémentation et tests, à surveiller | correction/oubli, local_only y compris inférences dérivées |
| Providers/Adaptive Routing | Partiel, flags restrictifs | mesurer prix/vitesse/qualité réelle, pas de promotion sans gain |
| DEV Core, Terminal, Preview, Problems, Git diff | Largement développé ; E2E PARTIEL | smoke Electron réel, tests, budget, annulation, retour UI |
| B3 multi-agents | Fermé dans les échanges | mesure du gain et des frontières d’autorité |
| Agent Evaluation / Decision V1 / Sandbox applicative | Commits visibles | pas de sandbox OS ni d’autonomie générale revendiquée |
| Goal Strategy + Goal→DEV | Développé, certaines tranches locales récentes | 4.6 retry chain et vérification locale sans élévation |
| Figma read-only + comparaison Preview | Connecteur/contrats partiels | OAuth sur vrai fichier, assets, analyse structurée, diff démontrable |
| SelfDev V1 | À FAIRE | audit/patch isolé/test/approbation sur Noon, sans changement automatique |
| Sync multi-device / Remote Interaction | PRÉPARÉ SHADOW / mocks | vrai transport chiffré + app iPhone + reconnection/révocation |
| Dictaphone, vidéo, recherche tierce | À FAIRE / recherche existante réutilisable | scénario produit E2E, confidentialité, sources, budgets |
| Distribution / release | x64 existant ; final PARTIEL | smoke packagé, signature/notarisation selon objectif, sauvegarde et reprise |

