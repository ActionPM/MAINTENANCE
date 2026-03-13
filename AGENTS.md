# AGENTS.md

## Project: Service Request Intake & Triage Agent

### Source of Truth

| Artifact            | Canonical path                   | Mirrors / notes                                                                                           |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Build spec          | `docs/spec.md`                   | Root `SPEC.MD` is the original hand-off snapshot (frozen); `docs/spec.md` has all MVP deferral amendments |
| Schemas             | `packages/schemas/`              | All model outputs validate against these                                                                  |
| Taxonomy            | `packages/schemas/taxonomy.json` | `docs/taxonomy.json` is a convenience copy; always update the canonical path first                        |
| Plans               | `docs/plans/`                    | One directory, no root `PLANS.md` needed                                                                  |
| RFCs                | `docs/rfcs/`                     | Taxonomy governance and design proposals                                                                  |
| Security boundaries | `docs/security-boundaries.md`    | Trust zones, auth model, data isolation                                                                   |
| Retention policy    | `docs/retention-policy.md`       | Event retention, PII, session lifecycle                                                                   |
| This file           | `AGENTS.md`                      | Implementation guardrails — does NOT override the spec                                                    |

### Authority Order (when anything is ambiguous)

1. Transition matrix (spec §11.2)
2. Orchestrator contract (spec §10)
3. Rate limits / payload caps (spec §8)
4. Non-negotiables (spec §2)
5. Remaining spec sections in document order

---

## Non-Negotiables (spec §2 — memorize these)

1. **Taxonomy is authoritative** — no free-text categories, ever. Every category value must exist in `taxonomy.json`.
2. **Split first** — the classifier CANNOT run until split is finalized. Enforce in orchestrator: reject `START_CLASSIFICATION` unless state === `split_finalized`.
3. **Schema-lock all model outputs** — every LLM response is validated against its JSON Schema. Invalid → deterministic retry (1x) → fail safe. Never trust raw model output.
4. **No side effects without tenant confirmation** — WO creation, notifications, and escalation only happen after explicit confirmation: `CONFIRM_SUBMISSION` for work orders, `CONFIRM_EMERGENCY` for escalation (spec §17.1).
5. **Unit/property derived from membership** — server derives authorized units from `tenant_user_id`. Tenant cannot set `unit_id` or `property_id` directly.
6. **Append-only events** — event tables are INSERT + SELECT only. Corrections append new events; effective state is the latest approved event. No UPDATE, no DELETE.
7. **Emergency escalation is deterministic** — model suggests risk, deterministic code confirms and routes. Never let the LLM execute escalation directly.

---

## Tech Stack (locked)

- TypeScript / Node.js
- Next.js (UI + API routes)
- PostgreSQL
- pnpm workspaces
- JSON Schema validation for orchestrator actions, LLM I/O, and API DTO mapping
- Object storage for photos (presigned uploads)

---

## Build Sequence (mandatory order — spec §28)

Do NOT skip ahead. Each phase depends on the previous.

| Phase | What to build                                                                                  | Key artifacts                                       |
| ----- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1     | Schemas + validators + config objects                                                          | All `packages/schemas/*.json`, validators, taxonomy |
| 2     | Auth/session scaffolding + conversation state machine (incl. abandon/expire/error states)      | State machine, JWT auth, middleware                 |
| 3     | Orchestrator + endpoint stubs + event append pattern                                           | `OrchestratorActionRequest/Response`, event writers |
| 4     | Splitter + split confirmation UI flows + tests                                                 | `IssueSplitter` tool, split actions                 |
| 5     | Classifier + `classification_cues.json` + category gating retry + confidence heuristic + tests | `IssueClassifier` tool, cue dict, confidence calc   |
| 6     | Follow-up generator + termination caps + `followup_events` + tests                             | `FollowUpGenerator` tool                            |
| 7     | Tenant confirmation UI + staleness checks                                                      | Confirmation gate, staleness logic                  |
| 8     | Transactional WO creation + idempotency + work-order optimistic locking                        | WO service, `row_version`                           |
| 9     | Risk protocols + mitigation templates + emergency router + exhaustion path                     | Risk engine, emergency chain                        |
| 10    | Notifications (delivery path first; tenant history/prefs can follow)                           | Notification service                                |
| 11    | Record bundle export (JSON)                                                                    | Export endpoint                                     |
| 12    | Mock ERP adapter + simulated status updates                                                    | `ERPAdapter` interface + mock                       |
| 13    | Analytics slicing endpoints                                                                    | Analytics API                                       |

---

## Required Artifacts — Create First (spec §29)

### `packages/schemas/`

- [ ] `taxonomy.json` — verbatim authoritative taxonomy
- [ ] `orchestrator_action.schema.json` — action request/response
- [ ] `issue_split.schema.json`
- [ ] `work_order.schema.json`
- [ ] `followup_request.schema.json`
- [ ] `followups.schema.json`
- [ ] `risk_protocols.json`
- [ ] `emergency_escalation_plans.json`
- [ ] `sla_policies.json`
- [ ] `photo.schema.json`
- [ ] `classification_cues.json` — keyword/regex cues for confidence `cue_strength`

