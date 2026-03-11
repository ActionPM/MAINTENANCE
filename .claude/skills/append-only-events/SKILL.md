---
name: append-only-events
description: Use when writing any database migration, query, or data access code. Enforces INSERT+SELECT only on event tables, no UPDATE/DELETE, correction-as-new-event pattern, and the specific event table schemas from spec §7.
---

# Append-Only Events

You are writing database code for the **Service Request Intake & Triage Agent**. This project enforces strict immutability on all event tables. Every rule below is non-negotiable (spec §2, item 6; spec §7).

---

## Rule 1 — Know the two table categories

This project has two categories of database tables with different rules:

| Category                       | Allowed operations       | Locking                    | Examples                                           |
| ------------------------------ | ------------------------ | -------------------------- | -------------------------------------------------- |
| **Event tables** (append-only) | INSERT + SELECT only     | None (immutable rows)      | All 7 event tables below                           |
| **Mutable tables**             | INSERT + SELECT + UPDATE | Optimistic (`row_version`) | `conversations`, `work_orders`, `tenants`, `units` |

**If you are unsure which category a table belongs to: if it ends in `_events`, it is append-only. No exceptions.**

---

## Rule 2 — The seven event tables (complete list)

```
conversation_events
classification_events
followup_events
work_order_events
risk_events
notification_events
human_override_events
```

These are the ONLY event tables defined in the spec. Do not invent additional event tables without a spec amendment.

---

## Rule 3 — INSERT + SELECT only. No UPDATE. No DELETE. Ever.

### What this means in practice:

**In migrations:**

- Create a dedicated database role (e.g., `app_events_role`) with only INSERT + SELECT grants on event tables
- Never grant UPDATE or DELETE on any event table
- Add trigger guards as an extra safety net

```sql
-- Migration: Grant permissions for event tables
GRANT INSERT, SELECT ON conversation_events TO app_role;
GRANT INSERT, SELECT ON classification_events TO app_role;
GRANT INSERT, SELECT ON followup_events TO app_role;
GRANT INSERT, SELECT ON work_order_events TO app_role;
GRANT INSERT, SELECT ON risk_events TO app_role;
GRANT INSERT, SELECT ON notification_events TO app_role;
GRANT INSERT, SELECT ON human_override_events TO app_role;

-- NO UPDATE, NO DELETE granted. Omission is intentional.
```

**Trigger guard (recommended):**

```sql
-- Add to each event table as extra protection
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Event tables are append-only. UPDATE and DELETE are prohibited on %.', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_conversation_events_update
  BEFORE UPDATE OR DELETE ON conversation_events
  FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

-- Repeat for all 7 event tables
```

**In application code:**

- Repository/DAO layer for event tables exposes only two methods: `insert(event)` and `query(filters)`
- No `update()`, `delete()`, `upsert()`, or `save()` methods
- If you find yourself writing an UPDATE on an event table, STOP — you are violating immutability

**In query builders / ORMs:**

- If using an ORM, configure event table entities as insert-only (no update/delete hooks)
- Disable cascading deletes on any FK pointing to event tables
- Never use `ON DELETE CASCADE` or `ON UPDATE CASCADE` on event table references

---

## Rule 4 — Corrections are new events, never mutations

### The pattern:

When a classification, status, or any event-tracked value needs to change, you **append a new event** — you never update the old one.

```
Original:  classification_event { event_id: "ce-001", issue_id: "i-1", category: "plumbing", ... }
Correction: classification_event { event_id: "ce-002", issue_id: "i-1", category: "electrical",
              supersedes_event_id: "ce-001", correction_reason: "human_override", ... }
```

### Effective state resolution:

The **effective value** for any field is determined by the latest approved event for that entity:

```typescript
// Pattern: get effective classification for an issue
async function getEffectiveClassification(issueId: string): Promise<ClassificationEvent> {
  const events = await classificationEvents.query({
    issue_id: issueId,
    order_by: 'created_at DESC',
    limit: 1,
  });
  // Latest event wins — it may be an original or a correction
  return events[0];
}
```

### Human override events:

Human overrides follow the same pattern — they are events, not mutations:

```
human_override_event {
  event_id, conversation_id, issue_id,
  override_type: "classification" | "priority" | "category" | ...,
  original_event_id,       -- what is being overridden
  new_values: { ... },     -- the corrected values
  reason_code: string,     -- required: why the override happened
  overridden_by: user_id,  -- PM or admin who made the change
  created_at
}
```

Reason codes must be from a defined set (not free text). Define them in a schema or enum.

---

## Rule 5 — Common event fields (required on every event table)

Every event table MUST include these columns:

| Column            | Type        | Notes                                            |
| ----------------- | ----------- | ------------------------------------------------ |
| `event_id`        | UUID (PK)   | Generated server-side, never client-supplied     |
| `conversation_id` | UUID (FK)   | Links event to conversation                      |
| `created_at`      | TIMESTAMPTZ | Set server-side on INSERT, never client-supplied |

Additional common fields (include where applicable):
| Column | Type | Notes |
|--------|------|-------|
| `issue_id` | UUID | When event relates to a specific issue |
| `work_order_id` | UUID | When event relates to a specific WO |
| `actor` | ENUM | `tenant \| system \| agent \| pm_user` |
| `action_type` | STRING | The orchestrator action that produced this event |
| `idempotency_key` | STRING (UNIQUE) | For side-effect events — prevents duplicate writes |

**`event_id` and `created_at` are NEVER updatable.** They are set once on INSERT and immutable by both application logic and database grants.

---

## Rule 6 — Event table schemas

### `conversation_events`

Tracks every state transition, message, and action in a conversation.

```
event_id            UUID PK
conversation_id     UUID FK NOT NULL
event_type          TEXT NOT NULL   -- 'state_transition', 'message_received', 'action_executed', ...
prior_state         TEXT            -- conversation state before transition
new_state           TEXT            -- conversation state after transition
action_type         TEXT            -- orchestrator action that triggered this
actor               TEXT NOT NULL   -- tenant | system | agent | pm_user
payload             JSONB           -- action-specific data (message text, unit selection, etc.)
pinned_versions     JSONB           -- taxonomy_version, schema_version, model_id, prompt_version
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `classification_events`

Tracks every classification attempt and result.

```
event_id            UUID PK
conversation_id     UUID FK NOT NULL
issue_id            UUID NOT NULL
taxonomy_version    TEXT NOT NULL
classification      JSONB NOT NULL  -- taxonomy enums as classified
confidence_by_field JSONB NOT NULL  -- { field_name: confidence_score }
missing_fields      TEXT[]          -- fields that could not be determined
model_id            TEXT NOT NULL
prompt_version      TEXT NOT NULL
cue_scores          JSONB           -- per-field cue_strength from classification_cues.json
supersedes_event_id UUID            -- if this is a correction, points to the original
needs_human_triage  BOOLEAN NOT NULL DEFAULT false
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `followup_events` (spec §7.1 — minimum schema is authoritative)

```
event_id            UUID PK
conversation_id     UUID FK NOT NULL
issue_id            UUID NOT NULL
turn_number         INTEGER NOT NULL
questions_asked     JSONB NOT NULL
  -- array of: { question_id, field_target, prompt, options[], answer_type }
  -- answer_type: 'enum' | 'yes_no' | 'text'
answers_received    JSONB
  -- array of: { question_id, answer, received_at }
  -- NULL until tenant responds
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

Structure of `questions_asked` (each element):

```json
{
  "question_id": "string (UUID)",
  "field_target": "string (taxonomy field name)",
  "prompt": "string (question text shown to tenant)",
  "options": ["array of string choices"],
  "answer_type": "enum | yes_no | text"
}
```

Structure of `answers_received` (each element):

```json
{
  "question_id": "string (matches questions_asked.question_id)",
  "answer": "any (string for text/enum, boolean for yes_no)",
  "received_at": "ISO 8601 datetime"
}
```

### `work_order_events`

Tracks WO creation, status changes, and updates.

```
event_id            UUID PK
work_order_id       UUID FK NOT NULL
conversation_id     UUID FK NOT NULL
event_type          TEXT NOT NULL   -- 'created', 'status_changed', 'field_updated', 'photo_attached', ...
prior_status        TEXT            -- WO status before change
new_status          TEXT            -- WO status after change
actor               TEXT NOT NULL
payload             JSONB           -- event-specific data
idempotency_key     TEXT UNIQUE     -- required for creation and status change events
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `risk_events`

Tracks risk detection, mitigation display, and escalation attempts.

```
event_id            UUID PK
conversation_id     UUID FK NOT NULL
issue_id            UUID
event_type          TEXT NOT NULL   -- 'risk_detected', 'mitigation_shown', 'emergency_confirmed',
                                    --  'escalation_attempted', 'escalation_exhausted'
risk_flags          JSONB           -- which triggers fired
escalation_target   TEXT            -- contact in the chain being called
escalation_result   TEXT            -- 'answered', 'no_answer', 'voicemail', ...
escalation_state    TEXT            -- 'in_progress', 'answered', 'exhausted'
template_shown      TEXT            -- mitigation template ID shown to tenant
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `notification_events`

Tracks every notification sent or attempted.

```
event_id            UUID PK
conversation_id     UUID FK
work_order_id       UUID FK
notification_type   TEXT NOT NULL   -- 'in_app', 'sms'
event_type          TEXT NOT NULL   -- 'sent', 'delivered', 'failed', 'suppressed_dedup',
                                    --  'suppressed_consent', 'suppressed_cooldown'
