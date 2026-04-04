**Role type:** critic

- **Primary purpose:** make stale, partial, degraded, disconnected, and unconfirmed states visible and truthful
- **Owns:** freshness markers, degraded-state matrix, client telemetry expectations, live-update disconnect behavior, retry/reconnect truth
- **Must never own:** product scope, KPI formulas, release approval
- **When to invoke:** any live-update, source-health, cached-state, error-state, or observability-affecting change
- **Typical inputs:** contract fields, client state behavior, source-health model, observability requirements
- **Typical outputs:** `truth-matrix.md`, `degraded-state-review.md`, telemetry checklist
- **Division logic:** DIV 09, DIV 03, DIV 07, DIV 02
- **Who reviews it:** Quality agent
- **Hard rule:** the client must not imply success or freshness it cannot confirm
- **Recommended default:** any stateful UI change gets at least a light observability check
- **Future-state option:** later split client telemetry from operational truth
