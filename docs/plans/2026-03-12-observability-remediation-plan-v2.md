# 2026-03-12 Observability Remediation Plan (v2, revised)

> **Revision note:** This revision addresses five findings from the v2 document review. Changes are marked with `[v2r]` inline.

## Objective

Close the three remaining Section 25 spec gaps:

- **S25-01** — structured JSON logs with `request_id`, action, state, latency, error codes
- **S25-02** — runtime metrics for LLM behavior, state durations, abandonment, escalation exhaustion, notification failures, schema failures
- **S25-04** — alerting for escalation exhaustion, LLM error spikes, schema failure spikes, async backlog

## Current Baseline

**What exists:**

| Component | Status | Notes |
|---|---|---|
| `request-context.ts` | Dead scaffold | Generates `request_id` + timestamp; never used by any route or core code |
| Escalation coordinator logging | Live, structured | Only module with JSON logs; 15+ event types, but no `request_id`, no shared interface |
| API route logging | Ad hoc | `console.error`/`console.warn` in 3 webhook/cron routes; 20+ routes have zero logging |
| Dispatcher logging | None | Zero log lines in `dispatcher.ts` or any of 13 action handlers |
| LLM adapter logging | None | 3 adapters (splitter, classifier, followup) call LLM silently |
| Metrics store | None | No metrics collection of any kind |
| Alert evaluator | None | Emergency SMS on cycle exhaustion exists but nothing for spikes/backlog |

**Key architecture facts:**

- `createDispatcher(deps)` returns `dispatch(request) → DispatchResult`. The dispatcher is a closure over `OrchestratorDependencies`.
- `ActionHandlerContext` = `{ session, request, deps }`. Handlers don't receive request-scoped context.
- `getOrchestrator()` in `orchestrator-factory.ts` returns the `dispatch` function. Routes call it directly.
- LLM adapters are created once at factory init via `createLlmDependencies(config)` → `{ issueSplitter, issueClassifier, followUpGenerator }`. Each adapter is a closure over the shared `LlmClient`. They accept `(input)` or `(input, retryContext?)` — no per-request context hook exists today.
- `orchestrator_action.schema.json` has `additionalProperties: false` and its `action_type` enum lists 15 values (missing `CONFIRM_EMERGENCY`, `DECLINE_EMERGENCY`).
- Deployed on Vercel (serverless). DB is Neon Postgres. Cold starts reset all in-memory state.
- Existing cron route (`process-due`) uses **GET** with `Authorization: Bearer ${CRON_SECRET}`.

**Known schema drift (pre-existing):** The JSON schema for `OrchestratorActionRequest` is missing two emergency action types that exist in the TypeScript types. This plan fixes that drift in PR 1 alongside adding `request_id`.

## Design Decisions

### D1: `request_id` flows on the request; sinks flow on deps; per-call context flows explicitly into LLM and async boundaries

**Decision:** Three-layer propagation:
1. **Sinks** (`logger`, `metricsRecorder`, `alertSink`) are added as optional fields on `OrchestratorDependencies`. Created once at factory init. Stateless services.
2. **`request_id`** is added to `OrchestratorActionRequest` (with matching JSON schema update). The dispatcher extracts it and includes it in all log/metric calls within its scope.
3. **`[v2r]` Per-call `ObservabilityContext`** is threaded explicitly into LLM adapter calls and escalation coordinator methods. LLM adapters are created once, but each invocation receives an optional `ObservabilityContext` parameter so logs and metrics are request-correlated. The escalation coordinator receives context at `startIncident()` / `processDue()` call boundaries (not at construction time, since it handles async work that outlives the original request).

**Rationale:** Changing the `dispatch()` signature would break every route and every test. Adding `request_id` to the request object (which routes already construct) is minimally invasive. LLM adapters need per-call context because they are singletons — wrapping them with a HOF that captures `request_id` at call time (not at creation time) solves this without `AsyncLocalStorage`. The escalation coordinator operates on async timelines where the original `request_id` may not apply; its context comes from the cron/webhook trigger's own `request_id`.

### D1b: `[v2r]` JSON schema updated in lockstep with TypeScript types (schema-first)

**Decision:** Every TypeScript type change to `OrchestratorActionRequest` is accompanied by the corresponding change in `orchestrator_action.schema.json`. PR 1 adds `request_id` to both **and** fixes the missing emergency action types in the enum.

**Rationale:** The project's non-negotiable #3 requires schema-lock on all model outputs and orchestration actions. Adding a field to the TS type without updating the JSON schema (which has `additionalProperties: false`) would cause runtime validation rejection.

### D2: Logger is a typed interface, not a library

**Decision:** Define a `Logger` interface in `packages/core/src/observability/types.ts`. The production implementation writes JSON to stdout. Tests use `InMemoryLogger` that collects entries for assertions.

**Rationale:** No external logging library needed. Vercel captures stdout as structured logs natively.

### D3: `[v2r]` Metrics has two interfaces: async `MetricsRecorder` (write) and `MetricsQueryStore` (read)

**Decision:** Split the metrics contract:
- `MetricsRecorder` interface: `{ record(obs: MetricObservation): Promise<void> }` — async, returns a promise so callers can optionally await durability. Injected into dispatcher, LLM wrappers, notification service, escalation coordinator.
- `MetricsQueryStore` interface: `{ queryWindow(metricName: string, windowMinutes: number): Promise<number>; queryCount(metricName: string, windowMinutes: number): Promise<number> }` — used only by the alert evaluator.
- `PgOperationalMetricsStore` implements both interfaces.
- `InMemoryMetricsRecorder` implements both interfaces (for tests).
- `NoopMetricsRecorder` implements `MetricsRecorder` only (resolves immediately).

