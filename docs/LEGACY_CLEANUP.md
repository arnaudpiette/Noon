# Nettoyage contrôlé du legacy — étape 10

## Architecture active

```text
UI / Voice / Background
        ↓
API locale / SSE
        ↓
NoonOrchestrator
  ├─ ContextBuilder → MemoryEngine + HardRulesRegistry
  ├─ Noon Intelligence Router
  ├─ SkillRegistry → permissions → ApprovalManager
  └─ Observability

DailyBriefEngine · PriorityEngine · VoiceIdentity
```

## Source de vérité

| Responsabilité | Source de vérité |
|---|---|
| Mémoire | `MemoryEngine` |
| Règles permanentes | `HardRulesRegistry` |
| Contexte | `ContextBuilder` |
| Orchestration | `NoonOrchestrator` |
| Priorité | `PriorityEngine` |
| Brief quotidien | `DailyBriefEngine` |
| Voix | `VoiceIdentity` |
| Outils | `SkillRegistry` |
| Routage modèle | `lib/noon-intelligence.js` |
| Mesures | `Observability` |

## Carte de dépréciation

| Ancien chemin | Nouveau chemin | Classe | Statut |
|---|---|---:|---|
| lecture directe `long-term-memory.json` dans brief/voix | `MemoryEngine` | A | retirée |
| validation des corps et pièces jointes dans `server.js` | `services/http/request-utils.js` | A | extraite |
| configuration Realtime dans `server.js` | `VoiceIdentity` + `services/voice/realtime-config.js` | A | extraite |
| logique historique `askAI` | `NoonOrchestrator` | B | wrapper contrôleur conservé |
| routes `/brief/*` et `/personal-brief/*` | `/daily-brief/*` | B | alias HTTP conservés |
| route et panneau `/memory` | mémoire privée + `MemoryEngine` | B | adaptateur UI déprécié |
| JSON `long-term-memory.json` | coffre privé chiffré | B | lecture métier désactivée après migration, fichier conservé |
| `memory_items` | coffre privé chiffré | C | interface de gestion encore active |
| état de conversation navigateur | historique serveur | C | cache d'affichage, pas un doublon métier |
| Focus local | entité Project | C | concepts distincts |
| migration JSON projets | registre projets | C | compatibilité de données au démarrage |
| background analysis | Responses background | C | feature flag volontaire |
| anciens adapters non caractérisés | services centraux | D | aucune suppression |

Focus désigne le dossier de travail local actif. Project représente une entité
de suivi (objectif, état, prochaine action). Leur fusion serait incorrecte.

## Feature flags

| Flag | Défaut | Décision |
|---|---|---|
| `ENABLE_TOOL_SEARCH` | activé | conservé, fallback de compatibilité API |
| `ENABLE_RESPONSE_COMPACTION` | désactivé | conservé, déploiement contrôlé |
| `ENABLE_BACKGROUND_ANALYSIS` | désactivé | conservé, coût et durée explicites |
| `NOON_MEMORY_MIGRATION` | activé | conservé jusqu'à validation finale des installations |

Les paramètres `NOON_*` de budget, latence, port et notifications sont des
réglages opérationnels, pas des branches legacy.

## Routes et IPC

Les routes consommées par `public/app.js`, Electron et la voix ont été
conservées. Les alias de brief restent des wrappers. Les canaux IPC de preload,
renderer et main n'ont pas été modifiés. Aucun contrôle code-side de permission,
d'approbation, d'accès aux fichiers ou d'envoi externe n'a été retiré.

Les sauvegardes et données historiques restent dans le répertoire utilisateur ;
aucun fichier privé n'est supprimé par ce nettoyage.
