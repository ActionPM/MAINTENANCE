---
name: schema-first-development
description: Use when creating any new module, endpoint, or data structure in this project. Enforces non-negotiables, authority order, and JSON Schema validation on all model outputs and orchestrator actions.
---

# Schema-First Development

You are working on the **Service Request Intake & Triage Agent**. Every piece of code you write must satisfy the constraints below. Do not proceed past any gate that fails.

---

## Gate 0 — Identify what you are building

Before writing any code, answer these questions:

1. **What data does this touch?** (schema name, field names, event table)
2. **Does a JSON Schema already exist for it?** Check `packages/schemas/`.
3. **What orchestrator action type does this serve?** (See action list below.)
4. **Where does this sit in the build sequence?** (Phase 1–13 — confirm prerequisites are done.)

If you cannot answer all four, stop and resolve before writing code.

---

## Gate 1 — Schema exists before code

**Rule: No implementation code without a schema to validate against.**

- New data structure → write or update its JSON Schema in `packages/schemas/` FIRST.
- New endpoint → confirm `orchestrator_action.schema.json` covers the action type's `tenant_input` shape.
- New LLM tool output → confirm the tool's output schema exists and the validation pipeline is wired.
- New event → confirm the event schema exists and the append-only event table is defined.

Checklist before writing implementation:

- [ ] JSON Schema file exists in `packages/schemas/`
- [ ] A TypeScript type is generated from or aligned to that schema
- [ ] A validator function exists that calls `validate(data, schema)` and returns typed errors
- [ ] A test exists that passes valid data and rejects invalid data through the validator

---

## Gate 2 — Non-Negotiables (spec §2)

Every module, endpoint, and data structure must satisfy ALL seven. Violations are build-blocking.

### 1. Taxonomy is authoritative

- Category values MUST come from `packages/schemas/taxonomy.json`.
- Never define category enums inline. Import them from the taxonomy.
- If you need a new category, that is a taxonomy RFC (`docs/rfcs/`), not a code change.

### 2. Split first — never classify until split is finalized

- The orchestrator MUST reject `START_CLASSIFICATION` unless conversation state === `split_finalized`.
- No shortcut paths. No "simple single-issue skip." Split always runs.

### 3. Schema-lock all model outputs

- Every LLM response follows this pipeline:

```
LLM call → JSON.parse() → schemaValidate() → domainValidate() → accept
                ↓ fail           ↓ fail              ↓ fail
             retry(1x)        retry(1x)      needs_human_triage
```

- Parse failure: retry with tighter prompt (1x).
- Schema failure: retry with error context injected (1x).
- Domain failure (e.g., contradictory category gating): one constrained retry, then flag `needs_human_triage` and store conflicting outputs in audit events.
- **Never accept unvalidated output. Never skip validation for "simple" responses.**

### 4. No side effects without tenant confirmation

- Work order creation, notifications, and escalation triggers happen ONLY after `CONFIRM_SUBMISSION`.
- If you are writing a side-effect function, it MUST check that the conversation state is `submitted` or that the action is `CONFIRM_SUBMISSION`.

### 5. Unit/property derived from membership

- Server derives authorized units from `auth_context.tenant_user_id`.
- `unit_id` and `property_id` are NEVER accepted from request bodies as truth.
- If the tenant has multiple units, force `unit_selection_required` state.

### 6. Append-only events

- Event tables: `conversation_events`, `classification_events`, `followup_events`, `work_order_events`, `risk_events`, `notification_events`, `human_override_events`.
- App role: INSERT + SELECT only. No UPDATE, no DELETE.
- Corrections append a new event; the effective value is the latest approved event.
- If you find yourself writing an UPDATE on an event table, STOP — you are violating immutability.

### 7. Emergency escalation is deterministic

- The LLM may suggest risk; deterministic code confirms and routes.
- Emergency triggers use a grammar: `keyword_any`, `regex_any`, `taxonomy_path_any`, `requires_confirmation`.
- Confirm emergency via yes/no before routing.
- Never let the LLM call the emergency router directly.

---

## Gate 3 — Orchestrator is the only controller (spec §10)

No other component may:

- Transition conversation state
- Call LLM tools (IssueSplitter, IssueClassifier, FollowUpGenerator)
- Create work orders
- Send notifications
- Trigger emergency router
- Write events

If you are building a module that does any of the above, it MUST be called by the orchestrator — never invoked directly by an endpoint handler or UI component.

### Orchestrator action types (MVP)

```
CREATE_CONVERSATION    SELECT_UNIT             SUBMIT_INITIAL_MESSAGE
SUBMIT_ADDITIONAL_MESSAGE   CONFIRM_SPLIT      MERGE_ISSUES
EDIT_ISSUE             ADD_ISSUE               REJECT_SPLIT
ANSWER_FOLLOWUPS       CONFIRM_SUBMISSION      UPLOAD_PHOTO_INIT
UPLOAD_PHOTO_COMPLETE  RESUME                  ABANDON
```

### Endpoint → Action mapping rule

Every endpoint request body maps directly to `OrchestratorActionRequest.tenant_input` for its action type. Every endpoint returns `OrchestratorActionResponse`. No exceptions.

---

## Gate 4 — Validate transitions against the state machine (spec §11.2)

Before implementing any action handler:

1. Open the transition matrix in spec §11.2.
2. Confirm the action is valid for the current state.
3. Confirm the target state is correct.
4. Write a test for the valid transition AND a test that rejects the action from an invalid state.

Key rules to remember:

- `SUBMIT_INITIAL_MESSAGE` requires unit already resolved.
- `ANSWER_FOLLOWUPS` returns to `classification_in_progress` (re-classifies with new info).
- `REJECT_SPLIT` goes to `split_finalized` (treats original as single issue).
- `UPLOAD_PHOTO_INIT/COMPLETE` is valid in every state and does not change state.
- `intake_expired` can only transition via `CREATE_CONVERSATION`.

---

## Gate 5 — Version pinning and idempotency

### Version pinning

Every conversation pins on creation: `taxonomy_version`, `schema_version`, `model_id`, `prompt_version`.
Resumed conversations retain their pinned versions. Never silently upgrade mid-conversation.

### Idempotency

Every side-effect action requires an `idempotency_key` in the request. The orchestrator must:

- Check for duplicate key before executing
- Return the cached response for duplicates
- Store the key with the result

### Optimistic locking

Mutable tables use `row_version`. On update: `WHERE row_version = expected` → if 0 rows affected, return conflict error.

---

## Authority Order — When Anything Is Ambiguous

If the spec seems to conflict with itself, resolve using this precedence (highest first):

1. **Transition matrix** (spec §11.2)
2. **Orchestrator contract** (spec §10)
3. **Rate limits / payload caps** (spec §8)
4. **Non-negotiables** (spec §2)
5. **Remaining spec sections** in document order

---

## Quick-Reference: The Schema-First Checklist

Use this for every new piece of work:

```
[ ] Schema exists in packages/schemas/ (or I am creating it now)
[ ] Validator function exists and is tested (valid + invalid cases)
[ ] TypeScript type is aligned to the schema
[ ] Orchestrator is the caller (not endpoint handler directly)
[ ] State transition is valid per §11.2 and tested both ways
[ ] No free-text categories — all values from taxonomy.json
[ ] No side effects before tenant confirmation
[ ] Event writes are INSERT-only
[ ] Idempotency key present for side-effect actions
[ ] Version pins respected (not silently upgraded)
[ ] Rate limits enforced at middleware layer
```

If any box is unchecked, fix it before moving on.
