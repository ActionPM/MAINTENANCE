# Plan: Make /api/health Honest

**Date:** 2026-03-17
**Branch:** `fix/honest-health-endpoints`
**Goal:** Replace the dishonest stub-based health endpoint with a liveness-only root and real dependency checks as sub-routes.

---

## Current State

`/api/health/route.ts` returns `{ status: 'ok', services: { db: 'stub', llm: 'stub', storage: 'stub', notifications: 'stub' } }`. Every service field is a literal `'stub'` string — the endpoint lies. An operator checking health gets a green signal regardless of actual system state.

`/api/health/erp/route.ts` is honest — it calls `adapter.healthCheck()` and returns 200/503 based on the real result.

The spec (`docs/spec.md` §25) requires `/health` as the MVP surface. Sub-routes (`/health/db`, `/health/llm`, etc.) are explicitly optional.

The spec-gap-tracker (`S25-03`) marks this as `DONE` based on route existence alone. The operational-readiness tracker (`OR-17`) correctly identifies the stubs as a `GAP` and a pre-launch blocker.

---

## Design Decisions

1. **Root = liveness only.** `/api/health` answers "is the process alive and serving HTTP?" — nothing more. No dependency checks. This is the thing load balancers and uptime monitors hit.

2. **Sub-routes = readiness checks.** Each sub-route checks one real dependency and reports honest status. Only add a sub-route when it can report real states (`ok`, `unavailable`, `misconfigured`), never placeholders.

3. **Add `/api/health/db` now.** The DB is the only dependency where we can run a real check today (`SELECT 1` via the pool). If `DATABASE_URL` is unset: return `{ status: 'misconfigured' }` with **503**. Missing `DATABASE_URL` is only an intentional fallback inside `orchestrator-factory.ts` for local dev with in-memory stores — but a readiness probe should not report "ready" when the database it's supposed to check doesn't exist. A 503 `misconfigured` is honest: "this dependency is not available." Local dev doesn't hit `/api/health/db`; deployed environments need the alarm.

4. **Do NOT add `/api/health/llm` or `/api/health/notifications` yet.** Neither has a cheap, side-effect-free ping today. Adding them would just recreate the stub problem.

5. **Keep `/api/health/erp` as-is.** It's already honest.

---

## Batches

### Batch 1 — Simplify root health route (liveness-only)

| # | Task | File(s) | What changes |
|---|------|---------|--------------|
| 1.1 | Rewrite root health to liveness-only | `apps/web/src/app/api/health/route.ts` | Remove `services` object. Return `{ status: 'ok', kind: 'liveness', timestamp }`. Keep `withObservedRoute` wrapper. |
| 1.2 | Add unit test for liveness route | `apps/web/src/app/api/health/__tests__/health-route.test.ts` | Verify 200 response, payload shape (`status`, `kind`, `timestamp`), no `services` field. |

**Review checkpoint:** Confirm liveness payload is minimal and contains no dependency claims.

---

### Batch 2 — Add /api/health/db readiness check

| # | Task | File(s) | What changes |
|---|------|---------|--------------|
| 2.1 | Create DB health check route | `apps/web/src/app/api/health/db/route.ts` | New route. If `DATABASE_URL` is set: lazy-import `@wo-agent/db`, create pool, run `SELECT 1`, return `{ status: 'ok', kind: 'readiness', dependency: 'database', latency_ms }` (200) or `{ status: 'unavailable', kind: 'readiness', dependency: 'database', error }` (503). If `DATABASE_URL` is unset: return `{ status: 'misconfigured', kind: 'readiness', dependency: 'database' }` (**503**) — missing DB config is a deployment error, not a healthy state. Wrap with `withObservedRoute('health:db', ...)`. |
| 2.2 | Add unit test for DB health route | `apps/web/src/app/api/health/db/__tests__/health-db-route.test.ts` | Test three cases: (a) `DATABASE_URL` unset → 503 `misconfigured`, (b) pool query succeeds → 200 `ok` with `latency_ms`, (c) pool query throws → 503 `unavailable` with error message. Mock `@wo-agent/db` imports. |

**Review checkpoint:** Confirm the route uses lazy imports (same pattern as `orchestrator-factory.ts`), doesn't hold the pool open, and handles all three states. Verify `misconfigured` returns 503, not 200.

