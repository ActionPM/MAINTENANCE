# Spec Gap Tracker

This is the canonical tracker for repository compliance against [docs/spec.md](./spec.md).

Use this file as the standing source of truth for:
- what is implemented,
- what is only partially wired,
- what is still missing,
- and what the spec explicitly defers beyond MVP.

Update this file in the same PR as any code change that affects spec coverage.

## Metadata

| Field | Value |
| --- | --- |
| Tracker owner | _TBD_ |
| Last updated | 2026-03-12 |
| Spec version reviewed | [docs/spec.md](./spec.md) |

## Definitions

| Term | Definition |
| --- | --- |
| `Tracker owner` | The person accountable for keeping this document current and internally consistent. |
| `Owner` | The person or team accountable for a specific row being correct and for driving the next action. This is not necessarily the last person who edited the code. |
| `Spec Ref` | The exact section or subsection in `docs/spec.md` that the row maps to. |
| `Requirement` | One testable requirement. If a spec item spans multiple independent behaviors, split it into multiple rows. |
| `Evidence` | Concrete repo proof for the current status, such as route files, migrations, orchestrator handlers, workflows, tests, or config. |
| `Gap` | Why the row is not `DONE`, or the residual risk that still matters if the implementation is close. |
| `Next Action` | The next concrete implementation or verification step needed to move the row forward. |
| `Last Verified` | The date the row was last checked against the current repository state. |
| `Priority` | The urgency of the gap. Use `P0` for blocking or high-risk runtime gaps, `P1` for important but non-blocking work, and `P2` for lower-risk follow-up work. |
| `Wired` | Reachable in the real application runtime path, not just present as a helper, type, or test fixture. |
| `Stub` | A placeholder implementation or route that does not satisfy the spec behavior. |
| `Production path` | The dependency path actually used by the running app, not test-only or example wiring. |
| `Verified` | Confirmed by direct inspection of the current repo state rather than assumed from memory or prior summaries. |

## Status Rules

| Status | Meaning | Required evidence before using this status |
| --- | --- | --- |
| `DONE` | Spec behavior is implemented and wired into the real runtime path. | Code path exists, is reachable in production flow, and has direct evidence such as tests, route wiring, migrations, or verified behavior. |
| `PARTIAL` | Some code exists, but the behavior is incomplete, stubbed, not persisted, not exposed, not authorized, or not wired. | At least one meaningful implementation artifact exists, but the full spec contract is not met. |
| `MISSING` | No meaningful implementation for the requirement. | No runtime implementation beyond placeholder comments, empty types, or future-facing schema fields. |
| `INTENTIONAL_MVP` | The spec explicitly says this is deferred past MVP. | The deferral is stated in `docs/spec.md`; this status must not be used for work that is merely unfinished. |

## Evidence Rules

- Do not mark a row `DONE` just because a type, helper, schema, or test exists.
- Do not mark a row `DONE` if the route exists but returns a stub payload.
- Do not mark a row `DONE` if the dependency injection path uses placeholder data or no-op implementations.
- If the spec requirement spans multiple layers, split it into multiple rows rather than overstating one row.
- Evidence should point to concrete repo artifacts such as:
  - route files,
  - migrations,
  - orchestrator handlers,
  - tests,
  - workflow files,
  - config files.

## Update Workflow

1. Update only the rows touched by the change.
2. Add or revise evidence links and note what remains incomplete.
3. Recalculate the summary counts.
4. Refresh `Last updated` with the actual date of review.
5. If a requirement changed meaning, add a new row instead of rewriting history ambiguously.

## Common Review Mistakes

- Treating "schema exists" as equivalent to "runtime behavior exists"
- Treating "helper function exists" as equivalent to "orchestrator actually calls it"
- Treating "route file exists" as equivalent to "auth, ownership, and persistence are complete"
- Treating "test-only wiring" as equivalent to "production wiring"
- Collapsing multiple sub-requirements into one overbroad `DONE`

## Summary Dashboard

| Status | Count | Notes |
| --- | --- | --- |
| `DONE` | 119 | Core pipeline, state machine, schemas, domain services, tenant read surfaces, emergency escalation runtime, and full observability (structured logging, runtime metrics, alerting) |
| `PARTIAL` | 22 | Event persistence, version pinning, photos, and mitigation gating |
| `MISSING` | 11 | Tenant signals, required docs, and unresolved runtime surfaces remain absent |
| `INTENTIONAL_MVP` | 5 | OTP/ERP identity matching, PDF export, and deferred secondary/admin endpoints remain explicitly out of MVP scope |

## Priority Gaps

| Priority | ID | Requirement | Why it matters | Target action |
| --- | --- | --- | --- | --- |
| `P1` | `S07-05` | Production persistence drops classification issue_id structure | Classification events cannot be reliably queried or replayed by issue in the production path | Preserve domain identifiers in persisted classification rows |
| ~~`P1`~~ | ~~`S17-02`~~ | ~~Emergency router injected with empty plans and no-op executor~~ | **RESOLVED 2026-03-12** — Factory loads real plans + protocols; async coordinator wired with feature flag | — |
| ~~`P1`~~ | ~~`S25-01/S25-02/S25-04`~~ | ~~Observability is emergency-only; spec-wide logs, metrics, and alerting remain incomplete~~ | **RESOLVED 2026-03-12** — Full observability stack: structured JSON logging on all routes/dispatcher/LLM/escalation with end-to-end `request_id` correlation, 10 runtime metrics via Postgres-backed store (all `record()` calls awaited), alerting with SMS sink + `MisconfiguredAlertSink` for missing creds + delivery-failure-aware cooldown + cron evaluator | — |
| `P2` | `S08-08` | Rate-limit violations are not logged as security events | Abuse and throttling incidents are not auditable | Emit structured security events on rate-limit hits |
| `P2` | `S01-07` | HVT flag (3 open WOs) not computed | Tenant signal from §1.7 entirely absent | Add HVT computation in analytics or WO query layer |
| `P2` | `S27-12/S27-13/S27-14` | security-boundaries.md, retention-policy.md, rfcs/ missing | Spec §29 requires these artifacts | Author documentation |
| `P2` | `S27-16/S27-17/S27-18` | Governance docs disagree on plan locations, source-of-truth files, and orchestrator shape | Documentation drift makes future implementation work less reliable even when code is correct | Reconcile spec, AGENTS, and repo structure around one canonical architecture and doc layout |

## Structural Gap Disposition

Use this section to distinguish "true implementation debt" from "reasonable divergence that now needs documentation."

