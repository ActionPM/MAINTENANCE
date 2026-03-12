# 2026-03-12 Observability Remediation Plan

## Objective

Close the remaining Section 25 gaps tracked as:

- `S25-01` — structured JSON logs with `request_id`, action, state, latency, error codes
- `S25-02` — runtime metrics for LLM behavior, state durations, abandonment, escalation exhaustion, notification failures, schema failures
- `S25-04` — alerting for escalation exhaustion, LLM error spikes, schema failure spikes, and async backlog

This plan assumes the current emergency escalation runtime stays in place and becomes the first consumer of a broader observability layer rather than a one-off exception.

## Current Baseline

What already exists:

- `apps/web/src/middleware/request-context.ts`
  - Generates `request_id`, but is not yet threaded through the app.
- `packages/core/src/risk/escalation-coordinator.ts`
  - Emits structured JSON logs to stdout for emergency incidents.
  - Sends internal alert SMS on cycle exhaustion.
  - Writes append-only risk events.
- Emergency webhook and cron routes
  - Exist and are wired, but use ad hoc logging and no shared request-scoped observability contract.

What is still missing:

- No shared logger used by all API routes, dispatcher flows, or LLM adapters.
- No metrics sink or queryable operational metric store.
- No alert evaluator for non-emergency failures or backlog conditions.
- No request/route latency logging across the API surface.
- No unified error-code logging for orchestrator and LLM failures.

## Design Goals

1. Keep the first implementation self-contained in this repo.
2. Avoid blocking on Datadog, OpenTelemetry exporters, or other external observability vendors.
3. Reuse existing append-only patterns where practical.
4. Make emergency escalation a consumer of the common observability layer, not a special case.
5. Keep production and dev behavior aligned: no fake success paths for alerts or metrics.

## Non-Goals

- Full distributed tracing
- Dashboard UI work
- Replacing the existing emergency risk events
- Rewriting the orchestrator architecture before instrumentation

## Recommended Architecture

Implement Section 25 as three layers:

1. Shared runtime context and structured logger
2. Append-only operational metrics/event store
3. Alert evaluator plus delivery sink

### 1. Shared runtime context and logger

Create a small observability contract used by both `apps/web` and `packages/core`:

- `request_id`
- `component`
- `event`
- `action_type`
- `conversation_id`
- `work_order_id`
- `tenant_user_id`
- `state_before`
- `state_after`
- `duration_ms`
- `error_code`
- `severity`

Recommendation:

- Web layer owns request-scoped context creation.
- Core receives context fields via dependency injection or helper wrappers.
- Structured logs continue to go to stdout as JSON.

### 2. Operational metrics store

Add a small append-only Postgres-backed store for metric observations so the app can evaluate spikes and backlog without requiring an external metrics platform.

Recommended table: `operational_metrics`

Suggested columns:

- `event_id`
- `metric_name`
- `metric_type`
- `metric_value`
- `component`
- `request_id`
- `conversation_id`
- `work_order_id`
- `action_type`
- `error_code`
- `tags_json`
- `created_at`

Rationale:

- Enables alert windows like “schema failures in last 15 minutes.”
- Keeps the first implementation queryable in SQL.
- Avoids hand-waving “metrics exist” when they are only log lines.

### 3. Alert evaluator and sink

Implement an `AlertSink` abstraction with an initial real SMS sink for operator alerts. Keep the interface generic so Slack, email, or PagerDuty can be added later.

Phase 1 recommendation:

- SMS alert delivery to configured ops numbers
- structured log mirror for every alert emitted
- append-only alert event row or metric observation for audit

## Implementation Order

### Track 0 — Shared observability contract

Goal: define the shared shape once before instrumenting routes or core flows.

Files to add:

- `packages/core/src/observability/types.ts`
- `packages/core/src/observability/logger.ts`
- `packages/core/src/observability/metrics.ts`
- `packages/core/src/observability/alerts.ts`
- `apps/web/src/lib/observability/logger.ts`
- `apps/web/src/lib/observability/request-context.ts`

Tasks:

- Promote `request-context.ts` from a dead scaffold to a real request-context helper.
- Define typed log event names instead of free-form strings for common runtime events.
- Define a `MetricsSink` interface and a `NoopMetricsSink` for tests.
- Define an `AlertSink` interface and a `NoopAlertSink` for local dev tests.

Exit criteria:

- Web and core can emit logs/metrics/alerts through shared interfaces.
- No new instrumentation is added with ad hoc `console.log` calls outside the shared logger.

### Track 1 — `S25-01` structured logging

Goal: move from emergency-only logging to request-scoped, spec-wide structured logs.

Primary file targets:

- `apps/web/src/app/api/**/route.ts`
- `apps/web/src/middleware/request-context.ts`
- `packages/core/src/orchestrator/dispatcher.ts`
- `packages/core/src/orchestrator/action-handlers/*.ts`
- `packages/core/src/risk/escalation-coordinator.ts`
- LLM adapter entry points used by splitter/classifier/follow-ups

Implementation tasks:

1. Add a route wrapper such as `withObservedRoute()` for all API handlers.
   - Emit `request_started`, `request_completed`, `request_failed`
   - Include `request_id`, route, method, status, duration, auth principal when available

2. Instrument dispatcher execution.
   - Log `action_received`, `action_completed`, `action_rejected`
   - Include `action_type`, `state_before`, `state_after`, `conversation_id`, `error_code`

3. Instrument LLM tool boundaries.
   - Log `llm_call_started`, `llm_call_completed`, `llm_call_failed`
   - Include `tool_name`, `model_id`, retry count, schema-validation result, duration

