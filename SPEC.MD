# Service Request Intake and Triage Agent

**Final hand-off build spec (single source of truth)**  
Version: 2026-02-23 (America/Toronto)  
Stack: TypeScript + Next.js + PostgreSQL + pnpm workspaces + JSON Schema + Object storage (presigned uploads)

---

## 0) Executive intent

Build a tenant-facing **in-app chatbot** that converts tenant messages into **schema-enforced Work Orders** labeled with your authoritative taxonomy. The product value is **categorization integrity**, enabling reliable trend analysis, bundling, repeat-issue detection, and later client GL crosswalk mapping.

Two governing constraints:

1. **Governed agent**: the model proposes; deterministic code enforces transitions, validations, and side effects.
2. **Schema-first**: all model outputs and orchestration actions are constrained by JSON Schemas (no free-text categories).

---

## 1) Operating assumptions (confirmed)

### 1.1 Channels

- Intake is **in-app chatbot only**.
- SMS is **outbound updates only** (no SMS intake).
- Photos are **in-app only**, optional in MVP; can attach during intake or after submission via WO detail page.

### 1.2 Tenants and units

- Tenants are **pre-provisioned** by PM onboarding.
- Users may have multiple units; chatbot requires **explicit unit selection** when >1 unit exists.

### 1.3 Identity verification

- Strong OTP verification + ERP tenant-ID matching is later, but **MVP must include secure AuthN/AuthZ**.

### 1.4 Work Order semantics

- **One Issue → one Work Order**.
- Multi-issue messages create multiple WOs linked by `issue_group_id`.
- Staged completion supported (e.g., pests + sealing holes).

### 1.5 Work Order status lifecycle (authoritative)

`created → action_required → scheduled → resolved | cancelled`

### 1.6 Emergency escalation (human bridge)

Per-building configurable chain:  
**Building Manager → Property Manager → Senior Property Manager → fallback after-hours line**  
Call-until-answered behavior; log every attempt; define exhaustion behavior.

### 1.7 Tenant signals (flag-only)

- HVT: **3 open WOs**.
- Tone/frustration score and history summary.
- Signals never change taxonomy outputs or priority automatically.

### 1.8 Languages

MVP English; design supports French later without taxonomy drift.

### 1.9 Jurisdiction/compliance

Canada-wide with policy-driven compliance and jurisdiction overrides (RentSafeTO baseline supported).

---

## 2) Non-negotiables (coding-agent guardrails)

1. **Taxonomy is authoritative**; no free-text categories.
2. **Split first**; never classify until split is finalized.
3. **Schema-lock all model outputs**; invalid outputs retry deterministically or fail safe.
4. **No side effects without tenant confirmation.**
5. **Unit/property derived from membership**; tenant cannot set them.
6. **Append-only events**; corrections are appended, not mutations.
7. **Emergency escalation is deterministic**; model suggests, system confirms + routes.

---

## 3) High-level architecture

- In-app Chat UI
- Orchestrator (deterministic state machine + tool calls + side effects)
- Bounded LLM tools (schema-locked): IssueSplitter, IssueClassifier, FollowUpGenerator
- Risk Engine (deterministic) + Mitigation Templates
- Emergency Router (deterministic contact chain + exhaustion handling)
- Work Order Service (canonical records + status history)
- Notification Service (in-app + outbound SMS only; batching/dedupe + consent/prefs)
- Audit/Retention Layer (append-only events + record bundle export)
- Mock ERP Adapter (MVP) + later real adapters

---

## 4) Technology stack (locked)

- TypeScript / Node.js
- Next.js (UI + API routes)
- PostgreSQL
- pnpm workspaces
- JSON Schema validation for orchestrator actions, LLM I/O, and API DTO mapping
- Object storage for photos (presigned uploads + scanning)

---

## 5) Canonical taxonomy and gating rules

### 5.1 Taxonomy is authoritative

Use your `taxonomy.json` verbatim as the shared analytic spine across clients.

### 5.2 Version pinning

Each conversation pins:

- `taxonomy_version`, `schema_version`, `model_id`, `prompt_version`

**Resumed conversations retain their pinned versions** even if newer versions exist.

### 5.3 Category gating with explicit error path

If classifier returns contradictory fields (e.g., management category but populated maintenance fields):

1. Treat as **classification validation failure** (not schema failure).
2. Run **one targeted retry** with a hard constraint to set irrelevant domain fields to the appropriate non-applicable equivalents.
3. If still contradictory: mark `needs_human_triage` and proceed via escape hatch submission (WO created, status `created`, missing_fields preserved), storing the conflicting outputs in audit events.

