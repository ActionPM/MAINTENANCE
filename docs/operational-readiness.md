# Operational Readiness Tracker

Track deploy, infrastructure, performance, and runtime hardening concerns here. Product logic, state machine correctness, and data integrity contracts belong in `docs/spec-gap-tracker.md`. If a gap is a spec contract violation, it goes there. If it is about running the application safely in production, it goes here.

## Review Rule

Update this document:

- In the same PR as any code change that affects infrastructure, deployment, performance, or runtime security.
- Before any launch or no-launch decision. Walk every `pre_launch` row; confirm statuses are current.
- Before any scale-up milestone. Walk every `pre_scale` row the same way.

If a row's status, evidence, or limitation has changed and this document was not updated in the same PR, that is a process failure.

## Metadata

| Field             | Value                                        |
| ----------------- | -------------------------------------------- |
| Tracker owner     | ActionPM                                     |
| Last updated      | 2026-03-17                                   |
| Deployment target | Vercel (serverless) + Neon Postgres (pooled) |

## Related Documents

| Document                      | Scope                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| `docs/spec.md`                | Product logic, state machine, data integrity, LLM contracts |
| `docs/spec-gap-tracker.md`    | Compliance of code against spec requirements                |
| **This document**             | Deploy, infra, performance, security hardening              |
| `docs/security-boundaries.md` | Trust zones and auth model (overlaps on security items)     |
| `docs/retention-policy.md`    | Data lifecycle (overlaps on storage items)                  |

## Status Definitions