**Rationale:** The v2 plan defined metrics as a sync `record(obs): void` interface, then expected the Postgres implementation to do durable inserts and expose query methods. A sync void method is the wrong contract for Neon/Vercel if you care whether writes land before the request ends. Making `record()` return `Promise<void>` lets callers `await` it at request boundaries (route wrapper) while keeping fire-and-forget behavior where durability doesn't matter (mid-action logging). The query interface (`MetricsQueryStore`) is separate because only the alert evaluator needs it — no reason to expose it to every consumer.

### D4: `[v2r]` Alert cooldown state persists in DB, keyed by `alert_name:scope`

**Decision:** `alert_cooldowns` table with composite key `(alert_name, scope)`:
```sql
CREATE TABLE IF NOT EXISTS alert_cooldowns (
  alert_name       TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT '_global',
  last_alerted_at  TIMESTAMPTZ NOT NULL,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  PRIMARY KEY (alert_name, scope)
);
```

**Rationale:** Keying only by `alert_name` is too coarse. Once per-component or per-building alerts exist, `llm_error_spike` for the classifier and splitter should have independent cooldowns. The `scope` column defaults to `'_global'` for alerts that don't need finer granularity, so the simple case stays simple.

### D5: In-memory test sinks defined in Track 0

**Decision:** Ship `InMemoryLogger`, `InMemoryMetricsRecorder`, `InMemoryAlertSink` as part of the observability contract. All existing tests continue to pass with noop/in-memory sinks injected via deps.

### D6: `[v2r]` Emergency escalation alert is additive, not a replacement

**Decision:** The escalation coordinator's existing direct SMS path (`deps.smsProvider.sendSms(internalAlertNumber, ...)`) is **preserved as-is**. The shared `AlertSink` is called **in addition** to the direct SMS, not instead of it. This means cycle exhaustion always sends the existing SMS (guarded by `internalAlertNumber` config), and additionally emits through the alert sink if one is wired.

**Rationale:** If `OPS_ALERT_PHONE_NUMBERS` is unset, the factory wires `NoopAlertSink`. If the direct SMS path were replaced by the sink, a misconfigured environment would silently lose operator alerts for the most critical failure mode (escalation exhaustion). The direct path is the safety net; the alert sink is the extensibility point.

---

## Implementation Plan

### PR 1 — Track 0: Observability contract and context threading

**Goal:** Define the shared interfaces, wire them into deps, make `request_id` available to the dispatcher, and fix the JSON schema drift. All existing tests still pass with noop sinks. Zero behavioral change.

#### Task 0.1 — Observability type definitions
- **Files:** Create `packages/core/src/observability/types.ts`
- **Work:**
  - Define `ObservabilityContext` type: `{ request_id: string; timestamp: string }`
  - Define `LogEntry` type: `{ component, event, request_id?, conversation_id?, action_type?, state_before?, state_after?, duration_ms?, error_code?, severity, timestamp, [key: string]: unknown }`
  - Define `Logger` interface: `{ log(entry: LogEntry): void }`
  - `[v2r]` Define `MetricObservation` type: `{ metric_name, metric_value, component, request_id?, conversation_id?, action_type?, error_code?, tags?: Record<string, string>, timestamp }`
  - `[v2r]` Define `MetricsRecorder` interface: `{ record(obs: MetricObservation): Promise<void> }` — async, not sync void
  - `[v2r]` Define `MetricsQueryStore` interface: `{ queryWindow(metricName: string, windowMinutes: number): Promise<number>; queryCount(metricName: string, windowMinutes: number): Promise<number> }` — read interface, only used by alert evaluator
  - Define `AlertPayload` type: `{ alert_name, severity, message, component, scope?: string, tags?, timestamp }`
  - Define `AlertSink` interface: `{ emit(alert: AlertPayload): Promise<void> }`
- **Test criteria:** Types compile. No runtime behavior to test yet.

#### Task 0.2 — Noop and in-memory implementations
- **Files:** Create `packages/core/src/observability/logger.ts`, `packages/core/src/observability/metrics.ts`, `packages/core/src/observability/alerts.ts`
- **Work:**
  - `StdoutJsonLogger` implements `Logger` — writes `JSON.stringify(entry)` to stdout
  - `NoopLogger` implements `Logger` — discards
  - `InMemoryLogger` implements `Logger` — collects entries in array, exposes `.entries` for tests
  - `[v2r]` `NoopMetricsRecorder` implements `MetricsRecorder` — resolves immediately
  - `[v2r]` `InMemoryMetricsRecorder` implements both `MetricsRecorder` and `MetricsQueryStore` — collects in array, exposes `.observations`, supports `queryWindow()`/`queryCount()` over the in-memory array for test assertions and alert evaluator tests
  - `NoopAlertSink` implements `AlertSink` — resolves immediately
  - `InMemoryAlertSink` implements `AlertSink` — collects in array, exposes `.alerts`
- **Test criteria:** Unit tests for each: logger collects/formats, recorder collects and supports window queries, noop doesn't throw.

#### Task 0.3 — Barrel export
- **Files:** Create `packages/core/src/observability/index.ts`, update `packages/core/src/index.ts`
- **Work:** Re-export all types, interfaces, and implementations.
- **Test criteria:** `import { Logger, StdoutJsonLogger, MetricsRecorder } from '@wo-agent/core'` resolves.