### `docs/`

- [ ] `security-boundaries.md`
- [ ] `retention-policy.md`
- [ ] `rfcs/` directory for taxonomy governance

---

## State Machine Rules (spec §11 — critical)

### Two separate lifecycles — never conflate them

- **Conversation state** (intake flow): `intake_started` → ... → `submitted`
- **Work Order status**: `created → action_required → scheduled → resolved | cancelled`

These are independent. Conversation state drives intake; WO status drives post-submission.

### Conversation states (complete list)

Core: `intake_started`, `unit_selection_required`, `unit_selected`, `split_in_progress`, `split_proposed`, `split_finalized`, `classification_in_progress`, `needs_tenant_input`, `tenant_confirmation_pending`, `submitted`

Failure/recovery: `llm_error_retryable`, `llm_error_terminal`, `intake_abandoned`, `intake_expired`

### Transition enforcement

- The orchestrator MUST validate every transition against the transition matrix (spec §11.2).
- Invalid transitions are rejected — never silently ignored.
- `UPLOAD_PHOTO_INIT/COMPLETE` is allowed in EVERY state (does not change state).
- `ABANDON` → `intake_abandoned` from most active states.
- `intake_expired` can ONLY go to `CREATE_CONVERSATION` (new conversation).

### Key gotchas

- `SUBMIT_INITIAL_MESSAGE` requires unit already resolved — otherwise force `unit_selection_required`.
- `ANSWER_FOLLOWUPS` goes back to `classification_in_progress` (re-classifies with new info).
- `REJECT_SPLIT` goes to `split_finalized` (not back to editing — treat original message as single issue).
- Photos during intake are conversation-level draft attachments; after submission they need a target `work_order_id`.

---

## Orchestrator Contract (spec §10)

### The orchestrator is the ONLY controller

No other component may:

- Transition conversation state
- Call LLM tools
- Create work orders
- Send notifications
- Trigger emergency router
- Write events

### Action types (MVP)

`CREATE_CONVERSATION`, `SELECT_UNIT`, `SUBMIT_INITIAL_MESSAGE`, `SUBMIT_ADDITIONAL_MESSAGE`, `CONFIRM_SPLIT`, `MERGE_ISSUES`, `EDIT_ISSUE`, `ADD_ISSUE`, `REJECT_SPLIT`, `ANSWER_FOLLOWUPS`, `CONFIRM_SUBMISSION`, `UPLOAD_PHOTO_INIT`, `UPLOAD_PHOTO_COMPLETE`, `RESUME`, `ABANDON`

### Every endpoint maps to one action type

Request body → `OrchestratorActionRequest.tenant_input` for that action type.
Response → `OrchestratorActionResponse` always.

---

## LLM Tool Contracts

### Three bounded tools

1. **IssueSplitter** — takes raw text, returns structured issue list
2. **IssueClassifier** — takes one issue, returns taxonomy enums + confidence
3. **FollowUpGenerator** — takes classification gaps, returns targeted questions

### Output validation pattern (use for ALL three)

```
LLM call → JSON parse → Schema validate → domain validate → accept or retry(1x) → fail safe
```

- Parse failure → retry with tighter prompt
- Schema failure → retry with error context
- Domain failure (e.g., contradictory category gating) → one constrained retry → `needs_human_triage`
- Never accept unvalidated output

### Version pinning

Every conversation pins: `taxonomy_version`, `schema_version`, `model_id`, `prompt_version`.
Resumed conversations keep their pinned versions even if newer exist.

---

## Classification Rules (spec §14)

### Confidence heuristic (per field)

```
conf = clamp01(0.40*cue_strength + 0.25*completeness + 0.20*model_hint - 0.10*disagreement - 0.05*ambiguity_penalty)
```

- Model hint clamped to [0.2, 0.95] before scaling

### Threshold bands

- High ≥ 0.85 → accept
- Medium 0.65–0.84 → ask if required or risk-relevant
- Low < 0.65 → must ask (unless field is not applicable)

### Category gating

If classifier returns contradictory fields (e.g., management category + maintenance fields):

1. One targeted retry with hard constraint
2. Still contradictory → `needs_human_triage`, store conflicting outputs in audit

---

## Follow-Up Rules (spec §15)

### Hard caps — enforce in code, not prompts

- Max 3 questions per turn
- Max 8 turns total
- Max 9 questions total
- Max 2 re-asks per field
- Each question maps to exactly one field

### Escape hatch

If caps exhausted and still incomplete → create WO with `needs_human_triage`, `missing_fields` preserved.

---

## Rate Limits (spec §8 — server-side enforcement)

| Limit                              | Default |
| ---------------------------------- | ------- |
| Messages per minute per user       | 10      |
| New conversations per day per user | 20      |
| Photo uploads per conversation     | 10      |
| Photo size                         | 10 MB   |
| Message chars                      | 8,000   |
| Issues per conversation            | 10      |
| Issue text chars                   | 500     |

- Enforce at API gateway/middleware
- Log violations as security events
- Return user-safe error messages

---

## Database Rules

