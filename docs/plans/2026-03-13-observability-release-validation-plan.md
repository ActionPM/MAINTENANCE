# Observability Release Validation Plan

**Date:** 2026-03-13

## Review of 2026-03-12 Update

The March 12 update is consistent with the current repo state.

- `docs/spec-gap-tracker.md` already marks `S25-01`, `S25-02`, and `S25-04` as `DONE` as of `2026-03-12`, and the summary now describes observability as fully implemented.
- The staging/runtime wiring called out in the update is present in the real app path:
  - `apps/web/src/app/api/cron/observability/evaluate-alerts/route.ts` enforces `CRON_SECRET`, checks `OBSERVABILITY_ALERTS_ENABLED`, and runs the alert evaluator.
  - `apps/web/src/lib/orchestrator-factory.ts` wires the live alert sink, misconfiguration behavior, metrics query store, and cooldown store for the cron path.
  - `packages/core/src/llm/with-observed-llm-call.ts` threads `request_id` into `llm_call_*` logs and metrics.
- The one remaining tracker item above routine `P2` cleanup is `S07-05`: production persistence still weakens classification-event audit fidelity by dropping explicit top-level `issue_id` structure in the Postgres path.

One caveat: I did not re-run the full repo test matrix this morning, so the package-by-package pass counts in the update should be treated as reported status, not freshly re-verified status.

## Goal for This Morning

Close the gap between "release-ready in code" and "ready to ship with confidence in staging," then move directly into the remaining `P1` item if staging checks are clean.

## Morning Execution Order

### 1. Deployment config audit

Timebox: 20-30 minutes.

- Verify staging has the expected env vars for observability and emergency paths:
  - `CRON_SECRET`
  - `DATABASE_URL`
  - `OBSERVABILITY_ALERTS_ENABLED`
  - `OPS_ALERT_PHONE_NUMBERS`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER`
  - `EMERGENCY_ROUTING_ENABLED`
  - `EMERGENCY_INTERNAL_ALERT_NUMBER`
- Confirm the intended kill-switch state in staging before running smokes:
  - Observability alerts enabled when testing alert evaluation
  - Emergency routing enabled only if the Twilio-backed emergency path is part of the staging check
- Confirm the Vercel cron config and the deployed secret align for:
  - `/api/cron/observability/evaluate-alerts`
  - `/api/cron/emergency/process-due`

Exit criteria: no missing-secret surprises and no ambiguity about whether failures are code, config, or disabled features.

### 2. Staging smoke: observability alert path

Timebox: 30-45 minutes.

- Hit `GET /api/cron/observability/evaluate-alerts` in staging with `Authorization: Bearer ${CRON_SECRET}`.
- Confirm the route behavior matches the expected branch:
  - `401` when auth is wrong
  - `500` when required evaluator dependencies are missing, specifically when `DATABASE_URL` or the queryable metrics store path is unavailable and `getAlertEvaluatorDeps()` returns null
  - success payload when dependencies are available
  - `skipped: true` only when the kill switch is intentionally off
- Exercise at least one alertable condition in a controlled way and verify:
  - evaluator result shows `alertsEmitted`, `alertsSuppressed`, or `alertsFailed` accurately
  - staging logs show the corresponding structured records
  - SMS delivery reaches the ops/test number when Twilio is configured
- Verify failed delivery does not create cooldown suppression:
  - inspect `alert_cooldowns` after a forced delivery failure
  - re-run the evaluator and confirm the alert is attempted again on the next cycle
- If this smoke reveals an unexpected runtime defect rather than a missing-config condition:
  - capture it as a blocking issue
  - skip Steps 3 and 4
  - proceed directly to Step 5 to record the defect state before attempting a fix

Exit criteria: the cron path is authenticated, observable, and retries correctly on delivery failure.

### 3. Staging smoke: emergency/internal alert path

Timebox: 30-45 minutes.

- Use the staging emergency flow or a seeded due incident to exercise `/api/cron/emergency/process-due`.
- Confirm the internal alert path still works when exhaustion is reached:
  - escalation logs remain structured
  - internal alert behavior is visible in runtime logs/events
  - additive alert-sink behavior does not suppress the existing direct safety path
- Verify any alert-related feature flags do not silently blackhole alerts.

Exit criteria: emergency exhaustion still alerts operators in staging, and the observability additions did not weaken the original safety path.

### 4. Local guardrail closeout

Timebox: 20-30 minutes.

- Add one focused assertion in `packages/core/src/__tests__/integration/observability-e2e.test.ts` that ties the dispatcher-scoped `request_id` to downstream `llm_call_*` observability records.
- Prefer asserting against actual emitted log entries, with metrics as a secondary check if needed.
- Re-run the targeted observability test slice after the assertion is added.

Exit criteria: local coverage proves the exact cross-hop correlation claim, not just adjacent pieces of it.

### 5. Status language and handoff

Timebox: 10-15 minutes.

- Update `docs/spec-gap-tracker.md` only if staging findings materially change the claimed readiness.
- Since there is no separate release-notes artifact in the repo today, capture any release-status wording in the tracker update or deployment note instead of creating a new ad hoc document.
- Record the staging result in the same language used for standup:
  - clean staging validation
  - config issue found
  - runtime defect found

Exit criteria: the repo status language matches reality and does not over-claim before staging is checked.

### 6. Pivot immediately if staging is clean

Use the remaining morning time on `S07-05`, the last `P1` gap.

- Inspect `packages/db/src/repos/pg-event-store.ts` and fix the current production-path bug precisely:
  - `ClassificationEvent` is missing from the `AnyEvent` union
  - classification events therefore fall through to `insertMinimalEvent()`
  - `issue_id` is preserved only inside generic payload JSON instead of as a discrete queryable classification-domain field
- Add repository coverage proving `issue_id` survives persisted classification events.
- Update `docs/spec-gap-tracker.md` in the same change if the production path is fixed.

Exit criteria: observability is no longer the active release item; classification-event audit fidelity becomes the next top-of-stack implementation task.

## Success Criteria for the Morning

- Staging cron auth and feature-flag behavior are verified against the real deployment.
- Twilio-backed ops alert delivery is confirmed, or a concrete config defect is isolated.
- Cooldown behavior is verified against real Postgres-backed state.
- The missing end-to-end `request_id` assertion is added locally.
- If staging is clean, `S07-05` becomes the active implementation focus before noon.