#### Task 0.4 — Add sinks to OrchestratorDependencies and extend ActionHandlerContext
- **Files:** Modify `packages/core/src/orchestrator/types.ts`
- **Work:**
  - Add optional fields to `OrchestratorDependencies`: `logger?: Logger`, `metricsRecorder?: MetricsRecorder`, `alertSink?: AlertSink`
  - Add optional fields to `ActionHandlerContext`: `request_id?: string` (derived from request) and `logger?: Logger` (derived from deps). Both are populated by the dispatcher in Task 0.6. Declaring both here avoids the doc-consistency gap where Task 0.4 adds `request_id` and Task 1a.2 separately adds `logger`.
- **Test criteria:** All existing tests compile and pass (fields are optional, so no injection required yet).

#### Task 0.5 — `[v2r]` Add `request_id` to OrchestratorActionRequest (TypeScript + JSON schema in lockstep)
- **Files:** Modify `packages/schemas/src/types/orchestrator-action.ts` **and** `packages/schemas/orchestrator_action.schema.json`
- **Work:**
  - Add optional `request_id?: string` field to the TypeScript `OrchestratorActionRequest` type
  - Add `"request_id": { "type": "string" }` to the JSON schema's `properties` block
  - **`[v2r]` Fix pre-existing drift:** Add `"CONFIRM_EMERGENCY"` and `"DECLINE_EMERGENCY"` to the `action_type` enum in the JSON schema (these already exist in the TypeScript types but were missing from the JSON schema)
  - Verify `additionalProperties: false` is maintained — the new field is explicitly declared, so validation will accept it
- **Test criteria:** Schema validation passes for requests with and without `request_id`. Emergency action types now validate. Run `pnpm --filter @wo-agent/schemas test` to confirm no regressions.

#### Task 0.6 — Thread request_id through dispatcher
- **Files:** Modify `packages/core/src/orchestrator/dispatcher.ts`
- **Work:**
  - At top of `dispatch()`, extract `request_id` from `request.request_id ?? deps.idGenerator()`
  - Pass `request_id` into `ActionHandlerContext`
  - No logging yet — just wiring
- **Test criteria:** Existing dispatcher tests pass. New test: `request_id` from request appears in handler context.

#### Task 0.7 — Wire sinks in orchestrator-factory
- **Files:** Modify `apps/web/src/lib/orchestrator-factory.ts`
- **Work:**
  - Create `StdoutJsonLogger` instance
  - Create `NoopMetricsRecorder` (upgraded to Postgres recorder in Track 2)
  - Create `NoopAlertSink` (upgraded to real sink in Track 3)
  - Pass all three into `OrchestratorDependencies`
- **Test criteria:** `pnpm --filter @wo-agent/web build` succeeds. Factory creates sinks without error.

#### Task 0.8 — Promote request-context.ts
- **Files:** Modify `apps/web/src/middleware/request-context.ts`
- **Work:**
  - Import `ObservabilityContext` from `@wo-agent/core`
  - `createRequestContext()` returns `ObservabilityContext`
  - Routes will use this in Track 1 to populate `request_id` on dispatch calls
- **Test criteria:** Existing import still works. Type aligns with core's `ObservabilityContext`.

**PR 1 exit criteria:** Shared contract defined with async `MetricsRecorder` and separate `MetricsQueryStore`. Sinks wired as noops. `request_id` flows from request to handler context. JSON schema updated in lockstep with TS types (including emergency action type drift fix). All existing tests pass. Zero behavioral change.

---

### PR 2 — Track 1a: Structured logging in dispatcher and action handlers

**Goal:** Every dispatcher action emits `action_received`, `action_completed`, `action_failed` logs with state, error codes, and duration.

#### Task 1a.1 — Instrument dispatcher
- **Files:** Modify `packages/core/src/orchestrator/dispatcher.ts`
- **Work:**
  - At action start: `deps.logger?.log({ component: 'dispatcher', event: 'action_received', action_type, conversation_id, request_id, state_before: session.state, severity: 'info' })`
  - At action end: log `action_completed` with `state_after`, `duration_ms`
  - On error: log `action_failed` with `error_code`, `duration_ms`
  - On system event rejection: log `action_rejected`
  - On auto-fire: log `auto_fire_triggered` with chained action_type
- **Test criteria:** Test with `InMemoryLogger`: dispatch a valid action → 2 log entries (received + completed). Dispatch invalid → received + failed. Auto-fire → logs for both parent and chained action.

#### Task 1a.2 — Populate logger on ActionHandlerContext in dispatcher
- **Files:** Modify `packages/core/src/orchestrator/dispatcher.ts` (handler call site)
- **Work:**
  - When building `ActionHandlerContext`, populate `logger: deps.logger` (type already declared in Task 0.4; `request_id` already populated in Task 0.6)
  - Handlers can now optionally log, but no handler changes in this task
- **Test criteria:** Existing handler tests unaffected. New test: handler context received by mock handler includes `logger`.

**PR 2 exit criteria:** Dispatcher emits structured logs for every action. Tests prove log entries contain required fields.

---

### PR 3 — Track 1b: Structured logging in API routes

**Goal:** Every API route emits `request_started`, `request_completed`, `request_failed` with `request_id`, method, route, status, duration.

#### Task 1b.1 — Create route observation wrapper
- **Files:** Create `apps/web/src/lib/observability/with-observed-route.ts`
- **Work:**
  - Higher-order function: `withObservedRoute(routeName, handler)` wraps a Next.js route handler
  - Creates `RequestContext` via `createRequestContext()`
  - Logs `request_started` with `request_id`, route, method
  - On success: logs `request_completed` with status, `duration_ms`
  - On error: logs `request_failed` with error message, `duration_ms`
  - Passes `request_id` to the inner handler so it can include it in dispatch calls
  - Uses `StdoutJsonLogger` (imported from core)