### Event domains (append-only)

`conversation_events`, `classification_events`, `followup_events`, `work_order_events`, `risk_events`, `notification_events`, `human_override_events`

- These names define the logical event domains and payload contracts.
- Accepted MVP decision: physical storage may consolidate conversation-scoped domains into a generic append-only stream instead of seven separate tables.
- Even in the consolidated model, persisted rows must preserve domain identifiers such as `issue_id` and `work_order_id`.
- App role: INSERT + SELECT only — no UPDATE, no DELETE grants
- Optional trigger guards for extra safety
- Every event has an `event_id` and `created_at`

### Mutable tables

- Use `row_version` for optimistic locking on concurrency-sensitive mutable records, especially work orders
- Accepted MVP decision: conversation sessions may remain dispatcher-mediated last-write-wins instead of `row_version`/CAS
- Every side effect needs an `idempotency_key`
- Multi-WO creation in one DB transaction

---

## Staleness & Abandonment (spec §12)

### Artifact staleness rules

- **Unseen artifacts** (never presented to tenant): expire after 60 min always
- **Seen artifacts**: stale if source hash changed, split hash changed, OR (age > 60 min AND borderline confidence)

### Draft discovery

- `GET /conversations/drafts` returns resumable drafts
- Resumable states: `unit_selection_required`, `split_proposed`, `classification_in_progress`, `needs_tenant_input`, `tenant_confirmation_pending`, `llm_error_retryable`, `intake_abandoned`
- Max 3 shown, ordered by `last_activity_at`
- Resumed conversations retain pinned versions

### New issue during follow-ups

When tenant sends `SUBMIT_ADDITIONAL_MESSAGE` during `needs_tenant_input` or `tenant_confirmation_pending`:

- Determine if clarification or new issue
- If new: queue it, finish current flow, offer next intake after submission

---

## Emergency Escalation (spec §17)

### Per-building contact chain

Building Manager → Property Manager → Senior PM → fallback after-hours line

### Rules

- Deterministic trigger grammar: `keyword_any`, `regex_any`, `taxonomy_path_any`, `requires_confirmation`
- Always confirm emergency via yes/no BEFORE routing
- Call-until-answered behavior; log every attempt
- Exhaustion: set `escalation_state=exhausted`, trigger internal secondary alert, provide safe tenant message

---

## Repo Structure (spec §27)

```
AGENTS.md
docs/
  spec.md
  plans/
  security-boundaries.md
  retention-policy.md
  rfcs/
apps/web/
packages/
  schemas/
  core/
  evals/
  adapters/mock/
```

---

## Workflow Rules

### Skills

- `project-conventions` — **getting-started** (auto-loads every conversation). Stack, repo layout, naming, commands.
- `/schema-first-development` — **mandatory** before creating any new module, endpoint, or data structure. Enforces non-negotiables, authority order, and schema validation gates. Do not skip this.
- `/state-machine-implementation` — **mandatory** when implementing or modifying conversation states, transitions, or orchestrator actions. Contains the full authoritative transition matrix. Every transition must match it exactly.
- `/append-only-events` — **mandatory** when writing any database migration, query, or data access code. Enforces INSERT+SELECT only on event tables, correction-as-new-event pattern, and all 7 event table schemas.
- `/llm-tool-contracts` — **mandatory** when implementing IssueSplitter, IssueClassifier, or FollowUpGenerator. Contains full I/O contracts, the validation pipeline, confidence heuristic formula, cue dictionary scoring, and category gating error path.
- Use brainstorm skill before any creative/feature work

### Planning

- Always check for applicable skills before starting work
- Plans live in `docs/plans/`
- Follow the build sequence — do not skip phases

### Development

- **TDD**: write the failing test first, then implement
- Every schema change needs a validator and a test
- Every new endpoint needs request validation against the schema
- Every state transition needs a test (valid AND invalid transitions)

### Code patterns

- Orchestrator dispatches to per-action-type handlers. Each handler validates the transition, performs its work (including LLM calls, event persistence, notifications, and WO creation), and returns the new state + response. Side effects are executed inline within the handler, not deferred. The dispatcher is the sole entry point — no other component may transition state, call LLM tools, create work orders, send notifications, or write events.
- All LLM calls go through the validation pipeline (parse → schema → domain → accept/retry/fail)
- Never import LLM tools directly outside the orchestrator
- Use typed discriminated unions for action types

### Common mistakes to avoid

- Letting the LLM set `unit_id` or `property_id` — always derive from auth context
- Running classification before split is finalized — orchestrator must guard this
- Writing UPDATE/DELETE on event tables — only INSERT + SELECT
- Skipping schema validation on "simple" LLM responses — validate everything
- Conflating conversation state with WO status — they are independent lifecycles
- Allowing side effects before confirmation — WO creation/notifications require `CONFIRM_SUBMISSION`, escalation requires `CONFIRM_EMERGENCY`
- Hardcoding taxonomy values in application code — always read from `taxonomy.json`
- Forgetting idempotency keys on side-effect actions
- Accepting model confidence at face value — clamp to [0.2, 0.95] and blend with cue_strength