---

## 6) Core data model (canonical Work Order)

A WorkOrder includes:

- IDs: `work_order_id`, `issue_group_id`, `issue_id`
- Scope: `client_id`, `property_id`, `unit_id`
- Tenant: `tenant_user_id`, `tenant_account_id`
- Status: `status`, `status_history[]`
- Intake: `raw_text`, `summary_confirmed`, `photos[]`
- Classification: taxonomy enums, `confidence_by_field`, `missing_fields[]`
- Logistics: `pets_present: yes|no|unknown`
- Risk: safety flags, templates shown, escalation attempts
- Notifications history
- Audit versions

Issue group is linkage only; **no aggregate group status** stored.

---

## 7) Append-only events and immutability

Event tables (append-only):

- `conversation_events`
- `classification_events`
- `followup_events`
- `work_order_events`
- `risk_events`
- `notification_events`
- `human_override_events`

### 7.1 Follow-up event minimum schema

```json
{
  "event_id": "string",
  "conversation_id": "string",
  "issue_id": "string",
  "turn_number": 1,
  "questions_asked": [
    {
      "question_id": "string",
      "field_target": "string",
      "prompt": "string",
      "options": ["..."],
      "answer_type": "enum|yes_no|text"
    }
  ],
  "answers_received": [{ "question_id": "string", "answer": "any", "received_at": "date-time" }],
  "created_at": "date-time"
}
```

Corrections are appended events; effective classification is the latest approved override.

Immutability enforcement:

- app role has INSERT+SELECT only on event tables
- no UPDATE/DELETE grants; optional trigger guards

---

## 8) Rate limiting and payload caps (server-side enforcement)

These defaults are required for abuse/DoS protection and are configurable per client:

- `max_messages_per_minute_per_user = 10`
- `max_new_conversations_per_day_per_user = 20`
- `max_photo_uploads_per_conversation = 10`
- `max_photo_size_mb = 10`
- `max_message_chars = 8000`
- `max_issues_per_conversation = 10`
- `max_issue_text_chars = 500`

Enforcement requirements:

- apply at API gateway/middleware layer
- log violations as security events
- return user-safe errors (e.g., “Too many messages. Please wait a moment.”)

---

## 9) AuthN/AuthZ (MVP required)

Authentication:

- app login → access JWT (short-lived) + refresh token (rotating)

Authorization (hard rules):

- server derives authorized units for tenant_user_id
- tenant cannot set unit/property IDs as truth
- every endpoint enforces membership checks

Multi-unit:

- `unit_selection_required` state until unit selected (except emergency mitigation text can display pre-selection; selection required to proceed).

---

## 10) Orchestrator contract (schema + responsibilities)

### 10.1 Orchestrator is the only controller

Sole component allowed to:

- transition conversation state
- call LLM tools
- create work orders
- send notifications
- trigger emergency router
- write events

### 10.2 OrchestratorAction schema

Create `packages/schemas/orchestrator_action.schema.json`.

**OrchestratorActionRequest**

- `conversation_id` (nullable for create)
- `action_type` (enum)
- `actor: tenant|system|agent|pm_user`
- `tenant_input` (typed by action)
- `idempotency_key` (required for side-effect actions)
- `auth_context` (derived server-side)

**OrchestratorActionResponse**

- `conversation_snapshot`
- `ui_directive` (messages, quick replies, forms, upload prompts)
- `artifacts` (refs + hashes + timestamps + presented_to_tenant flags)
- `pending_side_effects[]`
- `errors[]` (typed, user-safe)

### 10.3 Action types (MVP)

- `CREATE_CONVERSATION`
- `SELECT_UNIT`
- `SUBMIT_INITIAL_MESSAGE` (first message starting intake)
- `SUBMIT_ADDITIONAL_MESSAGE` (free text during follow-ups; queued or treated as clarification per policy)
- `CONFIRM_SPLIT`
- `MERGE_ISSUES`
- `EDIT_ISSUE`
- `ADD_ISSUE`
- `REJECT_SPLIT`
- `ANSWER_FOLLOWUPS`
- `CONFIRM_SUBMISSION`
- `UPLOAD_PHOTO_INIT`
- `UPLOAD_PHOTO_COMPLETE`
- `RESUME`
- `ABANDON` (system-generated)

---

## 11) Intake state machine (explicit + transition matrix)

Conversation state is internal and separate from Work Order status.

### 11.1 States

**Core**