| Status     | Meaning                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DONE`     | Implemented, verified, and adequate for any foreseeable scale on the current deployment target.                                                                                     |
| `ADEQUATE` | Implemented with a known limitation that is acceptable for launch but **not acceptable at scale**. The limitation and the scale threshold at which it breaks are stated in the row. |
| `GAP`      | Not implemented. Required before the milestone indicated in the row.                                                                                                                |
| `DEFERRED` | Intentionally deferred with documented rationale. Acceptable risk at current stage; revisit at stated trigger.                                                                      |

## Gating Semantics

- Any `pre_launch` row with status `GAP` means **not launch-ready**. The gap must be closed or the row must be reclassified with justification before a launch decision.
- Any `pre_launch` row with status `ADEQUATE` requires **explicit signoff** — you are accepting a known limitation into production. Record who accepted it and when in the row.
- `DEFERRED` is only valid if its "Trigger to revisit" is concrete and falsifiable (e.g., ">10 concurrent buildings" or "second production operator onboarded"), not aspirational (e.g., "when we have time" or "post-launch").
- The same rules apply to `pre_scale` rows when a scale-up milestone is being evaluated.

## Summary Dashboard

| Status     | Count  |
| ---------- | ------ |
| `DONE`     | 7      |
| `ADEQUATE` | 8      |
| `GAP`      | 4      |
| `DEFERRED` | 5      |
| **Total**  | **24** |

---

## Data Integrity

### OR-01: Idempotency reserve + WO creation atomicity

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P1          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** Idempotency uses a two-phase reserve-then-complete protocol. In Postgres (`pg-idempotency-store.ts`), `tryReserve()` does an atomic `INSERT ON CONFLICT` and `complete()` does a guarded `UPDATE WHERE completed = false`. Work order batch insertion (`pg-wo-store.ts`) uses `BEGIN`/`COMMIT`/`ROLLBACK`.

**Limitation:** The reserve, WO insert, and idempotency complete are three separate database operations, not wrapped in a single transaction. If the process crashes after WO insertion but before idempotency complete, a retry will see an incomplete reservation (`completed = false`) and re-insert work orders.

**Scale threshold:** Any deployment where function crashes or timeouts are non-negligible (sustained >100 WOs/day or multi-region).

**Next action:** Wrap reserve, insert, and complete in a single Postgres transaction in the confirm-submission handler. Target files: `packages/core/src/orchestrator/action-handlers/confirm-submission.ts`, `packages/db/src/repos/pg-idempotency-store.ts`.

---

### OR-02: Session concurrent write protection

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** `pg-session-store.ts` uses `INSERT ... ON CONFLICT DO UPDATE` (last-write-wins). No `row_version` or CAS check.

**Accepted deviation:** Spec §18 (MVP decision 2026-03-11) explicitly allows dispatcher-mediated last-write-wins as long as session writes stay behind the orchestrator boundary. Documented in spec and tracker (S18-05).

**Limitation:** Two concurrent requests for the same conversation can clobber each other's state. Currently mitigated by the dispatcher being the sole write path.

**Scale threshold:** Any scenario where concurrent requests per conversation become likely (double-tap on slow connections, multiple browser tabs, or session writes from outside the dispatcher).

**Next action:** Add `row_version` column to `sessions` table (new migration) and CAS check in `pg-session-store.ts:save()`.

---

## Database Performance

### OR-03: Query timeouts

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** `packages/db/src/pool.ts` configures `statement_timeout` as a Postgres session parameter via the `options` connection string. Default timeout is 5 000 ms. All 8 Postgres repo stores receive the pool via DI and inherit the timeout automatically. Migration runner uses a longer timeout (30 000 ms) for DDL operations. `PoolOptions` interface and `DEFAULT_POOL_OPTIONS` are exported from `@wo-agent/db` for consumers that need custom values.

**Evidence:** `pool.test.ts` asserts default, custom, and zero-timeout configurations. `migrate-timeout.test.ts` asserts the 30s migration timeout.

---

### OR-04: Session query indexing

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `GAP`       |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** `pg-session-store.ts:16` runs `SELECT ... WHERE tenant_user_id = $1 ORDER BY last_activity_at DESC`. No index exists on `(tenant_user_id, last_activity_at)`. Migrations `001` through `010` have no index on `sessions` beyond the primary key.

**Risk:** Full table scan. Fine with <1K sessions; degrades linearly after that.

**Next action:** Add migration with composite index on `sessions(tenant_user_id, last_activity_at DESC)`.

---

### OR-05: Event query pagination

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `GAP`       |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** `EventStore.query()` returns all matching events in memory. A conversation with 200+ events loads them all into a single response.

**Risk:** Memory pressure on long-lived conversations. Unlikely at MVP (<50 events typical) but possible for complex multi-issue intakes with retries.

**Next action:** Add `limit` and `cursor` parameters to the `EventStore` interface in `packages/core/src/events/types.ts` and implement in `packages/db/src/repos/pg-event-store.ts`.

---

### OR-06: Connection pool configuration

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** `packages/db/src/pool.ts:12` creates a Neon pool with `connectionString` only. No explicit `max`, `idleTimeoutMillis`, or `connectionTimeoutMillis`. Neon's serverless driver auto-manages WebSocket connections and is designed for short-lived invocations.

**Limitation:** No pool `max` is set. Under sustained load, total connections across all Vercel instances could exceed Neon's per-project connection limit (300 Pro, 100 Free).

**Scale threshold:** ~50 concurrent Vercel invocations with default pool size of 10 each.

**Next action:** Add explicit `max`, `idleTimeoutMillis`, and `connectionTimeoutMillis` to pool creation in `packages/db/src/pool.ts`.

---

## Deployment Pipeline

### OR-07: CI quality gates

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** `.github/workflows/ci.yml` runs lint, format check, typecheck, test, and build-web on every PR and push to `main`. Concurrency group cancels in-progress runs. Node 22, pnpm 10, `--frozen-lockfile`.

---

### OR-08: Migration automation

| Field             | Value        |
| ----------------- | ------------ |
| **Status**        | `ADEQUATE`   |
| **Priority**      | P1           |
| **Launch gate**   | `pre_launch` |
| **Owner**         | ActionPM     |
| **Last verified** | 2026-03-17   |

**Current state:** Migrations run via a `migrate` job in `.github/workflows/ci.yml` on push to `main`, after all CI jobs pass (`needs: [lint, typecheck, build-web, test]`). Uses `DATABASE_URL` from GitHub secrets. Fails if secret is not configured (fail-closed). Preview deploys do not trigger migrations.

**Limitation:** Vercel's native GitHub integration deploys in parallel with CI. The migrate job does not block deploy. For additive migrations (new tables/columns), this is safe — old code doesn't reference new schema objects. For destructive migrations, the operator must coordinate manually.

**Scale threshold:** Any migration that modifies existing columns or removes objects needed by the currently-deployed code.

**Next action:** Switch to `workflow_run`-triggered deploy workflow (`ci-cd-pipeline.md` Task 3.2/3.3) to achieve migrate-then-deploy ordering. This also eliminates the `DATABASE_URL` dual-source-of-truth concern (GitHub secrets + Vercel env vars).

**Accepted by:** ActionPM, 2026-03-17. Rationale: all current migrations are additive (new tables/columns only); deploy-before-migrate does not break running code. Path to DONE documented.

---

### OR-09: Dependency scanning

| Field             | Value        |
| ----------------- | ------------ |
| **Status**        | `GAP`        |
| **Priority**      | P2           |
| **Launch gate**   | `pre_launch` |
| **Owner**         | ActionPM     |
| **Last verified** | 2026-03-17   |

**Current state:** `.github/dependabot.yml` added with two ecosystems: npm (weekly version updates, minor/patch grouped) and github-actions (weekly). Root `directory: /` — assumes Dependabot reads the root `pnpm-lock.yaml` and discovers workspace packages.

**Remaining to verify:** (a) After first Dependabot run, confirm workspace packages (apps/web, packages/core, packages/db, packages/schemas, packages/evals, packages/adapters/mock) are covered — if not, add explicit `directory` entries. (b) Dependency graph, Dependabot alerts, and Dependabot security updates are enabled in GitHub repo settings (`Settings > Code security`).

**Next action:** After merge: (a) Enable Dependency graph + Dependabot alerts + Dependabot security updates in repo settings if not already enabled. (b) After first Dependabot run, confirm workspace package coverage. Promote to `DONE` once both verified.

---

### OR-10: Staging environment

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | `DEFERRED`    |
| **Priority**      | P3            |
| **Launch gate**   | `post_launch` |
| **Owner**         | ActionPM      |
| **Last verified** | 2026-03-17    |

**Current state:** No staging environment. Vercel preview deployments exist per-PR but share production env vars if configured. No `VERCEL_ENV`-based config switching.

**Rationale:** At MVP scale with a single operator, preview deploys are sufficient. Dedicated staging with its own Neon branch is not justified yet.

**Trigger to revisit:** Scaling beyond single-operator or onboarding a second production building.

---

## Security Hardening

### OR-11: Authentication fail-closed

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** `apps/web/src/middleware/auth.ts` returns 401 if JWT secrets are unset. JWT validation uses `jose` 6. Tenant isolation enforced at dispatcher level.

---

### OR-12: Rate limiter durability

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P1          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** `apps/web/src/middleware/rate-limiter.ts` uses an in-memory `Map`. Code comment on line 8 acknowledges this is MVP-only. Rate limit violations are logged as structured security events.

**Limitation:** In Vercel serverless, the map resets on cold starts and is not shared across instances. Rate limiting is per-instance, not per-user globally. Additionally, the `windows` Map is never pruned — expired entries accumulate within a warm instance.

**Scale threshold:** Any scenario requiring effective abuse protection across multiple concurrent Vercel instances.

**Next action:** Replace with Postgres-backed rate limiter in `apps/web/src/middleware/rate-limiter.ts`. Add cleanup of expired windows.

---

### OR-13: Security headers

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** `apps/web/next.config.ts` includes an `async headers()` function returning a catch-all route (`/:path*`) with 5 security headers: Strict-Transport-Security (HSTS with preload), X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy (strict-origin-when-cross-origin), and Permissions-Policy (deny camera/microphone/geolocation).

**Evidence:** `apps/web/src/__tests__/security-headers.test.ts` validates the config exports a `headers` function and asserts all 5 header keys and values.

**Note:** Content-Security-Policy is tracked separately as OR-24 (`DEFERRED`, `post_launch`) — requires nonce propagation for Next.js inline scripts/styles.

---

### OR-14: SQL injection prevention

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** All Postgres repos use parameterized queries (`$1, $2, ...`). No string concatenation in SQL across all files in `packages/db/src/repos/`.

---

### OR-15: Cron endpoint authentication

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P3          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** Cron routes validate `Authorization: Bearer <CRON_SECRET>`. Vercel injects `CRON_SECRET` automatically for configured cron jobs.

**Limitation:** Secret comparison uses `!==` (not timing-safe). Low risk — cron secrets are less valuable than access tokens and the attack surface is narrow (Vercel-internal).

**Scale threshold:** N/A for risk; consistency concern only.

**Next action:** Switch to `crypto.timingSafeEqual()` in cron route handlers for consistency with Twilio webhook validation pattern.

---

## Observability

### OR-16: Structured logging

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** `StdoutJsonLogger` writes structured JSON to stdout across all routes, dispatcher, LLM adapters, and escalation coordinator. Fields: `component`, `event`, `request_id`, `severity`, `timestamp`. Request correlation via UUID `request_id` in `apps/web/src/middleware/request-context.ts`.

---

### OR-17: Health check endpoints

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** Three health endpoints, all truthful:

- `/api/health` — liveness-only. Returns `{ status: 'ok', kind: 'liveness', timestamp }`. No dependency claims. Suitable for load balancer and uptime monitor.
- `/api/health/db` — database readiness check. Runs `SELECT 1` via a fresh pool. Returns 200 `ok` with `latency_ms`, 503 `misconfigured` when `DATABASE_URL` is unset, or 503 `unavailable` on connection failure.
- `/api/health/erp` — ERP adapter health check. Calls `adapter.healthCheck()` and returns 200/503 based on real result.

No stubs remain — all responses are truthful.

**Limitation:** LLM, notification, and storage probes are intentionally absent. Degradation of those dependencies is detected by existing observability (S25-01 structured logs, S25-02 metrics, S25-04 alerts) rather than health endpoints.

**Scale threshold:** Add dependency-specific health probes when those services expose a cheap, side-effect-free ping (e.g., Anthropic health/models endpoint, Twilio credential validation).

**Next action:** Add `/api/health/llm` when Anthropic SDK supports a health endpoint. Add `/api/health/notifications` when notification service has a real health interface.

---

### OR-18: Distributed tracing

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | `DEFERRED`    |
| **Priority**      | P3            |
| **Launch gate**   | `post_launch` |
| **Owner**         | ActionPM      |
| **Last verified** | 2026-03-17    |

**Current state:** `request_id` is generated per-request and propagated through the application but not sent as a header to external services. No W3C Trace Context.

**Rationale:** Single-service architecture. Local `request_id` correlation in structured logs is sufficient at MVP scale.

**Trigger to revisit:** Integrating with external services beyond Anthropic/Neon, or debugging latency across service boundaries.

---

### OR-19: Error aggregation service

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | `DEFERRED`    |
| **Priority**      | P3            |
| **Launch gate**   | `post_launch` |
| **Owner**         | ActionPM      |
| **Last verified** | 2026-03-17    |

**Current state:** Errors logged to stdout as structured JSON. No Sentry or equivalent. Alert evaluator detects metric spikes via cron but does not aggregate individual errors.

**Rationale:** This is an operational deferral, not a spec deferral. With a single operator and low expected volume, structured Vercel logs plus the alert evaluator provide enough visibility to run the pilot without a dedicated third-party error aggregation service.

**Trigger to revisit:** Error volume exceeding what Vercel log tailing and cron-based evaluation can surface.

---

## Testing

### OR-20: E2E tests against real database

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `GAP`       |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** All tests use in-memory stubs. CI sets `DATABASE_URL=''`. No test suite validates Postgres repos against a real database.

**Risk:** Schema mismatches, JSONB serialization edge cases, and connection handling issues are not caught until production. The `pg-event-store.ts` type guards (duck-typing on payload fields) have never been validated against actual Postgres JSONB storage.

**Next action:** Add a CI job in `.github/workflows/ci.yml` that runs `packages/db` integration tests against a PostgreSQL service container.

---

### OR-21: Performance / load testing

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | `DEFERRED`    |
| **Priority**      | P3            |
| **Launch gate**   | `post_launch` |
| **Owner**         | ActionPM      |
| **Last verified** | 2026-03-17    |

**Current state:** No load tests, latency benchmarks, or throughput measurements.

**Rationale:** MVP traffic expected <100 conversations/day. Vercel autoscaling handles burst capacity.

**Trigger to revisit:** Onboarding >10 concurrent buildings or committing to SLA targets.

---

## Environment Configuration

### OR-22: Environment variable validation

| Field             | Value       |
| ----------------- | ----------- |
| **Status**        | `ADEQUATE`  |
| **Priority**      | P2          |
| **Launch gate**   | `pre_scale` |
| **Owner**         | ActionPM    |
| **Last verified** | 2026-03-17  |

**Current state:** `.env.example` documents all variables. JWT secrets checked for presence in `apps/web/src/middleware/auth.ts` (fail-closed). Twilio credentials checked for presence in `apps/web/src/lib/orchestrator-factory.ts`. Emergency routing gated by feature flag.

**Limitation:** No validation of format, length, or type. A typo in `TWILIO_ACCOUNT_SID` won't be caught until the first SMS send. JWT secrets are not checked for minimum length.

**Scale threshold:** Any deployment where misconfiguration cannot be caught by a single operator testing manually after deploy.

**Next action:** Add a startup validation module in `apps/web/src/lib/` that checks env var format and minimum length on first request.

---

### OR-23: Append-only database triggers

| Field             | Value      |
| ----------------- | ---------- |
| **Status**        | `DONE`     |
| **Priority**      | —          |
| **Launch gate**   | —          |
| **Owner**         | ActionPM   |
| **Last verified** | 2026-03-17 |

**Current state:** Migration `001-conversation-events.sql` creates a `prevent_mutation()` trigger blocking UPDATE and DELETE on event tables at the database level. Enforces spec §7 independently of application code.

---

### OR-24: Content-Security-Policy

| Field             | Value         |
| ----------------- | ------------- |
| **Status**        | `DEFERRED`    |
| **Priority**      | P3            |
| **Launch gate**   | `post_launch` |
| **Owner**         | ActionPM      |
| **Last verified** | 2026-03-17    |

**Current state:** No CSP header configured. The app serves a tenant-facing HTML page (`page.tsx` with `ChatShell` component) and root layout. Next.js inline scripts/styles require nonce propagation for a functional CSP policy.

**Rationale:** CSP with nonce propagation is a non-trivial Next.js change. The app renders tenant/agent message content via `chat-shell.tsx` and `chat-message.tsx` as plain text in React components (not raw HTML injection). Risk escalates if rich rendering or third-party scripts are added.

**Trigger to revisit:** Before introducing rich HTML/Markdown rendering, `dangerouslySetInnerHTML`, third-party scripts, or broader public-facing HTML surface.

---

## Launch Gate Summary

### `pre_launch` — Required before first real tenant

| ID    | Item                 | Status     | Priority |
| ----- | -------------------- | ---------- | -------- |
| OR-08 | Migration automation | `ADEQUATE` | P1       |
| OR-09 | Dependency scanning  | `GAP`      | P2       |
| OR-13 | Security headers     | `DONE`     | —        |

### `pre_scale` — Required before >10 buildings or >100 WOs/day

| ID    | Item                         | Status     | Priority |
| ----- | ---------------------------- | ---------- | -------- |
| OR-01 | Idempotency transactionality | `ADEQUATE` | P1       |
| OR-12 | Rate limiter durability      | `ADEQUATE` | P1       |
| OR-02 | Session optimistic locking   | `ADEQUATE` | P2       |
| OR-04 | Session query indexing       | `GAP`      | P2       |
| OR-05 | Event query pagination       | `GAP`      | P2       |
| OR-06 | Pool configuration           | `ADEQUATE` | P2       |
| OR-15 | Cron timing-safe comparison  | `ADEQUATE` | P3       |
| OR-17 | Health check endpoints       | `ADEQUATE` | P2       |
| OR-20 | E2E database tests           | `GAP`      | P2       |
| OR-22 | Env variable validation      | `ADEQUATE` | P2       |

### `post_launch` — Follow-up hardening

| ID    | Item                    | Status     | Priority |
| ----- | ----------------------- | ---------- | -------- |
| OR-10 | Staging environment     | `DEFERRED` | P3       |
| OR-18 | Distributed tracing     | `DEFERRED` | P3       |
| OR-19 | Error aggregation       | `DEFERRED` | P3       |
| OR-21 | Performance testing     | `DEFERRED` | P3       |
| OR-24 | Content-Security-Policy | `DEFERRED` | P3       |

---

## Pre-Launch Smoke Tests

Manual smoke tests to run on the deployed environment before a launch decision. Record outcomes in the PR description or this section.

### 1. Queued-text handoff

- Submit a conversation that reaches `submitted` state with `queued_messages` present.
- Trigger "Continue with new issue" flow.
- Verify the new conversation starts correctly and can be submitted to completion.
- **Pass criteria:** Both conversations reach `submitted` state. Second conversation correctly inherits tenant context.

### 2. Emergency confirmation

- Submit a message that triggers emergency classification (e.g., "gas leak in unit 4B").
- Verify emergency escalation path activates correctly in the deployed environment.
- Check config-sensitive behavior: `EMERGENCY_ROUTING_ENABLED` feature flag, Twilio credentials for voice/SMS escalation.
- **Pass criteria:** Emergency routing fires when enabled. When disabled, conversation proceeds to normal confirmation with risk flag visible.

### 3. Health endpoint verification

- `GET /api/health` — expect 200 with `{ status: 'ok', kind: 'liveness', timestamp }`.
- `GET /api/health/db` — expect 200 with `{ status: 'ok', kind: 'readiness', dependency: 'database', latency_ms }` when `DATABASE_URL` is configured.
- `GET /api/health/erp` — expect 200 with `{ healthy: true }` or 503 with `{ healthy: false }` depending on ERP adapter state.
- **Pass criteria:** All responses match their documented contracts. No stubs. No false positives.