| Disposition | Tracker IDs | Why this bucket fits | Follow-through |
| --- | --- | --- | --- |
| `must_fix` | `S07-05` | Losing classification-event identifiers in the production path weakens auditability without providing a real compensating benefit | Preserve the identifiers in persistence even if the broader event-table design stays simplified |
| ~~`must_fix`~~ | ~~`S17-02`~~ | **RESOLVED 2026-03-12** — Emergency escalation is now fully wired: coordinator, providers, incident store, feature flag, structured logging, cron job, API routes, and sidecar action handlers | — |
| `accepted_deviation` | `S07-02` | A generic append-only event log is an acceptable MVP storage model as long as the append-only contract and domain identifiers are preserved | Documented in `docs/spec.md` and `AGENTS.md`; revisit only if domain-specific query needs justify a table split |
| `accepted_deviation` | `S18-05` | Session last-write-wins is acceptable for MVP because the dispatcher is the only supported writer path today | Documented in `docs/spec.md` and `AGENTS.md`; revisit if session writes expand beyond the orchestrator boundary |
| `accepted_deviation` | `S24-16`, `S24-17`, `S24-18`, `S25-03` | Notification management, override submission, and split health sub-routes are useful, but they are not required for the core intake loop to function correctly today | Documented in `docs/spec.md`; implement later only if they are promoted into the committed MVP surface |
| `doc_only` | `S27-12`, `S27-13`, `S27-14` | These artifacts matter for governance and compliance clarity, but they do not change runtime behavior directly | Author the docs on a normal documentation track |
| `doc_only` | `S27-16`, `S27-17`, `S27-18` | These rows describe source-of-truth drift and architecture-description drift, not broken runtime behavior | Reconcile the governing docs once the intended architecture is confirmed |

## Row Template

Use one row per requirement.

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S00-01` | `0-2` | _Requirement text_ | `DONE\|PARTIAL\|MISSING\|INTENTIONAL_MVP` | _File paths, tests, workflows_ | _Why not done or any residual risk_ | _Concrete next step_ | _Initials or team_ | `YYYY-MM-DD` |

## Section 0-2: Executive Intent and Non-Negotiables

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S02-01` | `2.1` | Taxonomy is authoritative — no free-text categories | `DONE` | `packages/schemas/taxonomy.json`, `validateClassificationAgainstTaxonomy()` in validators, enum validation on all classifier output | — | — | — | `2026-03-11` |
| `S02-02` | `2.2` | Split first — never classify until split finalized | `DONE` | `packages/core/src/state-machine/transition-matrix.ts` — `classification_in_progress` only reachable from `split_finalized`; 46 state machine tests | — | — | — | `2026-03-11` |
| `S02-03` | `2.3` | Schema-lock all model outputs — invalid outputs retry or fail safe | `DONE` | `issue-classifier.ts` two-pass retry, `issue-splitter.ts` retry, `followup-generator.ts` retry; all validate against JSON Schema via Ajv | — | — | — | `2026-03-11` |
| `S02-04` | `2.4` | No side effects without tenant confirmation | `DONE` | `confirm-submission.ts` handler gates WO creation on `tenant_confirmation_pending` state | — | — | — | `2026-03-11` |
| `S02-05` | `2.5` | Unit/property derived from membership — tenant cannot set | `DONE` | `select-unit.ts` handler uses `unitResolver.resolve()` server-side; auth middleware derives authorized_unit_ids | — | — | — | `2026-03-11` |
| `S02-06` | `2.6` | Append-only events — corrections appended, not mutations | `DONE` | Migration `001-conversation-events.sql` has INSERT-only trigger guard; `pg-event-store.ts` uses INSERT + ON CONFLICT DO NOTHING | Domain identifier preservation remains tracked in `S07-05` | — | — | `2026-03-11` |
| `S02-07` | `2.7` | Emergency escalation is deterministic — model suggests, system confirms + routes | `DONE` | Trigger scanner → `escalation_state: 'pending_confirmation'` → tenant confirms via `CONFIRM_EMERGENCY` → `startIncident()` in coordinator → async voice/SMS/retry workflow. All decisions deterministic; LLM never executes escalation. Factory loads real plans + protocols. Feature-flagged. | — | — | — | `2026-03-12` |
| `S02-08` | `0` | Governed agent model — model proposes, deterministic code enforces | `DONE` | Orchestrator is sole controller (`dispatcher.ts`); LLM outputs validated; state machine enforces transitions | — | — | — | `2026-03-11` |