- **Test criteria:** Unit test with mock handler: success → 2 log entries; throw → started + failed.

#### Task 1b.2 — Wrap conversation action routes (13 routes)
- **Files:** Modify all routes under `apps/web/src/app/api/conversations/[id]/*/route.ts`
- **Work:**
  - Wrap each route handler with `withObservedRoute()`
  - Pass `request_id` from context into the `dispatch()` call as `request.request_id`
  - Routes: `select-unit`, `message/initial`, `message/additional`, `split/confirm`, `split/merge`, `split/edit`, `split/add`, `split/reject`, `followups/answer`, `confirm-submission`, `resume`, `confirm-emergency`, `decline-emergency`
- **Test criteria:** `pnpm --filter @wo-agent/web build` passes. Spot-check 2-3 routes with integration test: request → response includes `request_id` header or log output.

#### Task 1b.3 — Wrap remaining routes (10+ routes)
- **Files:** Modify routes: `conversations/route.ts` (POST create), `conversations/[id]/route.ts` (GET), `conversations/drafts/route.ts`, `work-orders/route.ts`, `work-orders/[id]/route.ts`, `work-orders/[id]/record-bundle/route.ts`, `photos/init/route.ts`, `photos/complete/route.ts`, `analytics/route.ts`, `health/route.ts`, `health/erp/route.ts`, cron and webhook routes
- **Work:** Same wrapper pattern as 1b.2.
- **Test criteria:** Build passes. No unwrapped routes remain.

**PR 3 exit criteria:** Every API route logs request start/end/fail with `request_id` and duration. `request_id` propagates from route → dispatch → handler context.

---

### PR 4 — Track 1c: Structured logging in LLM adapters

**Goal:** Every LLM call emits `llm_call_started`, `llm_call_completed`, `llm_call_failed` with tool name, model, duration, retry count, schema validation outcome — **correlated to the originating `request_id`**.

`[v2r]` **Key design constraint:** LLM adapters are created once at factory init via `createLlmDependencies()` and stored in `OrchestratorDependencies`. They are singletons — the `request_id` of the triggering request is not available at creation time. The wrapper must accept `ObservabilityContext` as an **optional parameter at call time**, not at wrapping time.

#### Task 1c.1 — Create observed LLM adapter wrapper with per-call context
- **Files:** Create `packages/core/src/llm/with-observed-llm-call.ts`
- **Work:**
  - Higher-order function: `withObservedLlmCall(adapter, logger, metricsRecorder, toolName)` returns a new adapter function with the **same signature plus an optional trailing `ObservabilityContext` parameter**
  - At call time, the wrapper:
    - Logs `llm_call_started` with `tool_name`, `model_id`, and `request_id` from context (if provided)
    - Times the inner adapter call
    - Logs `llm_call_completed` with `duration_ms`, `request_id`, schema_valid (if known)
    - On failure: logs `llm_call_failed` with `error_code`, `duration_ms`, `request_id`, retry_count
  - If no `ObservabilityContext` is passed (backward compat), logs without `request_id`
- **Test criteria:** Unit test with `InMemoryLogger` and a mock adapter: success → 2 logs with `request_id`; failure → started + failed with `request_id`; no context → logs still emitted without `request_id`.

#### Task 1c.2 — Extend LlmDependencies type signatures for optional context
- **Files:** Modify `packages/core/src/llm/create-llm-deps.ts`, `packages/core/src/orchestrator/types.ts`
- **Work:**
  - `[v2r]` Change `LlmDependencies` function signatures to accept an optional trailing `ObservabilityContext` parameter:
    ```typescript
    readonly issueSplitter: (input: IssueSplitterInput, ctx?: ObservabilityContext) => Promise<IssueSplitterOutput>;
    ```
  - Update `OrchestratorDependencies` type to match (same optional trailing param)
  - `createLlmDependencies()` accepts optional `Logger` and `MetricsRecorder` in config; wraps each adapter with `withObservedLlmCall()`
  - Pass through from `orchestrator-factory.ts`
