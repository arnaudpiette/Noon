# VoiceIdentity de Noon

`services/voice/voice-identity.js` est la source unique de l’identité vocale. La voix principale est `marin` pour le TTS classique, le Live Mini et le Live Max. Luna, Terra et Sol produisent du texte ; ils ne sélectionnent jamais la voix.

La langue, l’accent, la qualité Mini/Max et les périphériques restent des réglages de session. Ils peuvent modifier la prononciation, le modèle Realtime ou le transport audio, mais pas l’identité `noon-default`.

## Fallback

Le TTS essaie `marin` deux fois. `cedar` n’est utilisé qu’après ces deux échecs et génère une trace `voice-identity.fallback` sans contenu parlé. Ce secours n’est jamais écrit dans `localStorage` et la requête suivante retente `marin`. Si le service OpenAI entier échoue, le renderer peut employer la voix système macOS, avec un message visible indiquant ce mode de secours.

## Transports conservés

- TTS : flux PCM progressif depuis `/tts` ;
- Live : WebRTC et VAD existants ;
- ponctuel : MediaRecorder, transcription, réponse puis le même TTS ;
- réveil : Picovoice reste un déclencheur indépendant.

## Observabilité

Les résolutions exposent `voice_identity_resolve_ms`. Le renderer mesure `tts_start_ms`, `time_to_first_audio_ms` et `tts_total_ms`. Le Live expose son identifiant de session, son modèle, sa voix et `realtime_connect_ms`. Aucune trace ne contient le texte ou l’audio privé.