## Section 1: Operating Assumptions

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S01-01` | `1.1` | In-app chatbot intake only | `DONE` | `apps/web/` Next.js app with chat UI components, API routes | — | — | — | `2026-03-11` |
| `S01-02` | `1.1` | SMS outbound only — no tenant SMS intake channel | `DONE` | Outbound SMS: `mock-sms-sender.ts`, `MockSmsProvider`, Twilio `SmsProvider`. Inbound SMS exists only for emergency escalation ACCEPT/IGNORE replies (`sms-reply/route.ts`), not as a general tenant intake channel. Spec §1.1 scopes SMS as outbound-only for tenant notifications; inbound is limited to escalation acknowledgement. | — | — | — | `2026-03-12` |
| `S01-03` | `1.2` | Multi-unit: require explicit unit selection when >1 unit | `DONE` | `unit_selection_required` state in transition matrix; `select-unit.ts` handler; guard in `guards.ts` | — | — | — | `2026-03-11` |
| `S01-04` | `1.3` | Secure AuthN/AuthZ (MVP) | `DONE` | `auth/jwt.ts` signs/verifies tokens; `apps/web/src/middleware/auth.ts` fails closed when JWT secrets are missing; conversation and work-order read routes enforce auth + ownership/unit scope; `dispatcher.ts` rejects cross-tenant session access | — | — | — | `2026-03-11` |
| `S01-05` | `1.4` | One Issue → one Work Order; multi-issue creates multiple WOs linked by issue_group_id | `DONE` | `wo-creator.ts` creates one WO per split issue with shared `issue_group_id`; `pg-wo-store.ts` insertBatch | — | — | — | `2026-03-11` |
| `S01-06` | `1.5` | WO status lifecycle: created → action_required → scheduled → resolved \| cancelled | `DONE` | `WorkOrderStatus` enum in schemas; `status_history` array on WO; `pg-wo-store.ts` updateStatus with optimistic locking | — | — | — | `2026-03-11` |
| `S01-07` | `1.7` | HVT flag: 3 open WOs threshold | `MISSING` | No code computes or stores HVT status | — | Add HVT computation | — | `2026-03-11` |
| `S01-08` | `1.7` | Tone/frustration score and history summary | `MISSING` | No implementation | — | Design and implement tenant signal tracking | — | `2026-03-11` |
| `S01-09` | `1.7` | Tenant signals never change taxonomy outputs or priority | `DONE` | No code path exists that would modify classification based on tenant signals; classifier is taxonomy-only | By design — nothing to change | — | — | `2026-03-11` |
| `S01-10` | `1.6` | Per-building emergency escalation chain (call-until-answered, log attempts, exhaustion) | `DONE` | Coordinator logic complete: voice call + SMS prompt inline in `attemptContact()` → ACCEPT/IGNORE → stand-down → cycle exhaustion → retry. Webhook routes wired to coordinator with null-guard fail-closed. Typed provider injection (Twilio when configured, undefined when routing enabled but creds missing — fail-closed). CAS checked on all updates. Plans loaded from `emergency_escalation_plans.json`. Pg migration `007-escalation-incidents.sql` + `PgEscalationIncidentStore` with optimistic locking; factory wires Pg store when `DATABASE_URL` set, in-memory fallback for dev. Atomic one-active-per-conversation constraint via partial unique index prevents TOCTOU race on concurrent `CONFIRM_EMERGENCY`; `create()` returns boolean, `startIncident()` returns existing incident on duplicate. | — | — | — | `2026-03-12` |
| `S01-11` | `1.8` | Design supports French later without taxonomy drift | `MISSING` | No i18n infrastructure; prompts are English-only | — | Add i18n design for prompts and UI strings | — | `2026-03-11` |
| `S01-12` | `1.9` | Jurisdiction/compliance overrides (RentSafeTO baseline) | `PARTIAL` | SLA policies accept jurisdiction overrides in schema | No jurisdiction lookup service | Add jurisdiction resolution | — | `2026-03-11` |
| `S01-13` | `1.1` | Photos: in-app only, optional in MVP, attach during intake or after submission | `PARTIAL` | Photo init/complete routes exist; draft photo IDs tracked on session | No object storage, no presigned URLs, no scanning; post-submission WO-scoped upload not implemented | See S19-* rows | — | `2026-03-11` |

## Section 5: Taxonomy and Version Pinning

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S05-01` | `5.1` | Use taxonomy.json verbatim as shared analytic spine | `DONE` | `packages/schemas/taxonomy.json` loaded at import; `isTaxonomyValue()` type guard; validator checks against it | — | — | — | `2026-03-11` |
| `S05-02` | `5.2` | Each conversation pins taxonomy_version, schema_version, model_id, prompt_version | `PARTIAL` | Fields exist on WorkOrder type and in `pinned_versions` on session; eval runner uses them | Session creation does not dynamically resolve and pin current live versions — values are empty strings or test constants | Wire version resolution into session creation | — | `2026-03-11` |
| `S05-03` | `5.2` | Resumed conversations retain pinned versions | `PARTIAL` | Session is restored with its existing data on resume | No enforcement that prevents a resumed conversation from using newer taxonomy/model if versions changed | Add version comparison guard on resume | — | `2026-03-11` |
| `S05-04` | `5.3` | Category gating: contradictory outputs trigger one constrained retry, then human triage | `DONE` | `issue-classifier.ts` two-pass logic with hard constraint on retry; `needs_human_triage` escape if still contradictory | — | — | — | `2026-03-11` |

## Section 6: Core Data Model

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S06-01` | `6` | WorkOrder includes all spec fields (IDs, scope, tenant, status, intake, classification, risk, etc.) | `DONE` | `packages/schemas/src/types/work-order.ts` full type; `work_order.schema.json`; `004-work-orders.sql` migration | — | — | — | `2026-03-11` |
| `S06-02` | `6` | `pets_present: yes\|no\|unknown` | `DONE` | `PetsPresent` type; schema validation; defaults to `unknown` in `wo-creator.ts` | — | — | — | `2026-03-11` |
| `S06-03` | `6` | `issue_group_id` linkage only — no aggregate group status | `DONE` | `issue_group_id` on WO; no group table or group status anywhere | — | — | — | `2026-03-11` |
| `S06-04` | `6` | `summary_confirmed` persisted on WO | `DONE` | `wo-creator.ts:67` sets `summary_confirmed: issue.summary`; `004-work-orders.sql:15` has column; `pg-wo-store.ts` persists it | — | — | — | `2026-03-11` |
| `S06-05` | `6` | `photos[]` with sha256, scanned_status, storage_key | `PARTIAL` | Schema defined in `photo.schema.json` and `work_order.schema.json`; types in `work-order.ts` | Photos not attached at WO creation (`wo-creator.ts:42` comment); no storage backend to populate storage_key | Implement photo-to-WO attachment flow | — | `2026-03-11` |

## Section 7: Append-Only Events

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S07-01` | `7` | Append-only immutability enforced (INSERT+SELECT only, no UPDATE/DELETE) | `DONE` | `001-conversation-events.sql` trigger guard; `pg-event-store.ts` INSERT only with ON CONFLICT DO NOTHING | — | — | — | `2026-03-11` |
| `S07-02` | `7` | Logical event domains remain append-only; MVP physical storage may consolidate them instead of requiring seven separate tables | `DONE` | `conversation_events` and `notification_events` are append-only; `pg-event-store.ts` stores conversation-scoped domains in the generic stream; `docs/spec.md` and `AGENTS.md` now document the consolidated MVP model | Classification identifier preservation is still a separate gap (`S07-05`) | — | — | `2026-03-11` |
| `S07-03` | `7.1` | Follow-up event schema matches §7.1 (event_id, conversation_id, issue_id, turn_number, questions_asked, answers_received, created_at) | `DONE` | `FollowUpEvent` type matches spec; `followup/event-builder.ts` constructs compliant events; `pg-event-store.ts:95` persists all fields as payload | Accepted MVP storage shape stores the schema as payload within the append-only stream | — | — | `2026-03-11` |
| `S07-04` | `7` | Corrections are appended events; effective classification is latest approved override | `PARTIAL` | Append-only pattern enforced; event types support corrections | No PM override workflow is exposed yet and the public override endpoint is deferred from the current MVP surface | Add an override submission path only if PM correction workflows are promoted into scope | — | `2026-03-11` |
| `S07-05` | `7` | Production event persistence preserves domain identifiers for classification events | `PARTIAL` | `packages/core/src/classifier/classification-event.ts` defines classification events with `issue_id`; `start-classification.ts` and `answer-followups.ts` insert those events; `packages/db/src/repos/pg-event-store.ts` fallback path stores only generic payload for non-conversation events | The Postgres fallback path drops top-level `issue_id` for classification events and there is no dedicated `classification_events` table, weakening auditability and replay | Add dedicated classification event persistence or store/index `issue_id` explicitly in the production path | — | `2026-03-11` |

