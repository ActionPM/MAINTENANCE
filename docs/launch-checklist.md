# Launch Checklist

This is the canonical launch checklist for the Work Order Agent.

Use it for the first real tenant launch, the first pilot building launch, and any later go/no-go review where production-facing risk matters.

## Source Of Truth

- `docs/operational-readiness.md` for launch gates and operational hardening status
- `docs/spec-gap-tracker.md` for product/spec completeness
- `docs/bug-management.md` for bug severity and launch interaction rules
- `docs/bug-tracker.md` for the reviewed bug backlog
- `docs/security-boundaries.md` for trust zones and auth model
- `docs/retention-policy.md` for data lifecycle and PII handling
- `docs/emergency-escalation-runbook.md` for emergency routing behavior

## Stop Rules

- Do not launch if any `pre_launch` item in `docs/operational-readiness.md` is still `GAP`.
- Do not launch if any required smoke test fails.
- Do not launch if a `pre_launch` item is `ADEQUATE` without explicit named signoff.
- Do not launch with any open `P0` bug in `docs/bug-tracker.md`.
- Do not launch with an open `P1` bug unless the launch record includes explicit named acceptance.
- Do not launch if the deployed environment does not match the intended database, secret set, or building/test configuration.

## Current Baseline

These values should be re-checked at launch review time rather than trusted blindly.

- Spec tracker baseline:
  - `DONE`: 143
  - `PARTIAL`: 0
  - `MISSING`: 0
  - `INTENTIONAL_MVP`: 16
- Operational readiness baseline:
  - `DONE`: 8
  - `ADEQUATE`: 8
  - `GAP`: 3
  - `DEFERRED`: 5
- Current `pre_launch` state in `docs/operational-readiness.md`:
  - `OR-08` Migration automation: `ADEQUATE`
  - `OR-09` Dependency scanning: `DONE`
  - `OR-13` Security headers: `DONE`
- Tracker refresh:
  - `docs/spec-gap-tracker.md` last updated: `2026-03-27`
  - `docs/operational-readiness.md` last updated: `2026-03-27`

## 1. Repo And Tracker Gate

- [ ] `main` or the release branch is green on CI.
- [ ] The local working tree is clean before launch work starts.
- [ ] `docs/operational-readiness.md` is current for the release being launched.
- [ ] `docs/spec-gap-tracker.md` still shows no in-scope `PARTIAL` or `MISSING` rows.
- [ ] `docs/bug-tracker.md` has been reviewed for the launch decision.
- [ ] No open `P0` bug exists.
- [ ] Any open `P1` bug has explicit named acceptance recorded in the launch notes.
- [ ] Tracker metadata dates are refreshed if the repo state changed materially during launch prep.
- [ ] The launch PR updates tracker evidence in the same change as the code/config it depends on.

## 2. Code Gate

