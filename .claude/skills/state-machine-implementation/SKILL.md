---
name: state-machine-implementation
description: Use when implementing or modifying conversation states, transitions, or orchestrator actions. Embeds the full authoritative transition matrix and enforces correctness on every state change.
---

# State Machine Implementation

You are modifying the conversation state machine for the **Service Request Intake & Triage Agent**. The transition matrix below is the highest-authority reference in the entire spec. Every transition you implement MUST match it exactly.

---

## Rule 1 — Two separate lifecycles. Never conflate them.

| Lifecycle              | Scope              | States                                                          | Owner        |
| ---------------------- | ------------------ | --------------------------------------------------------------- | ------------ |
| **Conversation state** | Intake flow (chat) | 14 states below                                                 | Orchestrator |
| **Work Order status**  | Post-submission    | `created → action_required → scheduled → resolved \| cancelled` | WO Service   |

Conversation state drives the intake chatbot. WO status drives what happens after submission. They are independent — a conversation reaching `submitted` creates WOs in status `created`, and the two lifecycles diverge from that point.

Do NOT store WO status on the conversation. Do NOT store conversation state on the work order.

---

## Rule 2 — The orchestrator is the ONLY component that transitions state

No endpoint handler, UI component, background job, or LLM tool may change conversation state directly. They submit actions to the orchestrator; the orchestrator validates the transition and applies it.

Pattern:

```
endpoint → validate request → build OrchestratorActionRequest → orchestrator.dispatch(action)
orchestrator: validate transition(currentState, action) → apply → write event → return response
```

---

## Complete State List

### Core states (happy path)

```
intake_started
unit_selection_required
unit_selected
split_in_progress
split_proposed
split_finalized
classification_in_progress
needs_tenant_input
tenant_confirmation_pending
submitted
```

### Failure / recovery states

```
llm_error_retryable
llm_error_terminal
intake_abandoned
intake_expired
```

Every state must be represented in your state enum. No additional states may be invented without a spec amendment.

---

## Authoritative Transition Matrix (spec §11.2)

**This is the single source of truth. If your code allows a transition not listed here, it is a bug. If your code blocks a transition listed here, it is a bug.**

### `intake_started`

| Action                       | Target state              | Notes                                                |
| ---------------------------- | ------------------------- | ---------------------------------------------------- |
| `SELECT_UNIT`                | `unit_selected`           | If tenant has 1 unit, auto-resolve                   |
| `SELECT_UNIT`                | `unit_selection_required` | If tenant has multiple units                         |
| `SUBMIT_INITIAL_MESSAGE`     | `split_in_progress`       | **Only if unit already resolved** — reject otherwise |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `intake_started`          | Attaches to conversation draft                       |
| `RESUME`                     | `intake_started`          | No-op re-entry                                       |

### `unit_selection_required`

| Action                       | Target state              | Notes                             |
| ---------------------------- | ------------------------- | --------------------------------- |
| `SELECT_UNIT`                | `unit_selected`           | Tenant picks from authorized list |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `unit_selection_required` | Stored as draft attachments       |
| `ABANDON`                    | `intake_abandoned`        |                                   |

### `unit_selected`

| Action                       | Target state        | Notes                   |
| ---------------------------- | ------------------- | ----------------------- |
| `SUBMIT_INITIAL_MESSAGE`     | `split_in_progress` | Kicks off IssueSplitter |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `unit_selected`     |                         |
| `ABANDON`                    | `intake_abandoned`  |                         |

### `split_in_progress`

| Action                         | Target state          | Notes                                 |
| ------------------------------ | --------------------- | ------------------------------------- |
| _(system)_ `LLM_SPLIT_SUCCESS` | `split_proposed`      | Splitter returned valid result        |
| _(system)_ `LLM_FAIL`          | `llm_error_retryable` | Transient failure                     |
| _(system)_ `LLM_FAIL`          | `llm_error_terminal`  | Permanent failure (retries exhausted) |
| `UPLOAD_PHOTO_INIT/COMPLETE`   | `split_in_progress`   | Does NOT cancel in-flight LLM call    |
| `ABANDON`                      | `intake_abandoned`    |                                       |