## Section 8: Rate Limiting and Payload Caps

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S08-01` | `8` | `max_messages_per_minute_per_user = 10` | `DONE` | `rate-limits.ts` config; `rate-limiter.ts` middleware; all message routes pass `max_messages_per_minute_per_user` | — | — | — | `2026-03-11` |
| `S08-02` | `8` | `max_new_conversations_per_day_per_user = 20` | `DONE` | `conversations/route.ts:11` passes 24h window; rate limiter tracks per-user | — | — | — | `2026-03-11` |
| `S08-03` | `8` | `max_photo_uploads_per_conversation = 10` | `PARTIAL` | Config defined in `rate-limits.ts`; photo routes reference the limit | No per-conversation upload counter tracks actual usage | Add conversation-scoped photo count enforcement | — | `2026-03-11` |
| `S08-04` | `8` | `max_photo_size_mb = 10` | `MISSING` | Config value defined; no file size validation (no actual upload handling) | — | Implement with object storage integration | — | `2026-03-11` |
| `S08-05` | `8` | `max_message_chars = 8000` | `PARTIAL` | Config defined; `message-input.tsx` enforces in UI | Server-side enforcement in API routes not verified | Add server-side character limit validation | — | `2026-03-11` |
| `S08-06` | `8` | `max_issues_per_conversation = 10` | `DONE` | `rate-limits.ts` config; `input-sanitizer.ts` enforces | — | — | — | `2026-03-11` |
| `S08-07` | `8` | `max_issue_text_chars = 500` | `DONE` | `rate-limits.ts` config; `input-sanitizer.ts` enforces | — | — | — | `2026-03-11` |
| `S08-08` | `8` | Log rate-limit violations as security events | `MISSING` | Rate limiter returns 429; no security event logging | — | Add security event emission on rate-limit hits | — | `2026-03-11` |

## Section 9: AuthN and AuthZ

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S09-01` | `9` | Access JWT (short-lived) + refresh token (rotating) | `DONE` | `auth/jwt.ts` uses `jose` library; 15m access / 7d refresh; HS256 signing | — | — | — | `2026-03-11` |
| `S09-02` | `9` | Server derives authorized units; tenant cannot set unit/property as truth | `DONE` | `select-unit.ts` resolves property/unit scope server-side; auth middleware derives `authorized_unit_ids`; `dispatcher.ts` rejects cross-tenant session access before handlers run | — | — | — | `2026-03-11` |
| `S09-03` | `9` | Every endpoint enforces membership checks | `DONE` | Conversation/work-order/photo/analytics routes use auth middleware; dispatcher enforces conversation ownership; work-order detail and record-bundle routes enforce both ownership and current unit membership | — | — | — | `2026-03-11` |
| `S09-04` | `9` | OTP + ERP tenant-ID matching | `INTENTIONAL_MVP` | Spec says post-MVP | — | — | — | `2026-03-11` |

## Section 10: Orchestrator Contract

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S10-01` | `10.1` | Orchestrator is sole controller for state transitions, LLM calls, WO creation, notifications, events | `DONE` | `dispatcher.ts` routes all actions; guards against client-submitted system events; auto-fire map chains system events | — | — | — | `2026-03-11` |
| `S10-02` | `10.2` | OrchestratorActionRequest schema (conversation_id, action_type, actor, tenant_input, idempotency_key, auth_context) | `DONE` | `orchestrator_action.schema.json`; TypeScript types in `orchestrator-action.ts` | — | — | — | `2026-03-11` |
| `S10-03` | `10.2` | OrchestratorActionResponse with ui_directive, artifacts (hashes + timestamps + presented_to_tenant), pending_side_effects, typed errors | `PARTIAL` | `response-builder.ts` constructs response with messages and quick replies | `artifacts` structure not fully spec-compliant (no hashes/timestamps/presented flags on response); `pending_side_effects` array not populated | Align response shape with spec §10.2 | — | `2026-03-11` |
| `S10-04` | `10.3` | All 16 MVP action types implemented | `DONE` | `ActionType` enum has all 16; handlers in `action-handlers/` for each | — | — | — | `2026-03-11` |

## Section 11: Intake State Machine

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S11-01` | `11.1` | All 14 states (10 core + 4 failure/recovery) | `DONE` | `ConversationState` enum with all 14 states; `transition-matrix.ts` covers all | — | — | — | `2026-03-11` |
| `S11-02` | `11.2` | Full transition matrix matches spec | `DONE` | Hardcoded matrix in `transition-matrix.ts`; 46 tests in state machine test suite | — | — | — | `2026-03-11` |
| `S11-03` | `11.2` | Photo uploads allowed in every state | `DONE` | `UPLOAD_PHOTO_INIT` and `UPLOAD_PHOTO_COMPLETE` in matrix for every state | — | — | — | `2026-03-11` |
| `S11-04` | `11.2` | ABANDON from every active state → intake_abandoned | `DONE` | All active states have ABANDON → intake_abandoned in matrix | — | — | — | `2026-03-11` |
| `S11-05` | `11.2` | intake_expired → CREATE_CONVERSATION creates new conversation | `DONE` | Transition defined in matrix | — | — | — | `2026-03-11` |
| `S11-06` | `11.2` | llm_error_retryable → RETRY_LLM → prior in-progress state | `DONE` | `resolveLlmFailure` and `resolveRetryLlm` guards in `guards.ts` | — | — | — | `2026-03-11` |

## Section 12: Draft Discovery, Additional Messages, and Staleness

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S12-01` | `12.1` | GET /conversations/drafts returns resumable drafts (up to 3, ordered by last_activity_at) | `DONE` | `apps/web/src/app/api/conversations/drafts/route.ts` loads sessions by tenant, applies `filterResumableDrafts`, and returns spec-shaped drafts; legacy `/conversations-drafts` path redirects to the spec route | — | — | — | `2026-03-11` |
| `S12-02` | `12.1` | Resumed conversations retain pinned versions | `PARTIAL` | Session is restored with existing data on resume | No enforcement that newer versions aren't used | Add version guard on resume path | — | `2026-03-11` |
| `S12-03` | `12.2` | New issue during follow-ups: queue, finish current, offer next intake | `PARTIAL` | `SUBMIT_ADDITIONAL_MESSAGE` accepted in `needs_tenant_input` state | Queueing logic and post-submission offer not implemented | Implement message queueing and new-issue detection | — | `2026-03-11` |
| `S12-04` | `12.3` | Unseen artifacts expire after 60 minutes | `DONE` | `staleness.ts:63` checks `!input.artifactPresentedToTenant` and applies unconditional 60min expiry | — | — | — | `2026-03-11` |
| `S12-05` | `12.3` | Seen artifacts stale if source hash changed, split hash changed, or (age > 60min AND borderline confidence) | `DONE` | `staleness.ts:44-80` implements all 4 rules; `dispatcher.ts:232` calls `markConfirmationPresented()` on entering `tenant_confirmation_pending` | — | — | — | `2026-03-11` |

## Section 13: Splitting

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S13-01` | `13` | Split first — classifier cannot run until split finalized | `DONE` | State machine enforces; `classification_in_progress` only reachable from `split_finalized` | — | — | — | `2026-03-11` |
| `S13-02` | `13` | Split confirmation: accept/merge/edit/add/reject | `DONE` | All 5 action handlers in `split-actions.ts`; routes for each | — | — | — | `2026-03-11` |
| `S13-03` | `13` | Input sanitization: strip control chars, escape HTML, normalize whitespace | `DONE` | `input-sanitizer.ts` with dedup + constraint validation | — | — | — | `2026-03-11` |
| `S13-04` | `13` | Max 500 chars per issue, max 10 issues per conversation | `DONE` | `rate-limits.ts` config; `input-sanitizer.ts` enforces both | — | — | — | `2026-03-11` |

