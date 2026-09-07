# Noon V1 — dette technique gelée

| Sévérité | Zone | Pourquoi conservée | Risque | Action future mesurée |
|---|---|---|---|---|
| P1 | Signature/notarisation | aucun certificat Developer ID configuré | distribution externe bloquée | signer/notariser dans une chaîne de release dédiée |
| P1 | arm64 | dépendances natives non installées/testées | Apple Silicon non garanti | builder arm64 propre + smoke |
| P1 | `server.js` volumineux | façade de composition et compatibilité accumulées | responsabilités difficiles à auditer | extractions petites guidées par tests, sans réécriture |
| P1 | flags intention/recherche/exécution | définitions historiques OFF tandis que des owners canoniques sont déjà câblés | statut source de vérité déroutant | supprimer/réviser uniquement après traçage exhaustif des callers |
| P1 | Renderer chat/mémoire et Voice live | chat API/OpenAI/restart vérifiés, mais renderer packagé et voix réelle non pilotés | usage quotidien UI/voix non prouvé | checklist manuelle contrôlée dans le bundle avec données non sensibles |
| P1 | Voice matériel/TCC/WebRTC/wake word | STT/TTS providers validés sur audio artificiel, bundle démarre, mais aucune preuve microphone/sortie audible/TCC/wake word | Voice E2E et absence de fuite matérielle non certifiées | session manuelle packagée : permission accordée/refusée, 10 cycles, fenêtre fermée, wake word et périphérique externe |
| P2 | Realtime comme adaptateur oral | il doit demander `ask_noon_brain` avant toute question/action ; la contrainte est actuellement portée par les instructions de session | un modèle Realtime pourrait ne pas appeler l'outil | vérifier en E2E réel chaque classe d'intention ; ne pas créer de second orchestrateur |
| P2 | Pertinence mémoire legacy | bonus profil hors sujet retiré en P1.1, store conservé pour compatibilité | régression possible pendant la coexistence des stores | conserver le test d'exclusion et mesurer `excludedIrrelevant` |
| P1 | Connecteurs réels | tests mocks uniquement | auth/réseau/provider inconnus | sandbox puis parcours manuel explicite |
| P2 | CSP `unsafe-inline` pour styles | styles inline encore utilisés | surface XSS supérieure à l’idéal | migrer les styles inline avant retrait CSP |
| P2 | stockage JSON de compatibilité | migrations progressives | doublons/complexité | garder read-only, mesurer usage, retirer avec migration idempotente |
| P2 | sync/remote/jobs en SHADOW | architecture préparée sans transport production | confusion produit si exposée | conserver masqué jusqu’à besoin réel |
| P2 | métriques CPU/RAM/longue session | startup packagé mesuré à 13,6 s, mais idle/longue session non mesurés | régression performance invisible | benchmark reproductible hors tests unitaires |

## Legacy

- `services/approvals/approval-manager.js` : `KEEP_COMPAT`, alias de l’Approval Engine.
- fichiers conversation/projets JSON historiques dans `server.js` : `KEEP_READ_ONLY_MIGRATION` jusqu’à preuve de migration complète.
- parseurs/heuristiques dans `askAI()` : `QUARANTINE` fonctionnelle ; ne pas étendre, déplacer vers owners canoniques lors d’un bug réel.
- appels Responses spécialisés (brief, multimodal, recherche, compaction) : `KEEP_COMPAT` car ils appartiennent à des adaptateurs bornés ; ne pas les confondre avec un second orchestrateur conversationnel.
- timers Electron brief/wake : `KEEP_COMPAT` tant que les jobs SHADOW ne possèdent pas le lifecycle production.

## Hors dette V1 / backlog V1.1

App mobile native, relais production, sync E2EE réelle, marketplace tierce, helper wake après Full Quit, modèles locaux additionnels et auto-update ne doivent pas être implémentés sans besoin utilisateur mesuré.
