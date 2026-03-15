# Staging Release-Readiness Validation Plan

**Date:** 2026-03-15

## Objective

Validate that the current staging deployment is operationally ready for the next release checkpoint.

This plan is a runtime gate, not a code-completeness gate. Code Gate is already closed in the repository except for the known `S12-03` frontend partial. This plan answers a different question:

"Does the deployed system behave correctly, safely, and predictably in staging when environment-dependent paths are exercised?"

## In Scope

- Staging deployment config audit
- Cron auth validation
- Observability alert evaluator validation
- Emergency routing fail-closed validation
- Deployed environment wiring validation
- Release-status decision: `green`, `config_issue`, or `runtime_defect`

## Out of Scope

- Frontend `S12-03` handoff implementation
- New feature work
- Production cutover
- Secret rotation execution beyond already-completed `CRON_SECRET` rotation
- Broad regression testing unrelated to runtime readiness

## Runtime Surfaces Under Test

### Routes

- `GET /api/health`
- `GET /api/cron/observability/evaluate-alerts`
- `GET /api/cron/emergency/process-due`
- `POST /api/conversations/[id]/confirm-emergency` when fail-closed behavior needs tenant-path validation

### Environment-dependent wiring

- `CRON_SECRET`
- `DATABASE_URL`
- `OBSERVABILITY_ALERTS_ENABLED`
- `OPS_ALERT_PHONE_NUMBERS`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `TWILIO_WEBHOOK_BASE_URL`
- `EMERGENCY_ROUTING_ENABLED`
- `EMERGENCY_INTERNAL_ALERT_NUMBER`

### Backing storage / state

- `operational_metrics`
- `alert_cooldowns`
- `escalation_incidents`
- Vercel cron configuration in `apps/web/vercel.json`

## Preconditions

Do not start execution until all of the following are true:

1. A specific staging deployment URL is identified.
2. The deployment SHA or timestamp is recorded.
3. The operator has access to:
   - Vercel project env vars
   - Vercel function logs
   - staging database query access, either via `psql`, Neon SQL editor, or equivalent
4. `CRON_SECRET` is available from the secret manager.
5. A safe test destination exists for alert SMS and emergency/internal alert SMS.
6. The operator knows whether shared staging can tolerate temporary env toggles. If not, use a disposable preview environment for failure-path validation.

## Baseline Already Verified Locally

These are not staging substitutes, but they reduce ambiguity before execution:

- Targeted core tests for observability, emergency routing, confirmation, and `S12-03` paths passed on 2026-03-15.
- Targeted web tests for the named frontend/API surfaces passed on 2026-03-15.
- `pnpm --filter @wo-agent/web build` passed on 2026-03-15.

## Evidence Capture Template

Record one row per executed check.

| Check ID | Area             | Environment | Input / Toggle       | Expected Result | Actual Result | Evidence                           | Outcome     |
| -------- | ---------------- | ----------- | -------------------- | --------------- | ------------- | ---------------------------------- | ----------- |
| `RR-01`  | _e.g. cron auth_ | `staging`   | _wrong bearer token_ | `401`           | _fill in_     | _log link, screenshot, SQL output_ | `pass/fail` |

Required evidence types:

- HTTP response status and body
- Relevant structured log line(s)
- SQL query result when DB state is part of the expectation
- Exact env toggle state if behavior depends on flags or missing credentials

## Execution Plan

### Phase 0. Freeze the Target and Access Path

Goal: eliminate "wrong deployment" and "wrong env" confusion before any smoke test runs.

Steps:

1. Record the staging base URL.
2. Record the active deployment SHA or deployment timestamp from Vercel.
3. Record whether validation is against:
   - shared staging, or
   - a disposable preview environment
4. Confirm the current cron schedules deployed in staging match:
   - `/api/cron/emergency/process-due` -> `* * * * *`
   - `/api/cron/observability/evaluate-alerts` -> `*/5 * * * *`
5. Confirm the test window and whether temporary env changes are allowed.

Exit criteria:

- One exact deployment target is agreed.
- Evidence capture sheet is ready.

### Phase 1. Deployment Config Audit

Goal: verify that missing behavior is not simply missing configuration.

Steps:

1. Inspect staging env vars and record whether each is:
   - set correctly
   - intentionally disabled
   - missing
2. Verify `CRON_SECRET` exists in staging and matches the operator-held secret.
3. Verify `DATABASE_URL` exists for the staging deployment.
4. Verify intended flag states:
   - `OBSERVABILITY_ALERTS_ENABLED=true` when alert evaluator success path is in scope
   - `EMERGENCY_ROUTING_ENABLED=true` only when live emergency routing is intentionally being exercised
5. Verify Twilio config completeness:
   - all four Twilio variables present if live SMS/voice behavior is expected