- `intake_started`
- `unit_selection_required`
- `unit_selected`
- `split_in_progress`
- `split_proposed`
- `split_finalized`
- `classification_in_progress`
- `needs_tenant_input`
- `tenant_confirmation_pending`
- `submitted`

**Failure / recovery**

- `llm_error_retryable`
- `llm_error_terminal`
- `intake_abandoned`
- `intake_expired`

### 11.2 Transition matrix (authoritative, includes photo uploads)

Notation: `{current_state: valid_actions → next_state}`  
Photo uploads are allowed **during intake** and **after submission** with rules below.

- `intake_started`
  - `SELECT_UNIT` → `unit_selected` or `unit_selection_required`
  - `SUBMIT_INITIAL_MESSAGE` (only if unit already resolved) → `split_in_progress`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `intake_started` _(allowed: attaches to conversation draft; later linked to WOs)_
  - `RESUME` → `intake_started`

- `unit_selection_required`
  - `SELECT_UNIT` → `unit_selected`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `unit_selection_required` _(allowed; stored as draft attachments)_
  - `ABANDON` → `intake_abandoned`

- `unit_selected`
  - `SUBMIT_INITIAL_MESSAGE` → `split_in_progress`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `unit_selected` _(allowed)_
  - `ABANDON` → `intake_abandoned`

- `split_in_progress`
  - _(system)_ `LLM_SPLIT_SUCCESS` → `split_proposed`
  - _(system)_ `LLM_FAIL` → `llm_error_retryable` or `llm_error_terminal`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `split_in_progress` _(allowed; does not cancel in-flight call)_
  - `ABANDON` → `intake_abandoned`

- `split_proposed`
  - `CONFIRM_SPLIT` → `split_finalized`
  - `MERGE_ISSUES/EDIT_ISSUE/ADD_ISSUE` → `split_proposed`
  - `REJECT_SPLIT` → `split_finalized`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `split_proposed` _(allowed)_
  - `ABANDON` → `intake_abandoned`

- `split_finalized`
  - _(system)_ `START_CLASSIFICATION` → `classification_in_progress`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `split_finalized` _(allowed; attachment can be associated to resulting WOs)_
  - `ABANDON` → `intake_abandoned`

- `classification_in_progress`
  - _(system)_ `LLM_CLASSIFY_SUCCESS` → `needs_tenant_input` or `tenant_confirmation_pending`
  - _(system)_ `LLM_FAIL` → `llm_error_retryable` or `llm_error_terminal`
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `classification_in_progress` _(allowed)_
  - `ABANDON` → `intake_abandoned`

- `needs_tenant_input`
  - `ANSWER_FOLLOWUPS` → `classification_in_progress`
  - `SUBMIT_ADDITIONAL_MESSAGE` → `needs_tenant_input` _(queue or treat as clarification per §12)_
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `needs_tenant_input` _(allowed)_
  - `ABANDON` → `intake_abandoned`

- `tenant_confirmation_pending`
  - `CONFIRM_SUBMISSION` → `submitted`
  - `SUBMIT_ADDITIONAL_MESSAGE` → `tenant_confirmation_pending` _(queue; do not alter current submission unless tenant cancels)_
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `tenant_confirmation_pending` _(allowed)_
  - `ABANDON` → `intake_abandoned`

- `submitted`
  - `SUBMIT_INITIAL_MESSAGE` → start new intake cycle (new conversation or new cycle_id)
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `submitted` _(allowed; must attach to a specific WO via WO detail context)_
  - `RESUME` → `submitted`

- `llm_error_retryable`
  - _(system)_ `RETRY_LLM` → prior in-progress state
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `llm_error_retryable` _(allowed)_
  - `RESUME` → retry or show “try again”
  - `ABANDON` → `intake_abandoned`

- `llm_error_terminal`
  - `RESUME` → new intake cycle or “submit for human triage”
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `llm_error_terminal` _(allowed; attaches to triage stub if created)_
  - `ABANDON` → `intake_abandoned`

- `intake_abandoned`
  - `RESUME` → last active state (if not expired)
  - `UPLOAD_PHOTO_INIT/COMPLETE` → `intake_abandoned` _(allowed; draft attachments)_
  - _(system)_ `EXPIRE` → `intake_expired`

- `intake_expired`
  - `CREATE_CONVERSATION` → `intake_started`

**Photo attachment rules**:

- During intake: photos are stored as conversation draft attachments and later linked to created WOs (all WOs in the group by default unless tenant chooses specific issue mapping).
- After submission: photo uploads require a target `work_order_id` (from WO detail screen).

---