### `split_proposed`

| Action                       | Target state       | Notes                                          |
| ---------------------------- | ------------------ | ---------------------------------------------- |
| `CONFIRM_SPLIT`              | `split_finalized`  | Tenant accepts the split as-is                 |
| `MERGE_ISSUES`               | `split_proposed`   | Stays in same state — re-renders updated split |
| `EDIT_ISSUE`                 | `split_proposed`   | Stays in same state                            |
| `ADD_ISSUE`                  | `split_proposed`   | Stays in same state                            |
| `REJECT_SPLIT`               | `split_finalized`  | Treats original message as single issue        |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `split_proposed`   |                                                |
| `ABANDON`                    | `intake_abandoned` |                                                |

### `split_finalized`

| Action                            | Target state                 | Notes                                         |
| --------------------------------- | ---------------------------- | --------------------------------------------- |
| _(system)_ `START_CLASSIFICATION` | `classification_in_progress` | Orchestrator auto-triggers after finalization |
| `UPLOAD_PHOTO_INIT/COMPLETE`      | `split_finalized`            |                                               |
| `ABANDON`                         | `intake_abandoned`           |                                               |

**Critical: Classification CANNOT start unless state === `split_finalized`.** This enforces non-negotiable #2 (split first).

### `classification_in_progress`

| Action                            | Target state                  | Notes                                             |
| --------------------------------- | ----------------------------- | ------------------------------------------------- |
| _(system)_ `LLM_CLASSIFY_SUCCESS` | `needs_tenant_input`          | Follow-ups needed (low/medium confidence fields)  |
| _(system)_ `LLM_CLASSIFY_SUCCESS` | `tenant_confirmation_pending` | All fields high confidence — skip to confirmation |
| _(system)_ `LLM_FAIL`             | `llm_error_retryable`         |                                                   |
| _(system)_ `LLM_FAIL`             | `llm_error_terminal`          |                                                   |
| `UPLOAD_PHOTO_INIT/COMPLETE`      | `classification_in_progress`  |                                                   |
| `ABANDON`                         | `intake_abandoned`            |                                                   |

### `needs_tenant_input`

| Action                       | Target state                 | Notes                                        |
| ---------------------------- | ---------------------------- | -------------------------------------------- |
| `ANSWER_FOLLOWUPS`           | `classification_in_progress` | **Re-classifies with new info** — loops back |
| `SUBMIT_ADDITIONAL_MESSAGE`  | `needs_tenant_input`         | Queue or treat as clarification per §12.2    |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `needs_tenant_input`         |                                              |
| `ABANDON`                    | `intake_abandoned`           |                                              |

### `tenant_confirmation_pending`

| Action                       | Target state                  | Notes                                     |
| ---------------------------- | ----------------------------- | ----------------------------------------- |
| `CONFIRM_SUBMISSION`         | `submitted`                   | **This is the only gate to side effects** |
| `SUBMIT_ADDITIONAL_MESSAGE`  | `tenant_confirmation_pending` | Queue; do not alter current submission    |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `tenant_confirmation_pending` |                                           |
| `ABANDON`                    | `intake_abandoned`            |                                           |

### `submitted`

| Action                       | Target state                  | Notes                                      |
| ---------------------------- | ----------------------------- | ------------------------------------------ |
| `SUBMIT_INITIAL_MESSAGE`     | _(new conversation or cycle)_ | Starts fresh intake                        |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `submitted`                   | **Must target a specific `work_order_id`** |
| `RESUME`                     | `submitted`                   | No-op                                      |

### `llm_error_retryable`

| Action                       | Target state                  | Notes                                                          |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------- |
| _(system)_ `RETRY_LLM`       | _(prior in-progress state)_   | Returns to `split_in_progress` or `classification_in_progress` |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `llm_error_retryable`         |                                                                |
| `RESUME`                     | _(retry or show "try again")_ |                                                                |
| `ABANDON`                    | `intake_abandoned`            |                                                                |

**Implementation note:** You must store `prior_state` when entering `llm_error_retryable` so `RETRY_LLM` knows where to return.