- **Test criteria:** Existing LLM adapter tests pass (context param is optional). Existing action handler calls compile without changes (they don't pass context yet).

#### Task 1c.3 — `[v2r]` Thread ObservabilityContext from action handlers into LLM calls
- **Files:** Modify `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts`, `start-classification.ts`, `answer-followups.ts`
- **Work:**
  - These three handlers call `deps.issueSplitter(input)`, `deps.issueClassifier(input, retryCtx)`, `deps.followUpGenerator(input, retryCtx)` respectively
  - Add `ObservabilityContext` construction from `ctx.request_id` (available from PR 1 Task 0.6) and pass as trailing param:
    ```typescript
    const obsCtx = { request_id: ctx.request_id ?? '', timestamp: deps.clock() };
    const result = await deps.issueSplitter(input, obsCtx);
    ```
  - Handlers that don't call LLM tools are unchanged
- **Test criteria:** Existing handler tests pass. New test: dispatch `SUBMIT_INITIAL_MESSAGE` with `InMemoryLogger` → LLM log entries contain `request_id` from the original dispatch request.

**PR 4 exit criteria:** All 3 LLM tool boundaries emit structured logs with timing and `request_id` correlation. Context flows from route → dispatch → handler → LLM adapter without `AsyncLocalStorage`.

---

### PR 5 — Track 1d: Normalize emergency escalation onto shared logger

**Goal:** Escalation coordinator uses the shared `Logger` interface instead of direct `console.log(JSON.stringify(...))`. Emergency logs gain `request_id` from the triggering cron/webhook context.

`[v2r]` **Key design constraint:** The escalation coordinator processes async work (cron ticks, webhook callbacks) that outlives the original tenant request. The `request_id` on these logs comes from the **cron/webhook trigger's** request context, not from the original conversation dispatch. Each public method (`startIncident`, `processDue`, `processCallOutcome`, `processReply`) accepts an optional `ObservabilityContext` from the caller.

#### Task 1d.1 — Refactor escalation coordinator logging
- **Files:** Modify `packages/core/src/risk/escalation-coordinator.ts`
- **Work:**
  - Accept optional `Logger` in `EscalationCoordinatorDeps`
  - `[v2r]` Add optional `ObservabilityContext` parameter to `startIncident()`, `processDue()`, `processCallOutcome()`, `processReply()` public methods
  - Replace all `console.log(JSON.stringify({ component: 'escalation', ... }))` calls with `logger.log({ component: 'escalation', request_id: ctx?.request_id, ... })`
  - Fall back to `console.log` wrapper if no logger provided (backward compat for tests)
  - Keep all existing event richness — just route through the interface
- **Test criteria:** Existing escalation tests pass. New test with `InMemoryLogger`: incident start → log entries captured via interface with `request_id`.

#### Task 1d.2 — Wire logger into escalation deps and pass context from cron/webhook routes
- **Files:** Modify `apps/web/src/lib/orchestrator-factory.ts` (escalation deps section), modify `apps/web/src/app/api/cron/emergency/process-due/route.ts`, modify webhook routes (`voice-status`, `sms-reply`)
- **Work:**
  - Pass the shared `StdoutJsonLogger` into escalation coordinator deps
  - `[v2r]` In cron/webhook routes (already wrapped by `withObservedRoute` from PR 3), pass the route's `ObservabilityContext` into coordinator method calls: `coordinator.processDue(ctx)`, `coordinator.processCallOutcome(incident, outcome, ctx)`, etc.
- **Test criteria:** Build passes. Emergency flow logs through shared logger with cron/webhook `request_id`.

**PR 5 exit criteria:** S25-01 is fully closeable. All runtime paths (routes, dispatcher, LLM, emergency) emit structured JSON logs through the shared `Logger` interface. `request_id` is present on every log entry — from the route for synchronous paths, from the cron/webhook trigger for async paths.

---

### PR 6 — Track 2a: Operational metrics store

**Goal:** Postgres-backed append-only metrics table with async write and windowed query support.

#### Task 2a.1 — DB migration
- **Files:** Create `packages/db/src/migrations/008-operational-metrics.sql`
- **Work:**
  ```sql
  CREATE TABLE IF NOT EXISTS operational_metrics (
    id            BIGSERIAL PRIMARY KEY,
    metric_name   TEXT NOT NULL,
    metric_value  DOUBLE PRECISION NOT NULL,
    component     TEXT NOT NULL,
    request_id    TEXT,
    conversation_id TEXT,
    action_type   TEXT,
    error_code    TEXT,
    tags_json     JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_om_name_created ON operational_metrics (metric_name, created_at);
  CREATE INDEX idx_om_component_created ON operational_metrics (component, created_at);
  ```
- **Test criteria:** Migration runs cleanly on a fresh DB (CI).

#### Task 2a.2 — `[v2r]` Postgres metrics store implementing both interfaces
- **Files:** Create `packages/db/src/repos/pg-operational-metrics-store.ts`, update `packages/db/src/index.ts`
- **Work:**
  - `PgOperationalMetricsStore` implements both `MetricsRecorder` and `MetricsQueryStore` from core
  - `record(obs): Promise<void>` → INSERT row, returns promise (callers choose whether to await)
  - `queryWindow(metricName, windowMinutes): Promise<number>` → SELECT SUM(metric_value) within time window
  - `queryCount(metricName, windowMinutes): Promise<number>` → SELECT COUNT(*) within time window
- **Test criteria:** Integration test with test DB: insert 5 observations, `queryWindow` returns correct sum, `queryCount` returns correct count. Verify `record()` returns a promise that resolves after the INSERT completes.

#### Task 2a.3 — Wire Postgres recorder in factory
- **Files:** Modify `apps/web/src/lib/orchestrator-factory.ts`
- **Work:**
  - If `DATABASE_URL` exists: create `PgOperationalMetricsStore`, use it as both `MetricsRecorder` (injected into deps) and `MetricsQueryStore` (available for alert evaluator)
  - Otherwise: keep `NoopMetricsRecorder` (same as Track 0)
  - Replace the noop recorder wired in PR 1
  - `[v2r]` Export `getMetricsQueryStore()` for the alert evaluator cron route (returns `MetricsQueryStore | null`)
- **Test criteria:** Build passes. Factory correctly selects recorder based on env.

**PR 6 exit criteria:** Metrics table exists. `PgOperationalMetricsStore` implements async `MetricsRecorder` + `MetricsQueryStore`. Windowed queries work.

---

### PR 7 — Track 2b: Metrics instrumentation

**Goal:** Emit the 10 required spec metrics at the correct code boundaries.

`[v2r]` **Await strategy:** `MetricsRecorder.record()` is async. In the LLM wrapper and dispatcher, metric writes are collected as promises and `Promise.all`-awaited at the end of the action/call boundary (not fire-and-forget). This ensures Vercel doesn't terminate the function before writes land. In the route wrapper (PR 3), any pending metric writes are awaited before sending the response.

#### Task 2b.1 — LLM metrics
- **Files:** Modify `packages/core/src/llm/with-observed-llm-call.ts` (from PR 4)
- **Work:**
  - On every LLM call: `await metricsRecorder.record({ metric_name: 'llm_call_latency_ms', metric_value: duration, component: toolName, request_id: ctx?.request_id })`
  - On LLM error: `await metricsRecorder.record({ metric_name: 'llm_call_error_total', metric_value: 1, component: toolName, error_code, request_id: ctx?.request_id })`
  - On schema validation failure (in splitter/classifier/followup callers): `await metricsRecorder.record({ metric_name: 'schema_validation_failure_total', metric_value: 1, component: toolName })`
- **Test criteria:** `InMemoryMetricsRecorder` captures expected observations after mock LLM call.

#### Task 2b.2 — Orchestrator action metrics
- **Files:** Modify `packages/core/src/orchestrator/dispatcher.ts`
- **Work:**
  - On action complete: `await deps.metricsRecorder?.record({ metric_name: 'orchestrator_action_latency_ms', metric_value: duration, action_type })`
  - On conversation state change: compute `conversation_state_duration_ms` from session `updated_at` vs current time, emit metric
  - On domain validation failure in handlers: emit `domain_validation_failure_total`
- **Test criteria:** Dispatch action → `InMemoryMetricsRecorder` contains latency + state duration observations.

#### Task 2b.3 — Abandonment and escalation metrics
- **Files:** Modify `packages/core/src/orchestrator/action-handlers/abandon.ts`, `packages/core/src/risk/escalation-coordinator.ts`
- **Work:**
  - On ABANDON action: `await deps.metricsRecorder?.record({ metric_name: 'conversation_abandoned_total', metric_value: 1 })`
  - On cycle exhaustion: `await deps.metricsRecorder?.record({ metric_name: 'escalation_cycle_exhausted_total', metric_value: 1 })`
- **Test criteria:** Abandon action → metric recorded. Escalation exhaustion → metric recorded.

#### Task 2b.4 — Notification failure metrics
- **Files:** Modify `packages/core/src/notifications/notification-service.ts`
- **Work:**
  - Accept optional `MetricsRecorder` in constructor/config
  - On delivery failure: `await metricsRecorder.record({ metric_name: 'notification_delivery_failure_total', metric_value: 1 })`
- **Test criteria:** Mock SMS failure → metric recorded.

**PR 7 exit criteria:** All 10 required spec metrics are emitted via async `MetricsRecorder`. S25-02 is closeable.

---

### PR 8 — Track 3: Alerts

**Goal:** Real operator notifications for critical failures. Cooldown-protected. Cron-evaluated for windowed conditions.

#### Task 3.1 — SMS alert sink
- **Files:** Create `packages/core/src/observability/sms-alert-sink.ts`
- **Work:**
  - Implements `AlertSink`
  - Sends SMS to configured ops numbers via `SmsProvider`
  - Logs every emission through `Logger`
  - Records emission as metric observation for audit via `MetricsRecorder`
- **Test criteria:** Unit test: emit alert → SMS provider called with formatted message. Logger entry recorded. Metric observation recorded.

#### Task 3.2 — `[v2r]` Alert cooldown store with composite key
- **Files:** Create `packages/db/src/migrations/009-alert-cooldowns.sql`, create `packages/db/src/repos/pg-alert-cooldown-store.ts`
- **Work:**
  ```sql
  CREATE TABLE IF NOT EXISTS alert_cooldowns (
    alert_name       TEXT NOT NULL,
    scope            TEXT NOT NULL DEFAULT '_global',
    last_alerted_at  TIMESTAMPTZ NOT NULL,
    cooldown_minutes INTEGER NOT NULL DEFAULT 30,
    PRIMARY KEY (alert_name, scope)
  );
  ```
  - `shouldAlert(alertName, scope, cooldownMinutes)` → check if `(alert_name, scope)` last alert was > cooldown ago
  - `recordAlert(alertName, scope)` → upsert `last_alerted_at` for `(alert_name, scope)`
  - In-memory implementation for tests: `InMemoryAlertCooldownStore`
  - Default `scope` is `'_global'` — callers that don't need per-component granularity omit it
- **Test criteria:** Record alert for `('llm_error_spike', 'classifier')` → immediate re-check for same key returns false. Check for `('llm_error_spike', 'splitter')` returns true (independent cooldown). Wait past cooldown → returns true.

#### Task 3.3 — `[v2r]` Alert evaluator with explicit data source separation
- **Files:** Create `packages/core/src/observability/alert-evaluator.ts`
- **Work:**
  - `evaluateAlerts(deps)` — the main evaluation function
  - **`[v2r]` deps type:**
    ```typescript
    interface AlertEvaluatorDeps {
      metricsQuery: MetricsQueryStore;           // for windowed metric queries
      escalationIncidentStore: EscalationIncidentStore; // for live backlog query
      alertSink: AlertSink;
      cooldownStore: AlertCooldownStore;
      logger: Logger;
      config: AlertEvaluatorConfig;
    }
    ```
  - Windowed metric alerts (query `MetricsQueryStore`):
    - `llm_call_error_total` in last 15 min > threshold → `llm_error_spike` alert (scope: `'_global'`)
    - `schema_validation_failure_total` in last 15 min > threshold → `schema_failure_spike` alert (scope: `'_global'`)
  - **`[v2r]` Live operational query (query `EscalationIncidentStore` directly):**
    - Call `escalationIncidentStore.countOverdue()` → if > threshold → `async_backlog_threshold_exceeded` alert
    - `[v2r]` This counts incidents with `status IN ('active', 'exhausted_retrying')` that are past `next_action_at` and not processing-locked — matching the existing `getDueIncidents` predicate. This is **not** a metric-window query — it is a live operational query against the incident store.
  - Respects cooldowns (with scope) before emitting
  - Config via env vars: `ALERT_LLM_ERROR_SPIKE_THRESHOLD`, `ALERT_SCHEMA_FAILURE_SPIKE_THRESHOLD`, `ALERT_ASYNC_BACKLOG_THRESHOLD`, `ALERT_COOLDOWN_MINUTES`
- **Test criteria:** Seed `InMemoryMetricsRecorder` with spike data → evaluator emits alert via `InMemoryAlertSink`. Seed below threshold → no alert. Cooldown active → no duplicate. Seed overdue incidents → backlog alert emitted.

#### Task 3.4 — `[v2r]` Add alert sink to escalation coordinator (additive, not replacement)
- **Files:** Modify `packages/core/src/risk/escalation-coordinator.ts`
- **Work:**
  - Accept optional `AlertSink` in `EscalationCoordinatorDeps`
  - On cycle exhaustion: call `alertSink.emit(...)` **in addition to** the existing direct `smsProvider.sendSms(internalAlertNumber, ...)` call
  - **`[v2r]` The existing direct SMS path is preserved unconditionally.** The alert sink is additive — it provides a second notification channel (ops team), while the direct SMS remains the primary safety net for the on-call contact. If `AlertSink` is `NoopAlertSink` (no `OPS_ALERT_PHONE_NUMBERS` configured), the direct SMS still fires.
  - Order: direct SMS first (existing behavior), then `alertSink.emit()` (new)
- **Test criteria:** Existing escalation exhaustion tests pass unchanged. New test: with both `InMemoryAlertSink` and mock `SmsProvider` → both SMS **and** alert sink are called. Test with `NoopAlertSink` → direct SMS still fires.

#### Task 3.5 — `[v2r]` Cron route for alert evaluation (GET, matching existing pattern)
- **Files:** Create `apps/web/src/app/api/cron/observability/evaluate-alerts/route.ts`
- **Work:**
  - **`[v2r]` `GET` handler** (not POST), matching the validated Vercel cron pattern in `process-due/route.ts`
  - Auth: `Authorization: Bearer ${CRON_SECRET}` — same pattern as `process-due`
  - Feature flag: `OBSERVABILITY_ALERTS_ENABLED` env var (same kill-switch pattern as `EMERGENCY_ROUTING_ENABLED`)
  - Calls `evaluateAlerts()` with wired deps from factory
  - Returns 200 with evaluation summary JSON
- **Test criteria:** Unit test: valid cron secret → evaluator called. Invalid secret → 401. Feature flag off → `{ skipped: true }`.

#### Task 3.6 — Wire real alert sink in factory
- **Files:** Modify `apps/web/src/lib/orchestrator-factory.ts`
- **Work:**
  - If `OPS_ALERT_PHONE_NUMBERS` env var exists: create `SmsAlertSink` with real SMS provider
  - Otherwise: keep `NoopAlertSink`
  - `[v2r]` Wire `AlertSink` into **both** orchestrator deps and escalation coordinator deps (additive in both cases)
  - Export `getAlertEvaluatorDeps()` for the cron route — assembles `AlertEvaluatorDeps` from `MetricsQueryStore`, `EscalationIncidentStore`, `AlertSink`, `AlertCooldownStore`, `Logger`, and env-driven config
- **Test criteria:** Build passes. Factory selects correct sink based on env. `getAlertEvaluatorDeps()` returns null if `DATABASE_URL` is unset (no metrics to query).

#### Task 3.7 — Vercel cron config
- **Files:** Modify `apps/web/vercel.json`
- **Work:**
  - Add cron entry: `{ "path": "/api/cron/observability/evaluate-alerts", "schedule": "*/5 * * * *" }`
- **Test criteria:** `vercel.json` is valid JSON. Cron path matches route.

#### Task 3.8 — `[v2r]` Add `countOverdue()` to EscalationIncidentStore
- **Files:** Modify `packages/core/src/risk/escalation-incident-store.ts` (interface), modify `packages/core/src/risk/in-memory-incident-store.ts`, modify `packages/db/src/repos/pg-escalation-incident-store.ts`
- **Work:**
  - Add `countOverdue(): Promise<number>` to the `EscalationIncidentStore` interface
  - `[v2r]` Must match the existing `getDueIncidents` predicate: `status IN ('active', 'exhausted_retrying') AND next_action_at <= now AND (processing_lock_until IS NULL OR processing_lock_until < now)`. Using only `status === 'active'` would miss retry-cycle incidents that are part of the real async backlog.
  - In-memory: count entries matching the predicate above (same filter as `getDueIncidents` but returning count instead of rows)
  - Postgres: `SELECT COUNT(*) FROM escalation_incidents WHERE status IN ('active', 'exhausted_retrying') AND next_action_at <= NOW() AND (processing_lock_until IS NULL OR processing_lock_until < NOW())`
- **Test criteria:** Seed store with 2 overdue `active` + 1 overdue `exhausted_retrying` + 1 not-yet-due `active` + 1 `resolved` → `countOverdue()` returns 3.

**PR 8 exit criteria:** S25-04 is closeable. Escalation exhaustion fires both the existing direct SMS **and** the shared alert sink (additive). LLM error spikes, schema failure spikes query `MetricsQueryStore`. Async backlog queries `EscalationIncidentStore.countOverdue()` directly (not the metrics table). All alerts are cooldown-protected with composite `(alert_name, scope)` keys. Cron uses GET with Bearer token.

---

### PR 9 — Track 4: Verification and spec-gap-tracker update

**Goal:** Comprehensive test coverage for the full observability stack. Update tracker to DONE.

#### Task 4.1 — Integration test: full request → log → metric → alert flow
- **Files:** Create `packages/core/src/__tests__/integration/observability-e2e.test.ts`
- **Work:**
  - Wire dispatcher with `InMemoryLogger`, `InMemoryMetricsRecorder`, `InMemoryAlertSink`
  - Dispatch a full conversation flow (create → select unit → submit message → confirm)
  - Assert: log entries for every action, metric observations for latency + state duration, no alerts (happy path)
  - Dispatch LLM failures past threshold → assert alert emitted
- **Test criteria:** Test passes. Covers the full observability contract end-to-end.

#### Task 4.2 — Integration test: alert evaluator with seeded metrics
- **Files:** Create `packages/core/src/__tests__/integration/alert-evaluator.test.ts`
- **Work:**
  - Seed `InMemoryMetricsRecorder` with various spike scenarios
  - Run `evaluateAlerts()` → assert correct alerts emitted
  - Test cooldown prevents duplicates
  - Test below-threshold → no alert
- **Test criteria:** All scenarios pass.

#### Task 4.3 — Update spec-gap-tracker
- **Files:** Modify `docs/spec-gap-tracker.md`
- **Work:**
  - Move `S25-01` to `DONE` with evidence: route wrapper, dispatcher instrumentation, LLM wrapper, escalation normalization
  - Move `S25-02` to `DONE` with evidence: `operational_metrics` table, 10 required metrics emitted, windowed queries
  - Move `S25-04` to `DONE` with evidence: SMS alert sink, cron evaluator, cooldown store, 4 alert types
  - Update dashboard totals
  - Scan full tracker for any other rows affected by observability additions (per feedback memory)
- **Test criteria:** Tracker totals are correct. No stale rows reference "no logging" or "no metrics".

**PR 9 exit criteria:** Full test coverage. Spec-gap-tracker reflects reality. Section 25 is closed.

---

## PR Summary and Dependencies

```
PR 1 (Track 0)  ─── contract + wiring ───────────────────────── foundation
  │
  ├── PR 2 (Track 1a) ── dispatcher logging ──────┐
  ├── PR 3 (Track 1b) ── route logging ───────────┤
  ├── PR 4 (Track 1c) ── LLM logging ────────────┤── S25-01
  └── PR 5 (Track 1d) ── emergency normalization ─┘
  │
  ├── PR 6 (Track 2a) ── metrics store ───────────┐
  └── PR 7 (Track 2b) ── metrics instrumentation ─┘── S25-02
       │
       └── PR 8 (Track 3) ── alerts ──────────────────── S25-04
            │
            └── PR 9 (Track 4) ── verification ──────── close S25
```

**Parallelization:**
- PRs 2, 3, 4, 5 can proceed in parallel after PR 1 merges (they instrument different boundaries)
- PR 6 can proceed in parallel with Track 1 PRs (DB schema is independent)
- PR 7 depends on PR 6 (needs the metrics store) and PRs 2/4 (instruments the same code that logging touched)
- PR 8 depends on PR 7 (alert evaluator queries metrics)
- PR 9 depends on all prior PRs

## Env Vars (new)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPS_ALERT_PHONE_NUMBERS` | No | — | Comma-separated phone numbers for ops alerts. No value = NoopAlertSink. |
| `ALERT_LLM_ERROR_SPIKE_THRESHOLD` | No | `10` | LLM errors in 15-min window to trigger alert |
| `ALERT_SCHEMA_FAILURE_SPIKE_THRESHOLD` | No | `5` | Schema failures in 15-min window to trigger alert |
| `ALERT_ASYNC_BACKLOG_THRESHOLD` | No | `3` | Past-due escalation incidents to trigger alert |
| `ALERT_COOLDOWN_MINUTES` | No | `30` | Minimum minutes between repeated alerts of same type |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Changing `OrchestratorDependencies` breaks tests | All new fields are optional. Existing tests pass without changes. |
| `[v2r]` JSON schema drift widens if TS types and JSON schema diverge | PR 1 Task 0.5 updates both in lockstep. Emergency action type drift is fixed in the same task. CI schema validation tests catch future divergence. |
| `[v2r]` LLM adapter signature change breaks callers | New `ObservabilityContext` param is optional and trailing. Existing calls compile without changes. Only 3 action handlers are updated (PR 4 Task 1c.3). |
| `[v2r]` Async `MetricsRecorder.record()` not awaited, writes lost on Vercel | Route wrapper awaits pending metric writes before responding. Dispatcher and LLM wrapper await at action/call boundaries. `NoopMetricsRecorder` resolves synchronously for tests. |
| `[v2r]` Misconfigured env loses emergency alerts | Direct SMS path preserved unconditionally (D6). `AlertSink` is additive. `NoopAlertSink` fallback only affects the *additional* ops channel, never the primary on-call SMS. |
| Metrics table grows unbounded | Add retention policy (DELETE rows older than 30 days) as a follow-up migration. Not blocking for MVP. |
| Alert storms on first enable | Conservative default thresholds + 30-min cooldown with composite `(alert_name, scope)` keys. `OBSERVABILITY_ALERTS_ENABLED` kill switch on the cron route. |
| Vercel cold starts reset in-memory alert state | Cooldown state persists in Postgres (D4). |
| Logging adds latency to hot paths | `Logger.log()` is synchronous stdout write (fast). `MetricsRecorder.record()` is a single INSERT, awaited at boundaries. |