- [ ] Run local verification before final deploy or merge:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @wo-agent/web build
```

- [ ] If prompts, model wiring, taxonomy, schemas, or cue files changed, verify the eval gate passed.
- [ ] Confirm the launch target commit is the same commit that passed CI.

## 3. Pre-Launch Operational Gate

- [ ] Review every `pre_launch` row in `docs/operational-readiness.md`.
- [ ] Close every remaining `GAP`.
- [ ] Record explicit acceptance for every `ADEQUATE` `pre_launch` row.
- [ ] Re-check the current `OR-08` limitation:
  - migrations run from CI on push to `main`
  - Vercel deploy still runs in parallel
  - additive migrations are acceptable
  - no destructive migration is included in this launch
- [ ] Re-verify `OR-09` remains satisfied before launch:
  - Dependency Graph enabled in GitHub
  - Dependabot alerts enabled
  - Dependabot security updates enabled
  - workspace coverage remains confirmed

## 4. Environment And Secret Gate

- [ ] `DATABASE_URL` points to the intended Neon database and branch.
- [ ] Vercel production env vars are populated for the launch target.
- [ ] GitHub Actions secrets are populated for anything CI needs, including `DATABASE_URL` for the migration job.
- [ ] JWT secrets are set and production-grade.
- [ ] `ANTHROPIC_API_KEY` is set if live LLM calls are expected.
- [ ] `LLM_DEFAULT_MODEL` is set to the intended production model.
- [ ] `CRON_SECRET` is set and matches the deployed cron routes.
- [ ] Building/unit demo config does not accidentally point production traffic at placeholder data.

### Emergency Routing

Complete this block if emergency routing is enabled for launch.

- [ ] `EMERGENCY_ROUTING_ENABLED=true` only if Twilio and routing plans are actually ready.
- [ ] Twilio account SID, auth token, from numbers, and webhook base URL are all correct.
- [ ] `OPS_ALERT_PHONE_NUMBERS` is populated for observability alerts.
- [ ] Escalation plans in `packages/schemas/emergency_escalation_plans.json` match the building(s) being launched.
- [ ] The selected building/test tenant maps to a real building id in the escalation plans.

## 5. Migration Gate

- [ ] Review the pending migration set.
- [ ] Confirm the launch includes only additive migrations, or use a controlled change window if not.
- [ ] Confirm `pnpm --filter @wo-agent/db migrate` works against the target database before launch if there is any doubt.
- [ ] After push-to-main, verify the CI `migrate` job completed successfully.
- [ ] If the migration job fails, treat launch as blocked until the schema and runtime are back in sync.

## 6. Security And Compliance Gate

- [ ] Auth fail-closed behavior is intact in the deployed environment.
- [ ] Security headers are present on production responses.
- [ ] Ownership-scoped reads work for conversations, drafts, work orders, and record bundles.
- [ ] Rate limiting is enabled, even if still MVP-grade.
- [ ] `docs/security-boundaries.md` and `docs/retention-policy.md` still match the deployed behavior.

## 7. Functional Smoke Tests

Run these against the deployed environment, not only in local tests.

- [ ] Single-issue intake:
  - create conversation
  - select unit if required
  - submit initial message
  - answer follow-ups if needed
  - confirm submission
  - verify work order creation
- [ ] Multi-issue split flow:
  - submit a message with at least two issues
  - confirm split
  - verify one work order per finalized issue
- [ ] Draft/resume flow:
  - leave a conversation in a resumable state
  - verify it appears in drafts
  - resume and complete it
- [ ] Queued-text handoff:
  - submit a new issue during follow-ups or confirmation
  - finish the current intake
  - continue with the queued message in a new conversation
- [ ] Emergency confirmation:
  - trigger an emergency candidate issue
  - verify the tenant sees confirm/decline
  - verify enabled routing behaves correctly
  - verify disabled routing fails safe and does not silently escalate
- [ ] Notification flow:
  - confirm submission
  - verify expected notification event(s) and delivery behavior
- [ ] Health checks:
  - `GET /api/health`
  - `GET /api/health/db`
  - `GET /api/health/erp`
- [ ] Work-order read surfaces:
  - tenant can see only authorized work orders
  - unauthorized work-order lookup returns the correct rejection

## 8. Observability Gate

- [ ] Logs are accessible for the launch window.
- [ ] Request ids are visible in logs for route and orchestrator paths.
- [ ] Cron jobs are deployed and scheduled:
  - `/api/cron/observability/evaluate-alerts`
  - `/api/cron/emergency/process-due`
- [ ] Alert delivery path is tested or otherwise verified.
- [ ] A named person is on point for the first 24 hours after launch.

## 9. Go / No-Go Record

Record this explicitly for each launch decision.

- [ ] Launch owner named
- [ ] Technical approver named
- [ ] Operations approver named
- [ ] Decision timestamp recorded
- [ ] Launch scope recorded:
  - environment
  - building(s)
  - tenant cohort
  - feature flags
- [ ] Rollback path agreed before launch

## 10. First 24 Hours

- [ ] Review logs after the first real submissions.
- [ ] Review database readiness and migration status after deploy.
- [ ] Review notification delivery failures.
- [ ] Review emergency routing incidents, if any.
- [ ] Review alert output from the observability cron.
- [ ] Record findings in the launch note or update note.

## Recommended Launch Sequence

1. Close remaining `pre_launch` gaps.
2. Freeze the launch commit.
3. Run local verification.
4. Verify environment and secrets.
5. Deploy or merge.
6. Confirm migration success.
7. Run deployed smoke tests.
8. Record go/no-go.
9. Monitor the first 24 hours.