## Section 14: Classification, Cues, and Confidence

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S14-01` | `14.1` | Classification output: taxonomy enums + confidence_by_field + missing_fields | `DONE` | `issue-classifier.ts` returns typed `ClassifierResult`; Ajv validation of output | — | — | — | `2026-03-11` |
| `S14-02` | `14.2` | Category gating with constrained retry → human triage | `DONE` | Two-pass in `issue-classifier.ts`; hard constraint on retry; `needs_human_triage` escape | — | — | — | `2026-03-11` |
| `S14-03` | `14.3` | Confidence formula: 0.40×cue + 0.25×completeness + 0.20×model_hint − 0.10×disagreement − 0.05×ambiguity | `DONE` | `confidence.ts` with exact weights matching spec | — | — | — | `2026-03-11` |
| `S14-04` | `14.3` | Model hint clamped [0.2, 0.95] | `DONE` | `confidence.ts` applies clamp | — | — | — | `2026-03-11` |
| `S14-05` | `14.3` | Bands: high ≥ 0.85, medium ≥ 0.65, low < 0.65 | `DONE` | `DEFAULT_CONFIDENCE_CONFIG` in `confidence-config.ts` | — | — | — | `2026-03-11` |
| `S14-06` | `14.3` | Validate and tune bands on Gold Set B before pilot | `MISSING` | Gold Set B does not exist | — | Create Gold Set B for confidence tuning | — | `2026-03-11` |
| `S14-07` | `14.4` | classification_cues.json with per-field keyword/regex cues | `DONE` | `packages/schemas/classification_cues.json` v1.2.0 with coverage across all fields | — | — | — | `2026-03-11` |
| `S14-08` | `14.4` | Cue scoring: keyword hits + regex contribute to 0..1 score | `DONE` | `cue-scoring.ts` with `computeCueScores()`; HIT_BOOST=0.6; ambiguity tracking | — | — | — | `2026-03-11` |
| `S14-09` | `14.3` | Fields needing input determined by confidence band + required/risk-relevant field policy | `DONE` | `confidence.ts` `determineFieldsNeedingInput()` checks band thresholds + field policy (required, risk-relevant) + category gating exclusions | — | — | — | `2026-03-11` |

## Section 15: Follow-Ups

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S15-01` | `15` | Max 3 questions per turn | `DONE` | `DEFAULT_FOLLOWUP_CAPS.max_questions_per_turn: 3`; `caps.ts` enforces; schema validates | — | — | — | `2026-03-11` |
| `S15-02` | `15` | Max 8 turns | `DONE` | `DEFAULT_FOLLOWUP_CAPS.max_turns: 8`; `caps.ts:33` enforces | — | — | — | `2026-03-11` |
| `S15-03` | `15` | Max 9 total questions | `DONE` | `DEFAULT_FOLLOWUP_CAPS.max_total_questions: 9`; `caps.ts:44` enforces | — | — | — | `2026-03-11` |
| `S15-04` | `15` | Max 2 re-asks per field | `DONE` | `DEFAULT_FOLLOWUP_CAPS.max_reasks_per_field: 2`; `caps.ts:80` `filterEligibleFields()` | — | — | — | `2026-03-11` |
| `S15-05` | `15` | Escape hatch: WO with needs_human_triage if still incomplete | `DONE` | `caps.ts` returns `escapeHatch: true` on cap exhaustion; orchestrator creates WO with `needs_human_triage` | — | — | — | `2026-03-11` |
| `S15-06` | `15` | Record in followup_events per §7.1 schema | `DONE` | `followup/event-builder.ts` produces spec-compliant events; `pg-event-store.ts:95` persists | Accepted MVP storage shape keeps follow-up events in the append-only stream while preserving the §7.1 payload | — | — | `2026-03-11` |

## Section 16: Tenant Confirmation and Staleness

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S16-01` | `16` | Tenant must confirm summary + key labels + risk confirmations before side effects | `DONE` | `tenant_confirmation_pending` state gates WO creation; `confirm-submission.ts` handler | — | — | — | `2026-03-11` |
| `S16-02` | `16` | Staleness check at 60 minutes | `DONE` | `STALENESS_THRESHOLD_MS = 60 * 60 * 1000` in `staleness.ts:3`; `confirm-submission.ts` calls `checkStaleness()` | — | — | — | `2026-03-11` |
| `S16-03` | `16` | Re-run classification if stale | `DONE` | Staleness detected routes back to `classification_in_progress` via orchestrator | — | — | — | `2026-03-11` |

## Section 17: Risk and Emergency Router

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S17-01` | `17` | Deterministic trigger grammar: keyword_any, regex_any, taxonomy_path_any, requires_confirmation | `DONE` | `trigger-scanner.ts` implements keyword + regex + taxonomy path matching | — | — | — | `2026-03-11` |
| `S17-02` | `17` | Emergency router: per-building chain, call-until-answered, log attempts, exhaustion handling | `DONE` | `escalation-coordinator.ts` full async workflow: `startIncident()` → `attemptContact()` (voice + SMS inline) → `processCallOutcome()` (records voice result) → `processReplyForIncident()` (ACCEPT/IGNORE with ref-code disambiguation) → `processDue()` (cron-driven timeout advancement) with CAS locking on all mutations. SMS sent in `attemptContact()` independent of voice callback. Ref codes in outbound SMS for concurrent-incident disambiguation. Factory loads real `risk_protocols.json` + `escalation_plans.json`. Pg migration `007-escalation-incidents.sql` + `PgEscalationIncidentStore`. Twilio providers fail-closed when `EMERGENCY_ROUTING_ENABLED=true` but creds missing. Feature-flagged via `EMERGENCY_ROUTING_ENABLED`. Atomic duplicate-incident prevention: partial unique index `idx_escalation_incidents_one_active_per_convo` on `(conversation_id) WHERE status IN ('active','exhausted_retrying')`; store `create()` returns `false` on constraint violation; `startIncident()` returns existing incident — eliminates TOCTOU race on concurrent `CONFIRM_EMERGENCY`. | — | — | — | `2026-03-12` |
| `S17-03` | `17` | Confirm emergency via yes/no before routing | `DONE` | `CONFIRM_EMERGENCY` and `DECLINE_EMERGENCY` sidecar actions in dispatcher. Action handlers: `confirm-emergency.ts`, `decline-emergency.ts`. API routes: `POST /conversations/:id/confirm-emergency`, `POST /conversations/:id/decline-emergency`. Quick-reply payloads with `action_type`. Client synthesis on reload. Feature flag fail-closed guard. Spec §17.1 documents behavior. | — | — | — | `2026-03-12` |
| `S17-04` | `17` | requires_confirmation on risk protocols gates mitigation | `PARTIAL` | Field exists in `risk_protocols.json` schema. Routing confirmation gate added (dispatcher guard enforces `escalation_state === 'pending_confirmation'` + `CONFIRM_EMERGENCY` handler). | Mitigation-gating aspect of `requires_confirmation` (suppressing mitigation display until type confirmed) remains a separate concern. | Add mitigation display gating for `requires_confirmation` triggers | — | `2026-03-12` |
| `S17-05` | `17` | Mitigation templates rendered and shown to tenant | `DONE` | `mitigation.ts` `resolveMitigationTemplate()` with variable substitution | — | — | — | `2026-03-11` |