## 12) Draft discovery, additional message policy, and in-flight abandonment

### 12.1 Draft discovery endpoint

`GET /conversations/drafts` returns resumable drafts for tenant_user_id with states:  
`unit_selection_required, split_proposed, classification_in_progress, needs_tenant_input, tenant_confirmation_pending, llm_error_retryable, intake_abandoned`  
Order by `last_activity_at`, show up to 3.  
**Resumed conversations retain pinned versions.**

### 12.2 New issue during follow-ups (policy)

When in `needs_tenant_input` or `tenant_confirmation_pending`:

- If tenant sends free text (`SUBMIT_ADDITIONAL_MESSAGE`), determine whether it is clarification or a new issue.
- If new issue: queue it; finish current flow; offer immediate next intake using queued text after submission.

### 12.3 In-flight LLM call abandonment + artifact staleness

- Store LLM results even if tenant left.
- Artifacts expire by:
  - **Unseen artifacts** (never presented): expire after 60 minutes always.
  - **Seen artifacts**: stale if source hash changed, split hash changed, or age > 60 minutes AND borderline confidence.

---

## 13) Splitting

- Split first; classifier cannot run until split finalized.
- Split confirmation supports accept/merge/edit/add/reject.
- Tenant edit/add validation:
  - max 500 chars per issue
  - max 10 issues per conversation
  - sanitize input (strip control chars, escape HTML, normalize whitespace)

---

## 14) Classification, cue dictionaries, and confidence

### 14.1 Classification output

Taxonomy enums + confidence_by_field + missing_fields[].

### 14.2 Category gating error path

Contradictory outputs trigger one constrained retry, then human triage flag.

### 14.3 Confidence heuristic (MVP recipe)

Per field:
`conf = clamp01( 0.40*cue_strength + 0.25*completeness + 0.20*model_hint - 0.10*disagreement - 0.05*ambiguity_penalty )`

Model hint clamped to [0.2, 0.95] and scaled.

Threshold bands:

- High ≥ 0.85 accept
- Medium 0.65–0.84 ask if required/risk relevant
- Low < 0.65 must ask (unless not applicable)

**Bands are provisional**: validate and tune on Gold Set B before pilot launch.

### 14.4 Classification cue dictionaries (required artifact)

Add `packages/schemas/classification_cues.json` defining per-field keyword/regex cues used to compute `cue_strength`.

Minimal structure:

```json
{
  "version": "1.0.0",
  "fields": {
    "maintenance_category": {
      "plumbing": { "keywords": ["leak", "toilet", "sink", "drain"], "regex": [] },
      "electrical": { "keywords": ["breaker", "outlet", "switch", "sparks"], "regex": [] }
    },
    "maintenance_object": {
      "toilet": { "keywords": ["toilet", "wc"], "regex": [] }
    }
  }
}
```

Cue scoring rule:

- keyword hits and regex matches contribute to a normalized 0..1 score per candidate label; take the top score for `cue_strength`.

---

## 15) Follow-ups

- FollowUpGenerator input contract is strict and minimal.
- Output: max 3 questions per turn, each maps to one field, quick replies preferred.
- Termination caps: 8 turns, 9 questions, max 2 re-asks per field.
- Escape hatch: create WO with `needs_human_triage` if still incomplete.

Follow-ups must be recorded in `followup_events` with the schema in §7.1.

---

## 16) Tenant confirmation gate + staleness

- Tenant must confirm summary + key labels + risk confirmations before side effects.
- If tenant returns after >60 minutes at confirmation, run staleness check; re-run and re-confirm if stale.

---

## 17) Risk protocols + emergency router

- Deterministic trigger grammar: keyword_any / regex_any / taxonomy_path_any / requires_confirmation.
- Confirm emergency via yes/no before routing.
- Emergency router executes per-building chain; logs attempts.
- Exhaustion sets escalation_state=exhausted, triggers internal secondary alert, provides safe tenant message, optional retries.

---

## 18) Concurrency, idempotency, and atomicity

- Idempotency keys for WO creation and notifications.
- Multi-WO creation is one DB transaction.
- Optimistic locking with row_version.
- Work orders independent post-creation; no group status stored.

---

## 19) Photos

- Photo schema includes sha256, scanned_status, storage_key.
- Presigned upload flow: init → direct upload → complete.
- Scanning is async; block PM visibility until clean.
- Attachment timing:
  - during intake (conversation attachments linked to WOs upon submission)
  - after submission (must target a work_order_id)

---

## 20) Notifications

