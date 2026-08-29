# Observabilité de Noon

Noon associe chaque demande importante à un identifiant aléatoire `exec_…`. Le
Context Builder, le routeur, les appels modèle, les outils, les validations et
la voix alimentent une trace structurée commune. L’écriture est asynchrone dans
`noon-observability.jsonl`, avec 30 jours de rétention, et une panne de ce
fichier ne bloque jamais une réponse.

## Données mesurées

- contexte : durée, budget, tokens estimés, volumes, troncature ;
- mémoire et règles : durées, sources et nombres d’éléments, jamais le contenu ;
- routage : profil demandé, modèle retenu et facteurs structurés ;
- modèle : durée, premier token, streaming, usage et coût estimé ;
- outils et validations : durée, statut, niveau de permission et attente humaine ;
- voix : identité, premier audio, TTS, Realtime, transcription et fallbacks ;
- Daily Brief : collecte, extraction, priorité, planification, génération et coût.

`technicalExecutionMs` exclut `approvalWaitMs`, tandis que
`wallClockTotalMs` représente l’attente réellement perçue. Une trace dépassant
`NOON_SLOW_TRACE_MS` (5 secondes par défaut) est marquée lente et son principal
goulot est déterminé sans modèle.

## Confidentialité

Les prompts, messages, souvenirs, e-mails, chemins privés, pièces jointes,
arguments/résultats d’outils, audio, transcriptions, tokens et secrets sont
supprimés avant persistance. Seuls des compteurs, statuts, durées, catégories et
identifiants techniques internes sont conservés.

L’endpoint local authentifié `GET /api/diagnostics/metrics` expose uniquement
des agrégats (p50/p95, modèles, coûts, erreurs et fallbacks). `/health` fournit
une synthèse des dernières 24 heures sans contenu utilisateur.
Une trace précise et déjà nettoyée peut être demandée avec
`?executionId=exec_…`.

## Premier token et premier audio

`timeToFirstTokenMs` est mesuré entre l’envoi effectif de l’appel modèle et le
premier delta texte utile reçu. `timeToFirstAudioMs` est mesuré dans le renderer
entre le début de la demande TTS et la programmation du premier bloc audio
utile ; il est ensuite rattaché au même `executionId` que la réponse.