## Section 18: Concurrency, Idempotency, and Atomicity

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S18-01` | `18` | Idempotency keys for WO creation and notifications | `DONE` | `in-memory-idempotency-store.ts` atomic reserve-complete; `pg-idempotency-store.ts` for Postgres; notification service uses key + "-sms" suffix | — | — | — | `2026-03-11` |
| `S18-02` | `18` | Multi-WO creation in one DB transaction | `DONE` | `pg-wo-store.ts:9-51` wraps `insertBatch` in explicit `BEGIN`/`COMMIT`/`ROLLBACK` | — | — | — | `2026-03-11` |
| `S18-03` | `18` | Optimistic locking with row_version | `DONE` | `pg-wo-store.ts:119-120` uses `WHERE row_version = $N` and `row_version + 1`; `row_version` on WorkOrder type | — | — | — | `2026-03-11` |
| `S18-04` | `18` | Work orders independent post-creation — no group status stored | `DONE` | No group table; `issue_group_id` is linkage only | — | — | — | `2026-03-11` |
| `S18-05` | `18` | Conversation sessions may use dispatcher-mediated last-write-wins in MVP; optimistic locking remains required for work orders and other concurrency-sensitive records | `DONE` | `packages/db/src/migrations/003-sessions.sql` explicitly chooses last-write-wins; `packages/db/src/repos/pg-session-store.ts` implements it; `docs/spec.md` and `AGENTS.md` now scope `row_version` to concurrency-sensitive records | Revisit only if session writes expand beyond the orchestrator boundary | — | `2026-03-11` |

## Section 19: Photos

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S19-01` | `19` | Photo schema: sha256, scanned_status, storage_key | `DONE` | `photo.schema.json`; `work_order.schema.json`; TypeScript types in `work-order.ts` and `photo.ts` | — | — | — | `2026-03-11` |
| `S19-02` | `19` | Presigned upload flow: init → direct upload → complete | `PARTIAL` | `photos/init/route.ts` and `photos/complete/route.ts` exist; orchestrator handles UPLOAD_PHOTO_INIT/COMPLETE | No presigned URL generation; no actual storage backend; draft photo IDs only | Implement object storage integration with presigned URLs | — | `2026-03-11` |
| `S19-03` | `19` | Async scanning — block PM visibility until clean | `MISSING` | `scanned_status` field exists in schema | No scanning integration; no PM visibility gating | Implement scanning integration | — | `2026-03-11` |
| `S19-04` | `19` | Post-submission photos must target specific work_order_id | `MISSING` | No WO-scoped photo upload route | — | Add WO-scoped photo upload endpoint | — | `2026-03-11` |
| `S19-05` | `19` | During intake: photos stored as conversation draft attachments, linked to WOs on submission | `PARTIAL` | `photo-upload.ts` handler tracks draft_photo_ids on session | Photos not attached to WOs at creation (`wo-creator.ts:42` comment) | Implement photo-to-WO linking in confirm-submission handler | — | `2026-03-11` |

## Section 20: Notifications

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S20-01` | `20` | In-app + outbound SMS channels | `DONE` | `notification-service.ts` sends via both channels with preference checks | SMS uses MockSmsSender in production (intentional MVP) | Swap mock for real provider when ready | — | `2026-03-11` |
| `S20-02` | `20` | SMS consent tracking; default SMS off until consent | `DONE` | `preference-service.ts` with `grantSmsConsent()` / `revokeSmsConsent()` | — | — | — | `2026-03-11` |
| `S20-03` | `20` | Batching: multi-issue creation sends one notification | `DONE` | Batch logic in notification service | — | — | — | `2026-03-11` |
| `S20-04` | `20` | Deduping via idempotency + cooldown | `DONE` | 5-minute cooldown + idempotency key dedup in notification service | — | — | — | `2026-03-11` |

## Section 21: Record Bundle

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S21-01` | `21` | JSON export with summary, status history, comms, actions, schedule, resolution | `DONE` | `record-bundle-assembler.ts` gathers WO + events + photos + risk + SLA metadata | — | — | — | `2026-03-11` |
| `S21-02` | `21` | Export endpoint | `DONE` | `work-orders/[id]/record-bundle/route.ts` | — | — | — | `2026-03-11` |
| `S21-03` | `21` | PDF export (later) | `INTENTIONAL_MVP` | Spec says JSON first, PDF later | — | — | — | `2026-03-11` |

## Section 22: SLA Policies

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S22-01` | `22` | SLA policy schema: client defaults + taxonomy-path overrides | `DONE` | `sla_policies.json` schema; `sla-calculator.ts` applies policies by category with jurisdiction overrides | — | — | — | `2026-03-11` |
| `S22-02` | `22` | MVP: compute SLA metadata, expose in analytics and record bundle | `DONE` | `sla-calculator.ts` computes response_due/resolution_due; analytics service includes SLA metrics; record bundle includes SLA | — | — | — | `2026-03-11` |
| `S22-03` | `22` | No automated paging in MVP | `DONE` | Compute-only; no paging implementation | — | — | — | `2026-03-11` |

## Section 23: Mock ERP Adapter

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S23-01` | `23` | ERPAdapter interface: createWorkOrder, getWorkOrderStatus, syncUpdates, healthCheck | `DONE` | Interface in `erp/types.ts`; `MockERPAdapter` in `packages/adapters/mock/` implements all 4 methods | — | — | — | `2026-03-11` |
| `S23-02` | `23` | Mock returns EXT-uuid, simulates status transitions | `DONE` | `mock-erp-adapter.ts` returns `EXT-<uuid>`; simulates created → action_required → scheduled → resolved | — | — | — | `2026-03-11` |

