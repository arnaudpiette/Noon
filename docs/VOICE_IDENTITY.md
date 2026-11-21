# VoiceIdentity de Noon

`services/voice/voice-identity.js` est la source unique de l’identité vocale. La seule voix autorisée est `cedar`, pour le TTS classique, le Live Mini et le Live Max. `arbor` reste la voix future préférée, à activer seulement quand elle sera disponible dans l’API et vérifiée. Luna, Terra et Sol produisent du texte ; ils ne sélectionnent jamais la voix.

La langue, l’accent, la qualité Mini/Max et les périphériques restent des réglages de session. Ils peuvent modifier la prononciation, le modèle Realtime ou le transport audio, mais pas l’identité `noon-default`.

## Fallback

Aucun repli vocal : `fallbackPolicy: "none"` et `exactMatchRequired: true`. Le TTS fait une seule tentative en `cedar` ; si Cedar n’est pas disponible, la résolution échoue (`VOICE_UNAVAILABLE`) au lieu de changer de voix. En Live, si la voix confirmée par OpenAI diffère de Cedar, le renderer coupe la session et le signale. Les anciennes sélections de voix enregistrées sont ignorées et réécrites avec la politique canonique.

Pour GPT-Live, voir `docs/VOICE_P0A_AUDIT.md` : la disponibilité de Cedar n’y est pas confirmée.

## Transports conservés

- TTS : flux PCM progressif depuis `/tts` ;
- Live : WebRTC et VAD existants ;
- ponctuel : MediaRecorder, transcription, réponse puis le même TTS ;
- réveil : Picovoice reste un déclencheur indépendant.

## Observabilité

Les résolutions exposent `voice_identity_resolve_ms`. Le renderer mesure `tts_start_ms`, `time_to_first_audio_ms` et `tts_total_ms`. Le Live expose son identifiant de session, son modèle, sa voix et `realtime_connect_ms`. Aucune trace ne contient le texte ou l’audio privé.