4. Normalize emergency logs onto the same logger interface.
   - Keep existing event richness
   - Stop treating escalation logging as a one-off implementation

5. Capture latency everywhere the spec requires it.
   - route latency
   - dispatcher/action latency
   - LLM call latency
   - ERP adapter call latency where available

Exit criteria:

- Every API route emits request start/end/failure logs with `request_id`.
- Every orchestrator action emits action-level logs with state and error code fields.
- Every LLM call emits start/end/failure logs with duration and validation outcome.
- `S25-01` can move to `DONE`.

### Track 2 — `S25-02` metrics

Goal: make the required runtime metrics queryable and alertable.

Primary file targets:

- `packages/db/src/migrations/008-operational-metrics.sql`
- `packages/db/src/repos/pg-operational-metrics-store.ts`
- `packages/core/src/observability/metrics.ts`
- `packages/core/src/orchestrator/dispatcher.ts`
- `packages/core/src/risk/escalation-coordinator.ts`
- `packages/core/src/notifications/notification-service.ts`
- LLM adapter wrappers

Required metric set:

- `llm_call_latency_ms`
- `llm_call_error_total`
- `schema_validation_failure_total`
- `domain_validation_failure_total`
- `orchestrator_action_latency_ms`
- `conversation_state_duration_ms`
- `conversation_abandoned_total`
- `escalation_cycle_exhausted_total`
- `notification_delivery_failure_total`
- `async_backlog_count`

Implementation tasks:

1. Add the Postgres metric store and repository interface.
2. Emit a metric observation at the same boundaries instrumented in Track 1.
3. Compute `conversation_state_duration_ms` when leaving a state.
   - derive from existing session/event timestamps where possible
   - add minimal session metadata only if derivation is not reliable
4. Define backlog metrics for async work.
   - due escalation incidents past `next_action_at`
   - optional later extension for notification backlog
5. Keep test/dev sinks simple.
   - in-memory collector for tests
   - Postgres in production when `DATABASE_URL` exists

Exit criteria:

- Each required spec metric is emitted in production code paths.
- Metric rows are queryable by time window and tagged by component/scope.
- `S25-02` can move to `DONE`.

### Track 3 — `S25-04` alerts

Goal: turn critical failures into real operator notifications instead of passive logs.

Primary file targets:

- `packages/core/src/observability/alerts.ts`
- `apps/web/src/app/api/cron/observability/evaluate-alerts/route.ts`
- `apps/web/src/lib/orchestrator-factory.ts`
- `packages/core/src/risk/escalation-coordinator.ts`

Phase 1 alert set:

- `escalation_exhausted_final`
- `llm_error_spike`
- `schema_failure_spike`
- `async_backlog_threshold_exceeded`

Implementation tasks:

1. Keep direct emergency exhaustion alerts in-place, but route them through the shared `AlertSink`.
2. Add an alert evaluation cron route for windowed alerts.
   - recent LLM error volume
   - recent schema/domain validation failure volume
   - current async backlog size
3. Add dedupe/cooldown rules.
   - prevent repeated alerts every minute for the same ongoing condition
4. Persist alert emissions.
   - log event
   - metric row or alert event row
5. Configure real delivery.
   - initial recommendation: SMS to ops numbers
   - add env-driven thresholds and cooldowns

Recommended env vars:

- `OPS_ALERT_PHONE_NUMBERS`
- `ALERT_LLM_ERROR_SPIKE_THRESHOLD`
- `ALERT_SCHEMA_FAILURE_SPIKE_THRESHOLD`
- `ALERT_ASYNC_BACKLOG_THRESHOLD`
- `ALERT_COOLDOWN_MINUTES`

Exit criteria:

- Exhausted escalation alerts use the shared alert sink.
- LLM error spikes, schema failure spikes, and async backlog breaches trigger real alerts.
- Duplicate alert storms are controlled by cooldown logic.
- `S25-04` can move to `DONE`.

### Track 4 — Verification and rollout

Goal: ship observability without introducing blind spots or noisy false alarms.

Tests required:

- route wrapper logs `request_id`, status, duration
- dispatcher logs valid and invalid transitions with error codes
- LLM wrappers emit latency and failure metrics
- Postgres metric store reads/writes and time-window queries
- alert evaluator thresholds and cooldown behavior
- cron route auth and happy-path processing
- emergency exhaustion still sends alert through the shared sink

Rollout steps:

1. Merge with logging enabled first.
2. Enable metrics persistence.
3. Enable alert evaluation with conservative thresholds.
4. Validate canary behavior on one environment before broad rollout.

## Recommended Build Sequence

1. Track 0 — shared contract
2. Track 1 — logging
3. Track 2 — metrics
4. Track 3 — alerts
5. Track 4 — verification and rollout

Parallelization:

- Track 1 route instrumentation and Track 2 schema/repo work can overlap after Track 0.
- Track 3 should wait for Track 2 because spike/backlog alerts depend on metric queries.

## Risks to Avoid

- Counting “structured logs in one subsystem” as Section 25 completion
- Adding metrics names without a real sink/query path
- Triggering repeated alerts without cooldowns
- Shipping per-route logging without `request_id` propagation into core code
- Creating a metrics backend that works only in tests and not on Vercel/Postgres

## Exit Criteria

This workstream is complete when:

- `S25-01` is `DONE` with request-scoped structured logs across web routes, orchestrator actions, and LLM calls
- `S25-02` is `DONE` with the required metrics emitted and queryable
- `S25-04` is `DONE` with real alert delivery for the spec-defined failure modes
- `docs/spec-gap-tracker.md` and `docs/spec.md` agree on the resulting runtime behavior