recipient_user_id   UUID NOT NULL
payload             JSONB           -- message content, template ID, etc.
idempotency_key     TEXT UNIQUE
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `human_override_events`

Tracks PM/admin corrections with mandatory reason codes.

```
event_id            UUID PK
conversation_id     UUID FK NOT NULL
issue_id            UUID
work_order_id       UUID
override_type       TEXT NOT NULL   -- 'classification', 'priority', 'category', 'status', ...
original_event_id   UUID NOT NULL   -- the event being overridden
new_values          JSONB NOT NULL  -- the corrected values
reason_code         TEXT NOT NULL   -- from defined reason code enum, NOT free text
overridden_by       UUID NOT NULL   -- PM/admin user ID
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## Rule 7 — Mutable tables use optimistic locking

For tables that ARE mutable (conversations, work_orders, etc.):

```sql
-- Every mutable table includes:
row_version INTEGER NOT NULL DEFAULT 1
```

### Update pattern:

```sql
UPDATE work_orders
SET status = $1, row_version = row_version + 1
WHERE work_order_id = $2 AND row_version = $3
RETURNING row_version;
-- If 0 rows affected → concurrent modification → return conflict error
```

### In application code:

```typescript
const result = await db.query(
  `UPDATE work_orders SET status = $1, row_version = row_version + 1
   WHERE work_order_id = $2 AND row_version = $3 RETURNING row_version`,
  [newStatus, workOrderId, expectedRowVersion],
);
if (result.rowCount === 0) {
  throw new ConflictError('Work order was modified by another request');
}
```

**Never use `row_version` on event tables — they are immutable and do not need locking.**

---

## Rule 8 — Idempotency keys on side-effect events

Every event that represents a side effect (WO creation, notification sent, escalation attempt) MUST include an `idempotency_key`:

- Generated by the orchestrator before executing the side effect
- Stored as a UNIQUE constraint on the event table
- On duplicate key → return the cached/existing result, do not re-execute

```typescript
// Pattern: idempotent event write
async function writeEventIdempotent(table: string, event: EventWithKey): Promise<Event> {
  try {
    return await db.insert(table, event);
  } catch (error) {
    if (isUniqueViolation(error, 'idempotency_key')) {
      return await db.query(table, { idempotency_key: event.idempotency_key });
    }
    throw error;
  }
}
```

Side-effect events that require idempotency keys:

- `work_order_events` with `event_type = 'created'` or `'status_changed'`
- `notification_events` (all sends)
- `risk_events` with `event_type = 'escalation_attempted'`

---

## Rule 9 — Multi-WO creation is one transaction

When a conversation with multiple issues reaches `CONFIRM_SUBMISSION`, all work orders are created in a single database transaction:

```typescript
await db.transaction(async (tx) => {
  for (const issue of issues) {
    await tx.insert('work_orders', buildWorkOrder(issue, conversationContext));
    await tx.insert('work_order_events', {
      event_id: generateId(),
      work_order_id: issue.workOrderId,
      conversation_id: conversationId,
      event_type: 'created',
      new_status: 'created',
      actor: 'system',
      idempotency_key: `${conversationId}:wo-create:${issue.issue_id}`,
      created_at: new Date(),
    });
  }
  // Link draft photos to all created WOs
  await tx.query(linkDraftPhotosToWorkOrders(conversationId, issues));
});
// If any insert fails, entire transaction rolls back — no partial WO creation
```

---

## Migration Checklist

For every migration you write:

```
[ ] Event tables: INSERT + SELECT only (no UPDATE/DELETE grants)
[ ] Event tables: trigger guard added (BEFORE UPDATE OR DELETE → RAISE EXCEPTION)
[ ] Event tables: event_id is UUID PK, created_at is TIMESTAMPTZ DEFAULT now()
[ ] Event tables: no ON DELETE CASCADE / ON UPDATE CASCADE on FKs
[ ] Mutable tables: row_version INTEGER NOT NULL DEFAULT 1
[ ] Side-effect event columns include idempotency_key with UNIQUE constraint
[ ] No column defaults that silently mask missing required fields
```

## Query Checklist

For every query or data access function you write:

```
[ ] Event tables: only SELECT and INSERT — no UPDATE, DELETE, or UPSERT
[ ] Effective state: resolved by fetching latest event (ORDER BY created_at DESC LIMIT 1)
[ ] Corrections: use supersedes_event_id to chain, latest wins
[ ] Human overrides: query human_override_events, latest approved override wins
[ ] Mutable tables: UPDATE includes WHERE row_version = $expected
[ ] Idempotent writes: catch unique violation on idempotency_key, return existing row
[ ] Multi-WO creation: wrapped in a single transaction
```
