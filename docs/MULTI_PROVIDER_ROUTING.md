# Noon V2.4 multi-provider routing

`selectModelRoute` remains the sole owner of provider and model selection.
ProviderPrivacyPolicy is evaluated first; denied providers never enter scoring.
Candidates are then filtered by required capabilities, rollout, health,
availability, minimum quality, request cost ceiling and optional latency target.
Among the remaining candidates, the cheapest sufficient model is selected.

OpenAI remains the rollback path. Gemini is at most LIMITED, only for policy-
allowed public tasks, and Astra remains SHADOW. All V2.4 feature flags default
to OFF and restore historical OpenAI-only routing without a data migration.

Cross-provider fallback is limited to infrastructure failures and re-evaluates
privacy. QUALITY_FAILURE, VALIDATION_FAILURE and TASK_FAILURE are reserved for
future explicit escalation and never arise from a network error.

Second opinion is never the default. It requires an uncertainty or explicit
trigger, a separately allowed provider, compatible capabilities and sufficient
request cost headroom for the primary, independent opinion and synthesis.
The second provider receives only the minimum user problem, not the first
answer. Noon then selects the synthesis model through the canonical router and
returns one answer. Provider tool calls remain proposals handled by the normal
Noon security and approval pipeline.

V2.4 does not implement daily/monthly budgets, Noon Dev, Claude, Cursor or a
local model provider.