---

### Batch 3 — Update trackers

| # | Task | File(s) | What changes |
|---|------|---------|--------------|
| 3.1 | Update spec-gap-tracker S25-03 | `docs/spec-gap-tracker.md` | Update evidence for `S25-03` to state: "Root `/health` is a liveness-only endpoint (no dependency checks). `/health/erp` provides a real adapter health check. `/health/db` provides a real database readiness check. Sub-routes for LLM, storage, and notifications are intentionally omitted — they will be added only when they can report real states." Keep status `DONE` (the spec only requires `/health` to exist; sub-routes are optional). Update `Last Verified` date. |
| 3.2 | Update operational-readiness OR-17 | `docs/operational-readiness.md` | Change OR-17 status from `GAP` to `ADEQUATE`. Narrow the row scope to what health endpoints actually cover: liveness probe (`/health`), database readiness (`/health/db`), ERP adapter (`/health/erp`). No stubs remain — all responses are truthful. **Limitation:** LLM, notification, and storage probes are intentionally absent; degradation of those dependencies is detected by existing observability (S25-01 structured logs, S25-02 metrics, S25-04 alerts) rather than health endpoints. **Scale threshold:** add dependency-specific health probes when those services expose a cheap side-effect-free ping. Update dashboard counts: `ADEQUATE` 6→7, `GAP` 8→7. Move OR-17 from the `pre_launch` GAP table to the `pre_scale` ADEQUATE table in the launch gate summaries. |
| 3.3 | Add smoke test plan to operational-readiness | `docs/operational-readiness.md` | Add a new section **"Pre-Launch Smoke Tests"** at the end, documenting the manual smoke tests to run before launch decision: (1) **Queued-text handoff:** submitted conversation with `queued_messages` → "Continue with new issue" → new conversation starts and submits correctly. (2) **Emergency confirmation:** confirm emergency path behaves correctly in the intended environment, including config-sensitive behavior (`EMERGENCY_ROUTING_ENABLED`, Twilio creds). (3) **Health endpoint verification:** hit `/api/health`, `/api/health/db`, `/api/health/erp` on the deployed environment and confirm responses match contract. Record outcomes in this section or the PR description. |

**Review checkpoint:** Verify tracker counts are consistent, evidence text is honest, and smoke test plan is actionable.

---

### Batch 4 — CI validation

| # | Task | Action |
|---|------|--------|
| 4.1 | Run `pnpm lint` | Ensure no lint errors in new/modified files |
| 4.2 | Run `pnpm typecheck` | Ensure type safety across all packages |
| 4.3 | Run `pnpm test` | Ensure all tests pass including new health route tests |
| 4.4 | Run `pnpm --filter @wo-agent/web build` | Ensure Next.js build succeeds |

---

## Out of Scope

- `/api/health/llm` — no side-effect-free ping available; add only when Anthropic SDK supports a health/models endpoint or we have a cached status
- `/api/health/notifications` — Twilio credential validation is possible but would require importing Twilio SDK just for health; defer until notification service has a real health interface
- `/api/health/storage` — no storage service exists yet
- Staging deployment and live smoke test execution — documented as a plan, not executed in this PR
- Canary/gradual rollout — deferred per spec

## Risks

| Risk | Mitigation |
|------|-----------|
| DB health check holds connection from pool | Use a fresh pool or close after check; Neon serverless driver handles short-lived connections well |
| DB health check adds latency to monitoring | It's a sub-route, not on the liveness path; monitors choose which endpoints to hit |
| Removing stub fields breaks a consumer | No known consumers of the stub fields; they were never truthful |

## Files Changed (Summary)

| File | Action |
|------|--------|
| `apps/web/src/app/api/health/route.ts` | Modify — liveness-only |
| `apps/web/src/app/api/health/__tests__/health-route.test.ts` | Create — liveness test |
| `apps/web/src/app/api/health/db/route.ts` | Create — DB readiness check |
| `apps/web/src/app/api/health/db/__tests__/health-db-route.test.ts` | Create — DB readiness test |
| `apps/web/src/app/api/health/erp/route.ts` | No change — already honest |
| `docs/spec-gap-tracker.md` | Modify — S25-03 evidence |
| `docs/operational-readiness.md` | Modify — OR-17 status + smoke test plan |