6. Verify `OPS_ALERT_PHONE_NUMBERS` and `EMERGENCY_INTERNAL_ALERT_NUMBER` point to safe test recipients.
7. Note alert evaluator threshold overrides if set (these affect seed counts in Phase 4B):
   - `ALERT_LLM_ERROR_SPIKE_THRESHOLD` (default: `10`)
   - `ALERT_SCHEMA_FAILURE_SPIKE_THRESHOLD` (default: `5`)
   - `ALERT_ASYNC_BACKLOG_THRESHOLD` (default: `3`)
   - `ALERT_COOLDOWN_MINUTES` (default: `30`)
   - If any threshold is set higher than the default, adjust the Phase 4B seed row count accordingly.

Suggested outputs to record:

- env presence matrix
- note any intentional disables
- note whether failure-path testing must use a disposable preview because shared staging cannot be mutated

Exit criteria:

- No ambiguity remains about whether a later failure is code, config, or a kill switch.

### Phase 2. Basic Reachability and Health

Goal: confirm the deployment is up before testing gated paths.

Suggested PowerShell examples:

```powershell
$base = "https://<staging-host>"
Invoke-WebRequest -Method GET -Uri "$base/api/health"
```

**Important:** The health endpoint is a stub — it returns `{ status: "ok", services: { db: "stub", llm: "stub", storage: "stub", notifications: "stub" } }` with hardcoded service statuses. A 200 proves the deployment is reachable and the app boots, but does **not** verify that backing services (DB, Twilio, LLM) are connected. Backing service connectivity is validated in later phases via actual route behavior.

Steps:

1. Call `GET /api/health`.
2. Confirm a `200` response with `status: "ok"`.
3. Record any deployment-level error before proceeding to cron-specific checks.

Exit criteria:

- The deployment is reachable and the application is running.

### Phase 3. Cron Auth Validation

Goal: prove both cron routes enforce bearer auth correctly.

Suggested PowerShell setup:

```powershell
$base = "https://<staging-host>"
$goodHeaders = @{ Authorization = "Bearer $env:CRON_SECRET" }
$badHeaders = @{ Authorization = "Bearer definitely-wrong" }
```

Checks:

#### RR-01. Observability cron rejects bad token

```powershell
Invoke-WebRequest -Method GET -Uri "$base/api/cron/observability/evaluate-alerts" -Headers $badHeaders
```

Expected:

- `401`
- response body indicates unauthorized
- route logs include the request with a non-success status

#### RR-02. Emergency cron rejects bad token

```powershell
Invoke-WebRequest -Method GET -Uri "$base/api/cron/emergency/process-due" -Headers $badHeaders
```

Expected:

- `401`
- response body indicates unauthorized

#### RR-03. Both routes accept the correct token

Repeat both calls with `$goodHeaders`.

Expected:

- no `401`
- route behavior falls into the next logical branch based on flags and env wiring

Exit criteria:

- Cron auth is definitely enforced and the rotated `CRON_SECRET` works.

### Phase 4. Observability Alert Evaluator Validation

Goal: prove the evaluator route, DB-backed query path, cooldown logic, and alert delivery path are wired correctly.

#### 4A. Branch validation without seeding alerts

Checks:

1. Call `GET /api/cron/observability/evaluate-alerts` with the correct bearer token.
2. Confirm the branch matches the known env state:
   - `200` with `{ skipped: true, reason: "Observability alerts disabled" }` only when `OBSERVABILITY_ALERTS_ENABLED` is intentionally off
   - `500` with `{ error: "Alert evaluator deps not available (no DATABASE_URL)" }` when evaluator dependencies are unavailable
   - success JSON when env wiring is complete — response includes `alertsEmitted`, `alertsSuppressed`, `alertsFailed` (string arrays) and `checks` (always `3`, confirming all three alert rules were evaluated)

Required evidence:

- response body
- route log entry
- note of current flag state

#### 4B. Controlled alert generation

Preferred method: seed the metrics table directly in staging because it is deterministic and does not require manufacturing real user-facing errors.

The evaluator uses `COUNT(*)` of rows within a 15-minute window, compared against the threshold with `>=`. The default `llm_error_spike` threshold is 10. Seed 15 rows to provide margin against timing drift (rows aging out of the window before the evaluator runs). If staging overrides `ALERT_LLM_ERROR_SPIKE_THRESHOLD` (checked in Phase 1 step 7), adjust the seed count to exceed that value.

Example SQL for `llm_error_spike`:

```sql
INSERT INTO operational_metrics
  (metric_name, metric_value, component, request_id, conversation_id, action_type, error_code, tags_json, created_at)
VALUES
  ('llm_call_error_total', 1, 'validation', 'rr-obs-1', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-2', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-3', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-4', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-5', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-6', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-7', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-8', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-9', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-10', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-11', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-12', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-13', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-14', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW()),
  ('llm_call_error_total', 1, 'validation', 'rr-obs-15', NULL, NULL, 'VALIDATION_SEED', '{"source":"release_readiness"}', NOW());
```

Alternative: seed `schema_validation_failure_total` instead if that is easier to reason about in the current environment.

Steps:

1. Seed a threshold-crossing windowed metric.
2. Call the evaluator route with the correct bearer token.
3. Confirm:
   - response JSON includes the expected alert in `alertsEmitted`, `alertsSuppressed`, or `alertsFailed`
   - logs include evaluator completion and any delivery failure detail
   - SMS reaches the configured ops/test destination when Twilio delivery is expected

#### 4C. Cooldown validation

Goal: ensure repeated successful delivery is suppressed during cooldown.

Steps:

1. Query cooldown state before the first successful emission:

```sql
SELECT * FROM alert_cooldowns WHERE alert_name IN ('llm_error_spike', 'schema_failure_spike', 'async_backlog_threshold_exceeded');
```

2. Run the evaluator until one alert is emitted successfully.
3. Query `alert_cooldowns` again and confirm the row was written.
4. Re-run the evaluator immediately without changing the seed condition.

Expected:

- first run emits the alert
- second run suppresses it
- cooldown row exists with the expected alert name and scope

#### 4D. Delivery-failure retry behavior

Goal: ensure failed delivery does not create false cooldown suppression.

Important:

- Do not mutate shared staging for this check unless explicitly approved.
- Preferred execution environment is a disposable preview or temporary staging clone.

Options:

1. Preview-environment method:
   - deploy the same code to a preview environment
   - set `OPS_ALERT_PHONE_NUMBERS`
   - remove or invalidate Twilio credentials
   - run the same seeded alert scenario
2. Shared-staging method:
   - only if a short, approved maintenance window exists
   - temporarily misconfigure Twilio delivery
   - run the evaluator twice
   - restore env immediately

Expected:

- first run reports `alertsFailed`
- second run also attempts delivery again
- no cooldown row suppresses the second attempt
- logs include delivery-failure detail

Exit criteria:

- Observability evaluator success path is proven.
- Cooldown suppression is proven for successful delivery.
- Failed delivery retry semantics are proven in staging or in an approved disposable equivalent.

### Phase 5. Emergency Routing Fail-Closed Validation

Goal: prove the system fails closed safely when emergency routing is unavailable.

This phase has two branches. Use the safest branch available.

**Precondition for all branches calling `POST /api/conversations/[id]/confirm-emergency`:** This route is authenticated (requires a valid tenant JWT) and rate-limited. The conversation must already be in the emergency confirmation state. Without both of these, the operator will receive a `401` or state-transition rejection, not the fail-closed response under test. Before executing any branch, ensure:

1. A valid tenant auth token is available for the staging environment.
2. A staging conversation exists in the correct state for emergency confirmation (either pre-seeded or driven there through the normal flow).

#### Branch A. Feature-flag fail-closed

Use when toggling `EMERGENCY_ROUTING_ENABLED` is allowed.

Steps:

1. Set `EMERGENCY_ROUTING_ENABLED=false`.
2. Trigger the tenant confirmation path for a conversation already in `pending_confirmation`, or use a prepared staging conversation for emergency confirmation.
3. Call `POST /api/conversations/[id]/confirm-emergency`.

Expected:

- response remains in the same conversation state
- response includes `EMERGENCY_ROUTING_UNAVAILABLE`
- safe 911 guidance is returned
- no escalation incident is created

DB verification:

```sql
SELECT * FROM escalation_incidents WHERE conversation_id = '<conversation-id>';
```

Expected:

- zero new active incidents

#### Branch B. Provider-missing fail-closed

Use when you must validate that routing is blocked even if the feature flag is on but Twilio wiring is absent.

Important:

- preferred environment is a disposable preview
- do not strip Twilio credentials from shared staging without approval

Steps:

1. Set `EMERGENCY_ROUTING_ENABLED=true`.
2. Remove one or more required Twilio variables so provider construction fails.
3. Call:
   - `POST /api/conversations/[id]/confirm-emergency`
   - `GET /api/cron/emergency/process-due` with the correct cron bearer token

Expected:

- confirm-emergency path returns error code `EMERGENCY_ROUTING_UNAVAILABLE` with message `"Voice/SMS providers are not configured"` and safe 911 guidance (note: this is a different message than Branch A's `"Emergency routing is disabled by feature flag"`)
- cron route returns `500` with `Escalation providers not configured`
- no escalation incident is created
- no incident processing occurs

#### Branch C. Live emergency path smoke (optional but recommended if safe)

Goal: verify that fail-closed hardening did not break the live path when routing is enabled and Twilio is configured.

Steps:

1. Restore valid Twilio envs and `EMERGENCY_ROUTING_ENABLED=true`.
2. Verify that `TWILIO_WEBHOOK_BASE_URL` points at the deployment under test (not a stale URL from a previous deployment or a different environment). This env var controls outbound voice status callback URL generation, but inbound SMS routing also depends on Twilio-side webhook configuration. Confirm in the Twilio console that the SMS webhook URL for the configured number points at this staging deployment's `/api/webhooks/twilio/sms-status` (or equivalent).
3. Use a known staging building with a safe test contact chain.
4. Trigger an emergency confirmation.
5. Confirm:
   - incident is created
   - first contact attempt is placed
   - due-processor cron route can be called successfully
   - structured logs are emitted

Exit criteria:

- At least one fail-closed branch is proven.
- If live emergency routing is in scope for the release, the live path is also smoke-tested successfully.

### Phase 6. Deployed Environment Wiring Review

Goal: verify that the deployed app is using the intended production-path dependencies rather than silent fallbacks.

Checks:

1. Confirm observability route success depends on `DATABASE_URL` being present.
2. Confirm the evaluator is using DB-backed metrics rather than a noop path.
3. Confirm emergency routing in staging uses real providers only when all Twilio envs are present.
4. Confirm the alert sink behavior matches env shape:
   - `SmsAlertSink` when ops phone numbers and Twilio creds are both present
   - `MisconfiguredAlertSink` when ops phone numbers are set but Twilio creds are missing
   - `NoopAlertSink` when ops numbers are intentionally absent

**False-positive risk:** If `OPS_ALERT_PHONE_NUMBERS` is absent, the factory selects `NoopAlertSink`, which silently discards all alerts. The evaluator will return `alertsEmitted` entries as if delivery succeeded, but no SMS is actually sent. An operator relying on Phase 4B results alone could conclude alert delivery is working when it is not. To claim alert-delivery readiness, `OPS_ALERT_PHONE_NUMBERS` **must** be set and pointing at a real test recipient, and the alert sink must be `SmsAlertSink`. If it is `NoopAlertSink`, alert delivery has not been validated regardless of evaluator output.

Evidence sources:

- route behavior
- structured logs
- direct env audit
- database state changes

Exit criteria:

- No silent fallback remains unexplained.

### Phase 7. Release Decision and Follow-up Actions

Classify the outcome immediately after execution.

#### Green: `clean_staging_validation`

Use when:

- cron auth passes
- observability evaluator passes
- cooldown behavior is validated
- emergency fail-closed behavior is validated
- no unexpected runtime defect appears

Follow-up:

- mark staging validation complete in the deployment note
- move to the next product-facing item, currently `S12-03` frontend handoff

#### Yellow: `config_issue`

Use when:

- behavior fails only because env vars, secrets, phone numbers, or flags are incorrect
- code paths behave as expected once the config branch is understood

Follow-up:

- fix env/config
- rerun only the affected checks
- do not open a code defect unless config correction still leaves a bad runtime result

#### Red: `runtime_defect`

Use when:

- the deployed code behaves incorrectly despite correct env setup
- auth, evaluator, cooldown, or fail-closed branches produce an unexpected result
- log and DB evidence point to an implementation problem rather than missing config

Follow-up:

1. stop broad validation
2. document exact failing check IDs
3. capture logs and DB state
4. open a focused remediation task before proceeding with release work

## Recommended Execution Order

1. Phase 0 - freeze target
2. Phase 1 - config audit
3. Phase 2 - basic reachability and health
4. Phase 3 - cron auth
5. Phase 4A - evaluator branch check
6. Phase 4B and 4C - seeded alert and cooldown
7. Phase 5 - emergency fail-closed
8. Phase 6 - deployed wiring review
9. Phase 7 - release decision

Run Phase 4D only in a disposable environment unless shared staging mutation is explicitly approved.

## Final Exit Criteria

This staging validation plan is complete only when all of the following are true:

1. The exact deployment under test is recorded.
2. Cron auth has been validated for both cron routes.
3. Observability evaluator branch behavior matches the actual env state.
4. At least one alert condition has been exercised in a controlled way.
5. Cooldown behavior has been validated with DB evidence.
6. Emergency routing fail-closed behavior has been validated.
7. Deployed env wiring has been reviewed and no silent fallback remains unexplained.
8. The outcome is classified as `clean_staging_validation`, `config_issue`, or `runtime_defect`.

## Recommended Immediate Next Step After This Plan

If the outcome is `clean_staging_validation`, move directly to the `S12-03` frontend handoff.

If the outcome is `config_issue` or `runtime_defect`, do not start new product work until the release gate is re-run and passes.
