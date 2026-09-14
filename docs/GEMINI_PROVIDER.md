# Gemini provider shadow rollout

Verified on 2026-09-14 against Google official documentation.

- SDK: @google/genai 2.22.0 (official GA JavaScript SDK, Node >= 20).
- Model: gemini-3.8-flash, stable.
- Capabilities used by Noon: text, streaming, structured output, function
  calling, vision and thinking levels.
- Rollout: SHADOW by default; V2.4 may admit LIMITED public routing only behind
  the `router.gemini-limited` flag. Setting
  NOON_GEMINI_ENABLED=false or NOON_GEMINI_ROLLOUT=OFF is the kill switch.
  OpenAI remains the primary provider.
- Credential: GEMINI_API_KEY in local development, or the canonical macOS
  SafeStorage secret named gemini-api-key in the packaged application. It is
  independent from Gmail and Calendar OAuth and never reaches the renderer.
- Tier: FREE by default. PAID is accepted only through an explicit GEMINI_TIER=PAID.

Privacy:

- FREE: PUBLIC only.
- PAID: PUBLIC and PERSONAL; PRIVATE remains denied unless explicitly allowed
  by the provider privacy request policy.
- HIGHLY_SENSITIVE and LOCAL_ONLY: always denied.

Pricing source: https://ai.google.dev/gemini-api/docs/pricing

For paid standard inference through 2026-12-31, the canonical calculator uses
$0.75 per million input tokens, $0.075 cached input, and $3.75 output including
thinking tokens. FREE shadow runs report zero estimated token cost. Actual
limits remain project/model/tier dependent and must be read in AI Studio.

The adapter has no connector, memory, filesystem, approval or tool execution
access. Tool calls are returned to Noon in the canonical format and never
executed by the adapter.
