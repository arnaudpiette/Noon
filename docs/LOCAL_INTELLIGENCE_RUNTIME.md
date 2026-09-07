# Local Intelligence & Offline Runtime

`services/runtime/` résout les capacités nécessaires avant de choisir un chemin local, distant, différé ou indisponible. Il ne remplace ni `NoonOrchestrator`, ni `ModelRouter`, ni `ReliabilityEngine`.

## Hiérarchie

1. cœur déterministe local lorsque suffisant ;
2. modèle local optionnel lorsque configuré, sain et suffisamment qualitatif ;
3. service ou modèle distant lorsque le réseau, la confidentialité et le budget l’autorisent ;
4. mise en attente uniquement après intention explicite et jamais pour une action distante à haut risque ;
5. indisponibilité honnête lorsqu’aucune alternative sûre n’existe.

## État réel de cette machine

L’audit du 31 août 2026 a détecté un Mac Intel x86_64 avec Metal et environ 2,8 Gio libres. Aucun exécutable Ollama, MLX ou llama.cpp n’est présent. Le `LocalModelAdapter` reste donc `NOT_CONFIGURED` et aucun modèle n’est téléchargé automatiquement.

## Local only

`runtime.executionPreference=LOCAL_ONLY` est un choix utilisateur persistant. Un événement réseau ne le désactive jamais. Dans ce mode, les recherches locales structurées continuent et aucun appel OpenAI, Web ou connecteur distant n’est lancé.

## Contrats

- `CapabilityRegistry` décrit emplacement, disponibilité, qualité, réseau, coût et confidentialité.
- `OfflinePolicy` applique confidentialité avant qualité et refuse les fausses équivalences.
- `LocalIntelligenceRuntime` produit le snapshot et le preflight.
- `LocalModelAdapter` n’accorde aucune autorité outil et n’enregistre aucun historique de prompts.

## Vérification

```bash
npm run lint:runtime
npm run eval:offline
node --test test/local-intelligence-runtime.test.js
```