### `llm_error_terminal`

| Action                       | Target state                         | Notes                                  |
| ---------------------------- | ------------------------------------ | -------------------------------------- |
| `RESUME`                     | _(new intake cycle or human triage)_ | Offer "submit for human triage" option |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `llm_error_terminal`                 | Attaches to triage stub if created     |
| `ABANDON`                    | `intake_abandoned`                   |                                        |

### `intake_abandoned`

| Action                       | Target state          | Notes               |
| ---------------------------- | --------------------- | ------------------- |
| `RESUME`                     | _(last active state)_ | Only if not expired |
| `UPLOAD_PHOTO_INIT/COMPLETE` | `intake_abandoned`    | Draft attachments   |
| _(system)_ `EXPIRE`          | `intake_expired`      | System timer        |

**Implementation note:** You must store `last_active_state` when entering `intake_abandoned` so `RESUME` can restore.

### `intake_expired`

| Action                | Target state     | Notes                                |
| --------------------- | ---------------- | ------------------------------------ |
| `CREATE_CONVERSATION` | `intake_started` | Only valid action — must start fresh |

This is a terminal state. No RESUME, no photo attachment linkage to prior draft.

---

## Photo Upload Rules (applies to EVERY state)

`UPLOAD_PHOTO_INIT` and `UPLOAD_PHOTO_COMPLETE` are valid in **every** state. They never change the conversation state.

### Attachment semantics vary by phase:

| Phase                                            | Behavior                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **During intake** (any state before `submitted`) | Stored as conversation-level draft attachments. Linked to all created WOs upon submission (unless tenant maps to specific issues). |
| **After submission** (`submitted` state)         | Must target a specific `work_order_id` via WO detail context. Reject if no target WO specified.                                    |

### Enforcement in code:

```typescript
// Photo actions are always valid — but attachment target differs
if (action === 'UPLOAD_PHOTO_INIT' || action === 'UPLOAD_PHOTO_COMPLETE') {
  // State does NOT change
  // If state === 'submitted', require action.target_work_order_id
  // Otherwise, attach to conversation draft
  return { nextState: currentState, sideEffects: [attachPhoto(...)] };
}
```

---

## System-Only Transitions

These transitions are triggered by the orchestrator internally, not by tenant actions. No endpoint should accept these as action types from the client.

| System action          | Triggered when                            | Source state                                        | Target state                                          |
| ---------------------- | ----------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `LLM_SPLIT_SUCCESS`    | IssueSplitter returns valid result        | `split_in_progress`                                 | `split_proposed`                                      |
| `LLM_CLASSIFY_SUCCESS` | IssueClassifier returns valid result      | `classification_in_progress`                        | `needs_tenant_input` or `tenant_confirmation_pending` |
| `LLM_FAIL`             | LLM call fails (parse, schema, or domain) | `split_in_progress` or `classification_in_progress` | `llm_error_retryable` or `llm_error_terminal`         |
| `START_CLASSIFICATION` | Split finalized                           | `split_finalized`                                   | `classification_in_progress`                          |
| `RETRY_LLM`            | Retry triggered (auto or via RESUME)      | `llm_error_retryable`                               | prior in-progress state                               |
| `EXPIRE`               | Abandonment timer fires                   | `intake_abandoned`                                  | `intake_expired`                                      |

**Guard:** If a client-facing endpoint tries to submit `LLM_SPLIT_SUCCESS`, `START_CLASSIFICATION`, or any system action, reject with 403.

---

## LLM Error and Retry Path

### Flow:

```
LLM call initiated (split or classify)
  ├─ success → validate output → LLM_SPLIT_SUCCESS or LLM_CLASSIFY_SUCCESS
  ├─ output invalid → retry(1x) with error context
  │   ├─ retry success → validate → success path
  │   └─ retry fail → LLM_FAIL
  ├─ transient error (timeout, 5xx) → LLM_FAIL → llm_error_retryable
  └─ permanent error (bad prompt, model refusal) → LLM_FAIL → llm_error_terminal
```

### Retryable vs terminal — decision criteria:

- **Retryable**: network timeout, rate limit, transient 5xx, schema validation failure on first attempt
- **Terminal**: model content refusal, repeated schema failures after retry, unrecoverable parse error, retries exhausted (implementation-defined max, suggest 2)

### State restoration on retry:

- Store `prior_state` and `prior_action_context` when entering `llm_error_retryable`
- `RETRY_LLM` restores to `prior_state` and re-executes the LLM call with same inputs
- If retry also fails → evaluate again: retryable or terminal

### Tenant experience during errors:

- `llm_error_retryable`: show "Something went wrong. Trying again..." or "Tap to retry"
- `llm_error_terminal`: show "We couldn't process this automatically. You can submit for our team to review, or start a new request."

---

## Abandon and Expire Semantics

### ABANDON

- Valid from: `unit_selection_required`, `unit_selected`, `split_in_progress`, `split_proposed`, `split_finalized`, `classification_in_progress`, `needs_tenant_input`, `tenant_confirmation_pending`, `llm_error_retryable`, `llm_error_terminal`
- NOT valid from: `intake_started` (use navigation away / session timeout instead), `submitted` (already done), `intake_expired` (already terminal)
- Trigger: system-generated when tenant navigates away or session times out
- Stores: `last_active_state`, `last_activity_at`, all in-progress artifacts

### RESUME from abandoned

- Restores to `last_active_state` if conversation has not expired
- If expired → reject RESUME, only `CREATE_CONVERSATION` allowed
- Resumed conversations **retain pinned versions** (`taxonomy_version`, `schema_version`, `model_id`, `prompt_version`)

### EXPIRE

- System-only transition from `intake_abandoned` → `intake_expired`
- Triggered by configurable timer (implementation-defined; spec does not prescribe duration)
- After expiry: conversation is read-only; tenant must start fresh

### Draft discovery (resumable states)

`GET /conversations/drafts` returns conversations in these states:

```
unit_selection_required
split_proposed
classification_in_progress
needs_tenant_input
tenant_confirmation_pending
llm_error_retryable
intake_abandoned
```

Ordered by `last_activity_at`, max 3 shown.

---

## Additional Message Policy (spec §12.2)

When tenant sends `SUBMIT_ADDITIONAL_MESSAGE` during:

### `needs_tenant_input`

- Determine if the message is **clarification** (relates to current follow-up questions) or a **new issue**
- If clarification: treat as part of current follow-up context
- If new issue: **queue it**, finish current flow, offer immediate next intake after submission

### `tenant_confirmation_pending`

- Queue the message; do NOT alter the current submission
- After confirmation and submission, check queue and offer next intake

**Key rule:** additional messages never change conversation state in these two states.

---

## Staleness Rules (spec §12.3)

When a tenant resumes a conversation, check artifact staleness before presenting them:

| Artifact type                          | Stale when                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| **Unseen** (never presented to tenant) | Age > 60 minutes — always stale                                                         |
| **Seen** (previously presented)        | Source hash changed, OR split hash changed, OR (age > 60 min AND borderline confidence) |

If stale: re-run the LLM step that produced the artifact (re-split or re-classify), then re-present. The conversation returns to the appropriate in-progress state for that step.

Store LLM results even if the tenant left mid-flight — they may still be fresh on resume.

---

## Implementation Checklist

For every transition you implement or modify:

```
[ ] Transition exists in the matrix above (exact source state → action → target state)
[ ] Invalid actions for the current state return a typed error (not silently ignored)
[ ] System-only actions are rejected from client-facing endpoints
[ ] Photo uploads are handled (valid in every state, state unchanged)
[ ] State change is written as an append-only event in conversation_events
[ ] prior_state is stored when entering llm_error_retryable or intake_abandoned
[ ] RESUME checks expiry before restoring state
[ ] Pinned versions are preserved on resume (never silently upgraded)
[ ] Staleness is checked when presenting previously-computed artifacts
[ ] SUBMIT_ADDITIONAL_MESSAGE in needs_tenant_input / tenant_confirmation_pending follows queue policy
[ ] Test exists for the valid transition
[ ] Test exists that rejects the action from at least one invalid state
```
