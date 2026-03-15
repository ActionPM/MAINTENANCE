# Resolve Staging Gate Blockers

**Date:** 2026-03-15
**Blocks:** `clean_staging_validation` release decision from `2026-03-15-staging-release-readiness-validation.md`

## Problem Statement

Two items remain unresolved from the staging release-readiness validation:

1. **`POST /api/conversations` returns 500** — The route authenticates, rate-limits, and dispatches `CREATE_CONVERSATION`. The handler (`create-conversation.ts`) only returns a welcome message and UI state — no LLM, no DB reads. Missing `ANTHROPIC_API_KEY` does not block this path; `orchestrator-factory.ts` falls back to stub LLM deps. A 500 here is an unresolved config or runtime problem.

2. **Tenant emergency path not validated end-to-end** — The staging plan requires calling `POST /api/conversations/[id]/confirm-emergency` with a valid tenant JWT and a conversation already in `escalation_state: 'pending_confirmation'`. This was not exercised.

Until both are resolved, the release gate remains open.

## Item 1: Diagnose the POST /api/conversations 500

### What the code does

1. `withObservedRoute` wraps the handler — catches any thrown error, logs it as `request_failed` with `error_message`, returns `{"error":"Internal server error"}` ([with-observed-route.ts:55-72](apps/web/src/lib/observability/with-observed-route.ts#L55-L72))
2. `authenticateRequest(request)` verifies the JWT — **this passed** (we got 500, not 401)
3. `checkRateLimit(...)` — unlikely to throw (returns `NextResponse | null`)
4. `getOrchestrator()` calls `ensureInitialized()` which:
   - Calls `createStores()` — when `DATABASE_URL` is set, does `require('@wo-agent/db')` (dynamic CJS require inside ESM) ([orchestrator-factory.ts:96-107](apps/web/src/lib/orchestrator-factory.ts#L96-L107))
   - Loads taxonomy, risk protocols, escalation plans from JSON
   - Creates all providers, services, dispatcher
   - Caches on `globalThis.__woAgentDeps`
5. `dispatch(request)` runs `CREATE_CONVERSATION` handler which creates a session, writes an event to `eventRepo`, then saves to `sessionStore`

### Likely failure points (ordered by probability)

#### A. Demo-auth identifier shape vs. DB column types (most likely)

The `sessions` table ([003-sessions.sql](packages/db/src/migrations/003-sessions.sql)) defines `tenant_user_id UUID NOT NULL`. Demo auth issues string identifiers like `tu-demo-alice` ([demo-tenants.ts:35](apps/web/src/lib/dev-auth/demo-tenants.ts#L35)). The `PostgresSessionStore.save()` ([pg-session-store.ts:23-38](packages/db/src/repos/pg-session-store.ts#L23-L38)) inserts `session.tenant_user_id` into this UUID column. Postgres will reject `'tu-demo-alice'` as an invalid UUID, throwing an error that `withObservedRoute` catches and returns as a generic 500.

This is **systemic, not isolated to sessions**. The same UUID-typed `tenant_user_id` column appears in:

- `sessions` ([003-sessions.sql:9](packages/db/src/migrations/003-sessions.sql#L9)) — `tenant_user_id UUID NOT NULL`
- `work_orders` ([004-work-orders.sql:12](packages/db/src/migrations/004-work-orders.sql#L12)) — `tenant_user_id UUID NOT NULL`
- `work_orders` also has `tenant_account_id UUID NOT NULL`, `client_id UUID NOT NULL`, `property_id UUID NOT NULL`, `unit_id UUID NOT NULL`

The demo auth catalog uses human-readable string IDs (`tu-demo-alice`, `ta-demo-acme`, `unit-101`, `prop-unit-101`, `client-unit-101`). The default `unitResolver` in [orchestrator-factory.ts:374-380](apps/web/src/lib/orchestrator-factory.ts#L374-L380) hardcodes `property_id: 'prop-${unitId}'`, `client_id: 'client-${unitId}'`, which are also non-UUID strings.

This is a **release-environment identity-model inconsistency**: the DB schema assumes UUID identifiers, but the dev-auth and unit-resolver paths produce non-UUID strings.

**Diagnostic:**

```sql
-- Quick check: can Postgres cast demo IDs to UUID?
SELECT 'tu-demo-alice'::uuid;  -- Expected: ERROR invalid input syntax for type uuid
```

**Resolution options:**

| Option                                                | Fix                                                                                                                                                                                    | Scope                  | Trade-off                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| A1. Relax DB columns to `TEXT`                        | `ALTER TABLE sessions ALTER COLUMN tenant_user_id TYPE TEXT;` (+ same for all affected columns across all tables)                                                                      | Migration + redeploy   | Loses UUID validation at the DB layer; simplest short-term fix |
| A2. Change demo IDs to real UUIDs                     | Update `demo-tenants.ts` to use stable UUIDs (e.g., `'00000000-0000-0000-0000-000000000001'`), update `unitResolver` similarly                                                         | Code change + redeploy | Preserves DB schema integrity; demo IDs lose human readability |
| A3. Hybrid: TEXT for tenant-facing, UUID for internal | Change `tenant_user_id`, `tenant_account_id`, `unit_id` to TEXT (these come from external systems), keep `conversation_id`, `event_id`, `work_order_id` as UUID (internally generated) | Migration + redeploy   | Most correct long-term; larger scope                           |

#### B. DB table missing — `sessions` or `conversation_events`

The `sessions` table (migration 003) and `conversation_events` table (migration 001) must both exist. The event is written before the session save, so a missing `conversation_events` table would fail first.

**Evidence:** We know `operational_metrics` (migration 008) and `alert_cooldowns` (migration 009) exist because Phase 4B/4C succeeded. But migrations could have been run partially.

**Diagnostic:**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

If `sessions` or `conversation_events` is missing, run migrations:

```bash
DATABASE_URL="<staging-connection-string>" pnpm --filter @wo-agent/db migrate
```

**Important:** Even if all tables exist, the UUID type mismatch (A) will still cause the 500. A table-existence check alone is insufficient — the diagnostic must also verify column type compatibility.

#### C. Dynamic `require('@wo-agent/db')` fails in serverless bundle (weaker)

`orchestrator-factory.ts:107` does `require('@wo-agent/db')` inside an ESM module. `@wo-agent/db` is already in `transpilePackages` in [next.config.ts:4](apps/web/next.config.ts#L4), which reduces the likelihood of a bundling failure. The observability cron route also calls `ensureInitialized()` (via `getAlertEvaluatorDeps()`) and succeeded with a 200, further weakening this hypothesis. However, Vercel bundles each route independently, so it cannot be completely ruled out until logs confirm.

#### D. Pool connection failure

`createPool(databaseUrl)` could fail if the connection string is malformed or the pool cannot connect. Unlikely since the cron routes use the same pool successfully.

### Diagnostic steps

| Step | Action                                                                                                                 | Tool                                                                                                                   | Evidence                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D-1  | Check Vercel function logs for `conversations:create` route — find the `request_failed` log entry with `error_message` | Vercel dashboard → Functions → Logs (filter by `conversations:create`)                                                 | **Exact error message — this is the highest-value diagnostic** |
| D-2  | Verify all DB tables exist                                                                                             | Neon SQL Editor: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` | Table list                                                     |
| D-3  | Verify UUID type compatibility with demo IDs                                                                           | Neon SQL Editor: `SELECT 'tu-demo-alice'::uuid;` — expect error                                                        | Confirms or rules out hypothesis A                             |
| D-4  | Audit all UUID-typed columns that receive external identifiers                                                         | Review migrations 001–009 for columns typed `UUID` that store tenant-provided IDs                                      | Scope of type mismatch                                         |
| D-5  | If tables missing → run migrations                                                                                     | CLI with `DATABASE_URL`                                                                                                | Migration output                                               |
| D-6  | Apply chosen resolution for type mismatch                                                                              | Code or migration change + redeploy                                                                                    | Fixed 500                                                      |
| D-7  | Re-attempt `POST /api/conversations`                                                                                   | CLI: `curl -s -X POST ...`                                                                                             | 201 response                                                   |

### Resolution paths

| Root cause                           | Fix                                                                          | Scope                              |
| ------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------- |
| UUID type mismatch (A — most likely) | One of A1/A2/A3 above                                                        | Code or migration change, redeploy |
| Missing tables (B)                   | Run migrations against staging DB                                            | Config fix, no code change         |
| Bundling failure (C — unlikely)      | Add `@wo-agent/db` to `serverComponentsExternalPackages` in `next.config.ts` | Code change, redeploy              |
| Pool connection issue (D — unlikely) | Verify `DATABASE_URL` format, check Neon dashboard                           | Config fix                         |

## Item 2: Validate Tenant Emergency Path End-to-End

### Preconditions (all must be true before starting)

1. `POST /api/conversations` works (Item 1 resolved)
2. `ENABLE_DEV_AUTH=true` in Vercel (already done)
3. `EMERGENCY_ROUTING_ENABLED=true` in Vercel (already done)
4. `EMERGENCY_INTERNAL_ALERT_NUMBER` set to a safe test number (already done)
5. All Twilio vars set (already confirmed)

### What the code requires

The `confirm-emergency` route dispatches `CONFIRM_EMERGENCY` as an emergency sidecar action. The dispatcher ([dispatcher.ts:257-295](packages/core/src/orchestrator/dispatcher.ts#L257-L295)) enforces:

- Session must not be in a terminal state (`submitted`, `intake_expired`)
- `session.escalation_state === 'pending_confirmation'`

The `escalation_state` is set to `'pending_confirmation'` by the risk scanner when it detects an emergency trigger during the initial message submission flow ([submit-initial-message.ts:94-95](packages/core/src/orchestrator/action-handlers/submit-initial-message.ts#L94-L95)).

### Approach: Drive a conversation to emergency-confirmation state

The flow through the state machine that reaches `escalation_state: 'pending_confirmation'`:

1. **Get token** → `POST /api/dev/auth/demo-login` with `{"persona_key": "alice"}`
2. **Create conversation** → `POST /api/conversations` → state: `intake_started`
3. **Select unit** → `POST /api/conversations/[id]/select-unit` with `{"unit_id": "unit-101"}`

   **All tenants must select a unit**, including single-unit tenants like Alice. New sessions start with `unit_id: null` ([session.ts:31](packages/core/src/session/session.ts#L31)), and `SUBMIT_INITIAL_MESSAGE` rejects when the unit is unresolved ([submit-initial-message.ts:34-48](packages/core/src/orchestrator/action-handlers/submit-initial-message.ts#L34-L48)). The create-conversation handler shows unit-selection UI for multi-unit tenants and a welcome message for single-unit tenants, but does not auto-select. Unit selection must be explicit regardless of unit count.

4. **Submit initial message with emergency keywords** → `POST /api/conversations/[id]/message/initial` with `{"message": "There is a gas leak in my apartment and I can smell gas strongly"}`
5. The risk scanner should detect emergency keywords and set `escalation_state: 'pending_confirmation'`
6. **Confirm emergency** → `POST /api/conversations/[id]/confirm-emergency`

### Building scope and expected emergency outcome

The default `unitResolver` in [orchestrator-factory.ts:374-380](apps/web/src/lib/orchestrator-factory.ts#L374-L380) hardcodes:

```typescript
building_id: 'bldg-default';
```

The only escalation plan in [emergency_escalation_plans.json](packages/schemas/emergency_escalation_plans.json) is for `building_id: 'example-building-001'`.

**Therefore:** A normal create → select-unit → submit-emergency-message → confirm flow will land in the `NO_ESCALATION_PLAN` branch ([confirm-emergency.ts:114-136](packages/core/src/orchestrator/action-handlers/confirm-emergency.ts#L114-L136)), not incident creation. The response will include error code `NO_ESCALATION_PLAN` with 911 guidance, and zero escalation incidents will be created.

**To validate the incident-creation branch**, one of the following is required:

- **Option I1:** Update the `unitResolver` to return `building_id: 'example-building-001'` for the demo unit, or
- **Option I2:** After conversation creation + unit selection, directly UPDATE the session's `data` JSONB to set `building_id: 'example-building-001'`, or
- **Option I3:** Add a second escalation plan for `building_id: 'bldg-default'` to `emergency_escalation_plans.json`

**Decision required:** Is validating only the `NO_ESCALATION_PLAN` branch sufficient for the release gate, or must the incident-creation branch also be exercised? If the latter, choose I1/I2/I3.

### Alternative: Direct DB seeding

If the full flow is blocked (e.g., message submission has issues beyond Item 1), an alternative is to:

1. Create a conversation (once Item 1 is resolved)
2. Select unit
3. Directly UPDATE the session in the DB to set `escalation_state: 'pending_confirmation'` and `building_id` to `'example-building-001'` (for incident-creation branch) or leave as default (for no-plan branch)
4. Call `confirm-emergency`

This is less clean but isolates the test to just the emergency path. Note: this requires an UPDATE on the sessions table, which is allowed (sessions is not an event table — the append-only rule applies only to event tables per spec §7).

### Execution steps

| Step | Action                                                                                    | Expected result                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| E-1  | Get fresh JWT for Alice                                                                   | `POST /api/dev/auth/demo-login` → access_token (15-min expiry)                                                                        |
| E-2  | Create conversation                                                                       | `POST /api/conversations` → 201 with conversation_id                                                                                  |
| E-3  | Select unit                                                                               | `POST /api/conversations/[id]/select-unit` with `{"unit_id": "unit-101"}` → 200, state: `unit_selected`                               |
| E-4  | Submit emergency message                                                                  | `POST /api/conversations/[id]/message/initial` with `{"message": "There is a gas leak in my apartment and I can smell gas strongly"}` |
| E-5  | Check response for `escalation_state: 'pending_confirmation'` and emergency quick replies | Response JSON should include quick replies with `CONFIRM_EMERGENCY` action                                                            |
| E-6  | Confirm emergency                                                                         | `POST /api/conversations/[id]/confirm-emergency`                                                                                      |
| E-7  | Verify response                                                                           | See expected outcomes table below                                                                                                     |
| E-8  | Check DB for incidents                                                                    | `SELECT * FROM escalation_incidents WHERE conversation_id = '<id>'`                                                                   |

### Expected outcomes by branch

| Scenario                                                       | Error code                      | Response message                                                                 | DB state                  |
| -------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| Routing enabled, Twilio configured, building has matching plan | _(success)_                     | "Emergency confirmed. We are contacting the emergency response team..."          | 1 new escalation incident |
| Routing enabled, Twilio configured, no plan for building       | `NO_ESCALATION_PLAN`            | "No emergency escalation plan is configured for this building..." + 911 guidance | 0 incidents               |
| Routing enabled, Twilio missing                                | `EMERGENCY_ROUTING_UNAVAILABLE` | "Voice/SMS providers are not configured" + 911 guidance                          | 0 incidents               |
| Routing disabled                                               | `EMERGENCY_ROUTING_UNAVAILABLE` | "Emergency routing is disabled by feature flag" + 911 guidance                   | 0 incidents               |

**Default flow lands in row 2** (`NO_ESCALATION_PLAN`) because the unit resolver produces `building_id: 'bldg-default'` and no plan exists for that building. Row 1 is only reachable with I1/I2/I3 override.

## Execution Order

1. **D-1**: Check Vercel function logs for the actual error message (highest-value diagnostic)
2. **D-2 + D-3**: Verify tables exist AND verify UUID type compatibility
3. **D-4**: Audit full scope of UUID-typed columns receiving external identifiers
4. **D-5 + D-6**: Apply fix (most likely: resolve UUID type mismatch)
5. **D-7**: Re-attempt `POST /api/conversations` — must return 201
6. **E-1 through E-8**: Drive tenant emergency path
7. **Re-run Phase 7**: Classify release decision based on complete evidence

## Exit criteria

- The `POST /api/conversations` 500 root cause is identified with log evidence
- The fix is applied and conversation creation succeeds on staging (201 response)
- The UUID type mismatch (if confirmed) is resolved across all affected tables, not just `sessions`
- `POST /api/conversations/[id]/confirm-emergency` is exercised with a conversation in `escalation_state: 'pending_confirmation'`
- The emergency path response matches one of the expected outcomes above
- A decision is recorded on whether the incident-creation branch (row 1) must also be validated
- The release gate can be definitively classified as `clean_staging_validation`, `config_issue`, or `runtime_defect`