- In-app + outbound SMS only.
- Preferences + SMS consent tracked; default SMS off until consent implemented.
- Batching: multi-issue creation sends one “created” notification.
- Deduping via idempotency + cooldown.

---

## 21) Tenant-copyable record bundle

- Minimal contents defined (created time, unit, summary, urgency basis, actions, status history, comms, schedule, resolution).
- Export endpoint returns JSON first; PDF later.

---

## 22) SLA policies (MVP compute + report only)

- SLA policy schema supports client defaults and taxonomy-path overrides.
- MVP computes SLA metadata and exposes in analytics/record bundle; no automated paging.

---

## 23) Mock ERP adapter

ERPAdapter interface:

- createWorkOrder
- getWorkOrderStatus
- syncUpdates
- healthCheck

Mock returns EXT-uuid and simulates transitions via polling or test endpoint.

---

## 24) API surface and payload mapping rule

### 24.1 Endpoints

Conversations:

- POST /conversations
- GET /conversations/:id
- GET /conversations/drafts
- POST /conversations/:id/select-unit
- POST /conversations/:id/message/initial
- POST /conversations/:id/message/additional
- POST /conversations/:id/split/confirm
- POST /conversations/:id/split/merge
- POST /conversations/:id/split/edit
- POST /conversations/:id/split/add
- POST /conversations/:id/split/reject
- POST /conversations/:id/followups/answer
- POST /conversations/:id/confirm-submission
- POST /conversations/:id/resume

Work orders:

- GET /work-orders
- GET /work-orders/:id
- GET /work-orders/:id/record-bundle

Photos:

- POST /photos/init
- POST /photos/complete

Notifications:

- GET /notifications
- POST /notifications/prefs

Overrides (minimal):

- POST /overrides
- GET /analytics

### 24.2 Payload schema rule (authoritative)

Every endpoint request body maps directly to `OrchestratorActionRequest.tenant_input` for its action type, and returns `OrchestratorActionResponse`.

---

## 25) Observability

- Structured JSON logs with request_id, ids, action, state, latency, error codes.
- Metrics: LLM latency/errors, state durations, abandonment rate, escalation exhaustion, notification failures, schema failures.
- Health checks: /health, /health/db, /health/llm, /health/storage, /health/notifications
- Alerts: escalation exhausted, LLM error spike, schema failures spike, async backlog.

---

## 26) Evaluation + deployment gates

- Gold sets A/B/C.
- Human override loop stored as events with reason codes.
- Versions pinned per conversation; CI gates prompt/model changes; canary + rollback.

---

## 27) Repo structure and governance

Recommended tree:

- AGENTS.md, PLANS.md
- apps/web
- packages/schemas
- packages/core
- packages/evals
- packages/adapters/mock
- docs
- CI workflow

AGENTS.md must include non-negotiables, commands, plan-first, TDD, taxonomy governance.

---

## 28) Build sequence (implementation-safe)

1. Schemas + validators + config objects
2. Auth/session scaffolding + conversation state machine (incl abandon/expire/error)
3. Orchestrator implementation + endpoint stubs + event append pattern
4. Splitter + split confirmation UI flows + tests
5. Classifier + **classification_cues.json** + category gating retry + confidence heuristic + tests
6. Follow-up generator + termination caps + followup_events + tests
7. Tenant confirmation UI + staleness checks
8. Transactional WO creation + idempotency + optimistic locking
9. Risk protocols + mitigation templates + emergency router + exhaustion path
10. Notifications (batch/dedupe/prefs/consent)
11. Record bundle export (JSON)
12. Mock ERP adapter + simulated status updates
13. Analytics slicing endpoints + dashboards (MVP-lite)

---

## 29) Required artifacts to create first (complete list)

In `packages/schemas/`:

- `taxonomy.json` (verbatim)
- `orchestrator_action.schema.json`
- `issue_split.schema.json`
- `work_order.schema.json`
- `followup_request.schema.json`
- `followups.schema.json`
- `risk_protocols.json`
- `emergency_escalation_plans.json`
- `sla_policies.json`
- `photo.schema.json`
- `classification_cues.json` (required for confidence cue_strength)

In `docs/`:

- `security-boundaries.md` (LLM sandbox, AuthZ, isolation)
- `retention-policy.md`
- `rfcs/` (taxonomy governance)

---

### Final authority order (implementation rule)

If anything is ambiguous, follow this precedence:

1. Transition matrix (§11.2)
2. Orchestrator contract (§10)
3. Rate limits/payload caps (§8)
4. Non-negotiables (§2)
5. Remaining sections in document order