## Section 24: API Surface

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S24-01` | `24.1` | POST /conversations | `DONE` | `conversations/route.ts` with auth + rate limiting + orchestrator dispatch | — | — | — | `2026-03-11` |
| `S24-02` | `24.1` | GET /conversations/:id | `DONE` | `apps/web/src/app/api/conversations/[id]/route.ts` authenticates, verifies ownership, and returns the projected `ConversationSnapshot` | — | — | — | `2026-03-11` |
| `S24-03` | `24.1` | GET /conversations/drafts | `DONE` | `apps/web/src/app/api/conversations/drafts/route.ts` is mounted on the documented path and returns resumable drafts via `filterResumableDrafts`; `conversations-drafts/route.ts` redirects legacy callers | — | — | — | `2026-03-11` |
| `S24-04` | `24.1` | POST /conversations/:id/select-unit | `DONE` | Route with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-05` | `24.1` | POST /conversations/:id/message/initial | `DONE` | Route with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-06` | `24.1` | POST /conversations/:id/message/additional | `DONE` | Route with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-07` | `24.1` | POST /conversations/:id/split/* (confirm, merge, edit, add, reject) | `DONE` | 5 routes, all with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-08` | `24.1` | POST /conversations/:id/followups/answer | `DONE` | Route with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-09` | `24.1` | POST /conversations/:id/confirm-submission | `DONE` | Route with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-10` | `24.1` | POST /conversations/:id/resume | `DONE` | Route with auth + rate limiting + dispatch | — | — | — | `2026-03-11` |
| `S24-11` | `24.1` | GET /work-orders | `DONE` | `apps/web/src/app/api/work-orders/route.ts` authenticates and filters by `tenant_user_id` plus `authorized_unit_ids` at the repository layer | — | — | — | `2026-03-11` |
| `S24-12` | `24.1` | GET /work-orders/:id | `DONE` | `apps/web/src/app/api/work-orders/[id]/route.ts` authenticates and enforces both ownership and current unit membership before returning the work order | — | — | — | `2026-03-11` |
| `S24-13` | `24.1` | GET /work-orders/:id/record-bundle | `DONE` | `work-orders/[id]/record-bundle/route.ts` | — | — | — | `2026-03-11` |
| `S24-14` | `24.1` | POST /photos/init | `DONE` | `photos/init/route.ts` with auth + rate limiting | — | — | — | `2026-03-11` |
| `S24-15` | `24.1` | POST /photos/complete | `DONE` | `photos/complete/route.ts` with auth + rate limiting | — | — | — | `2026-03-11` |
| `S24-16` | `24.1` | Deferred in MVP: GET /notifications tenant history endpoint | `INTENTIONAL_MVP` | No route; `docs/spec.md` now marks this as deferred secondary surface | Outbound notifications can operate without a tenant-facing inbox in the current release | Implement only if notification history becomes a supported tenant feature | — | `2026-03-11` |
| `S24-17` | `24.1` | Deferred in MVP: POST /notifications/prefs tenant preference endpoint | `INTENTIONAL_MVP` | No route; `docs/spec.md` now marks this as deferred secondary surface | Core intake and outbound delivery do not currently depend on a self-service preferences endpoint | Implement only if tenant-managed preferences become a release requirement | — | `2026-03-11` |
| `S24-18` | `24.1` | Deferred in MVP: POST /overrides PM override submission endpoint | `INTENTIONAL_MVP` | No route; `docs/spec.md` now marks this as deferred secondary/admin surface | PM override workflows are not yet part of the committed MVP runtime path | Implement only if PM correction workflows are promoted into scope | — | `2026-03-11` |
| `S24-19` | `24.1` | GET /analytics | `DONE` | `analytics/route.ts` as GET with auth + query params | — | — | — | `2026-03-11` |

## Section 25: Observability

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S25-01` | `25` | Structured JSON logs with request_id, action, state, latency, error codes | `DONE` | `StdoutJsonLogger` in `observability/logger.ts`; `withObservedRoute()` wraps all 29 API routes with `request_started`/`request_completed`/`request_failed` + `request_id` + `duration_ms`; dispatcher logs `action_received`/`action_completed`/`action_rejected` with state, latency, error codes; `withObservedLlmCall()` wraps all 3 LLM adapters with `llm_call_started`/`llm_call_completed`/`llm_call_failed` + per-call `ObservabilityContext`; `request_id` threaded end-to-end from dispatcher through all 3 action handlers (`submit-initial-message`, `start-classification`, `answer-followups`) into `callIssueSplitter`, `callIssueClassifier`, and `callFollowUpGenerator` via `obsCtx` parameter; escalation coordinator uses shared `Logger` interface with `request_id` from cron/webhook context. Integration tests: `observability-e2e.test.ts`, `schema-failure-metrics.test.ts`. | — | — | — | `2026-03-12` |
| `S25-02` | `25` | Metrics: LLM latency/errors, state durations, abandonment rate, escalation exhaustion, notification failures, schema failures | `DONE` | `operational_metrics` Postgres table (migration `008`); `PgOperationalMetricsStore` implements `MetricsRecorder` + `MetricsQueryStore`; 10 metrics emitted: `llm_call_latency_ms`, `llm_call_error_total`, `schema_validation_failure_total` (emitted from real validation sites in `callIssueSplitter`, `callIssueClassifier`, `callFollowUpGenerator` — all `record()` calls awaited), `orchestrator_action_latency_ms` (dispatcher), `conversation_abandoned_total` (abandon handler), `escalation_cycle_exhausted_total` (escalation coordinator), `notification_delivery_failure_total` (notification service, wired via factory), `alert_emitted_total` (SMS alert sink). `InMemoryMetricsRecorder` for tests. Integration test: `schema-failure-metrics.test.ts` (4 tests including async-await verification). | — | — | — | `2026-03-12` |
| `S25-03` | `25` | MVP health surface requires `/health`; dependency-specific sub-routes are optional | `DONE` | `/health/route.ts` exists and `docs/spec.md` now treats `/health/db`, `/health/llm`, `/health/storage`, and `/health/notifications` as optional sub-routes; `/health/erp/route.ts` provides an adapter-specific example | — | — | — | `2026-03-11` |
| `S25-04` | `25` | Alerts: escalation exhausted, LLM error spike, schema failure spike, async backlog | `DONE` | `SmsAlertSink` sends SMS to ops phone numbers on alert; `MisconfiguredAlertSink` throws `AlertDeliveryError` when Twilio creds are missing (prevents silent blackholing); `alert-evaluator.ts` evaluates 3 windowed conditions via `tryEmitAlert()` helper: `llm_error_spike` (MetricsQueryStore), `schema_failure_spike` (MetricsQueryStore), `async_backlog_threshold_exceeded` (EscalationIncidentStore.countOverdue()); delivery failures skip cooldown so alerts retry on next evaluation; `PgAlertCooldownStore` (migration `009`) prevents duplicate alerts with composite `(alert_name, scope)` keys; cron route `GET /api/cron/observability/evaluate-alerts` runs every 5 min with `OBSERVABILITY_ALERTS_ENABLED` kill switch; factory uses `MisconfiguredAlertSink` when `OPS_ALERT_PHONE_NUMBERS` is set but Twilio creds are missing. Integration test: `alert-evaluator.test.ts` (8 tests including delivery failure, partial delivery, and misconfigured sink scenarios). | — | — | — | `2026-03-12` |

## Section 26: Evaluation and Deployment Gates

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S26-01` | `26` | Gold sets A/B/C | `PARTIAL` | Gold A (50 examples), Hard (20), OOD (15), Regression (20) in `packages/evals/datasets/` | Gold Set B (confidence tuning) and Gold Set C do not exist | Create Gold Sets B and C | — | `2026-03-11` |
| `S26-02` | `26` | Human override loop stored as events with reason codes | `PARTIAL` | `human_override_events` type defined | No API route, no UI, no dedicated DB table | Implement override submission path | — | `2026-03-11` |
| `S26-03` | `26` | Versions pinned per conversation | `PARTIAL` | Fields exist on WO and session types; eval runner uses them | Dynamic pinning on session creation not wired (empty strings at creation) | Wire version resolution into createSession | — | `2026-03-11` |
| `S26-04` | `26` | CI gates on prompt/model changes | `DONE` | `.github/workflows/evals.yml` runs eval gate on PRs touching classifier/splitter/followup/schema/cue files; path filtering via dorny/paths-filter; matrix across 4 datasets; required `Post Eval Summary` check fails PR on regression | — | — | — | `2026-03-11` |
| `S26-05` | `26` | Canary + rollback deployment strategy | `PARTIAL` | Vercel provides instant rollback | No canary deployment process | Define canary process | — | `2026-03-11` |

## Section 27 and 29: Repo Structure and Required Artifacts

| ID | Spec Ref | Requirement | Status | Evidence | Gap | Next Action | Owner | Last Verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S27-01` | `29` | taxonomy.json | `DONE` | `packages/schemas/taxonomy.json` | — | — | — | `2026-03-11` |
| `S27-02` | `29` | orchestrator_action.schema.json | `DONE` | `packages/schemas/orchestrator_action.schema.json` | — | — | — | `2026-03-11` |
| `S27-03` | `29` | issue_split.schema.json | `DONE` | `packages/schemas/issue_split.schema.json` | — | — | — | `2026-03-11` |
| `S27-04` | `29` | work_order.schema.json | `DONE` | `packages/schemas/work_order.schema.json` | — | — | — | `2026-03-11` |
| `S27-05` | `29` | followup_request.schema.json | `DONE` | `packages/schemas/followup_request.schema.json` | — | — | — | `2026-03-11` |
| `S27-06` | `29` | followups.schema.json | `DONE` | `packages/schemas/followups.schema.json` | — | — | — | `2026-03-11` |
| `S27-07` | `29` | risk_protocols.json | `DONE` | `packages/schemas/risk_protocols.json` | — | — | — | `2026-03-11` |
| `S27-08` | `29` | emergency_escalation_plans.json | `DONE` | `packages/schemas/emergency_escalation_plans.json` | — | — | — | `2026-03-11` |
| `S27-09` | `29` | sla_policies.json | `DONE` | `packages/schemas/sla_policies.json` | — | — | — | `2026-03-11` |
| `S27-10` | `29` | photo.schema.json | `DONE` | `packages/schemas/photo.schema.json` | — | — | — | `2026-03-11` |
| `S27-11` | `29` | classification_cues.json | `DONE` | `packages/schemas/classification_cues.json` v1.2.0 | — | — | — | `2026-03-11` |
| `S27-12` | `29` | docs/security-boundaries.md | `MISSING` | File does not exist | — | Author security boundaries doc | — | `2026-03-11` |
| `S27-13` | `29` | docs/retention-policy.md | `MISSING` | File does not exist | — | Author retention policy doc | — | `2026-03-11` |
| `S27-14` | `29` | docs/rfcs/ (taxonomy governance) | `MISSING` | Directory does not exist | — | Create rfcs directory and initial taxonomy governance RFC | — | `2026-03-11` |
| `S27-15` | `27` | AGENTS.md with non-negotiables, commands, plan-first, TDD, taxonomy governance | `DONE` | `AGENTS.md` exists with all required sections | — | — | — | `2026-03-11` |
| `S27-16` | `27` | Planning/governance paths are internally consistent | `PARTIAL` | `docs/plans/` exists and is populated; spec §27 says `PLANS.md`; `AGENTS.md` says plans live in `docs/plans/` | The spec, AGENTS, and repo layout disagree on where plans are supposed to live | Choose one plan-location convention and update the governing docs to match the repo | — | `2026-03-11` |
| `S27-17` | `27` | Governance docs maintain one clearly authoritative spec/taxonomy source path | `PARTIAL` | `docs/spec.md` and root `SPEC.MD` both exist; `docs/taxonomy.json` and `packages/schemas/taxonomy.json` both exist | Duplicate "source of truth" files increase drift risk even when the current copies match | Designate canonical paths and mark any mirrored/generated copies explicitly | — | `2026-03-11` |
| `S27-18` | `27` | AGENTS architectural guidance matches the runtime controller structure | `PARTIAL` | `AGENTS.md` says the orchestrator is a pure `(state, action) -> (newState, sideEffects[])` controller with side effects after transition; `confirm-submission.ts`, `answer-followups.ts`, `start-classification.ts`, and `submit-initial-message.ts` perform writes/calls inline | Documentation and implementation disagree on whether handlers may execute side effects directly, which makes future changes harder to reason about | Either refactor toward deferred side effects or update AGENTS to describe the architecture that actually runs in production | — | `2026-03-11` |
