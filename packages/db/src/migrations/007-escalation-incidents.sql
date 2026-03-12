-- 007-escalation-incidents.sql
-- Durable escalation incident store for production emergency routing (plan §3.4).
-- Uses optimistic locking via row_version for concurrent ACCEPT handling.
-- This is a mutable store — justified because:
--   - Delayed retries need durable scheduling state
--   - Inbound SMS replies need idempotent claim handling
--   - Stand-down notifications need fast lookup of contacted numbers
--   - Reconstructing workflow state from append-only events on every webhook is impractical

CREATE TABLE IF NOT EXISTS escalation_incidents (
  incident_id              UUID        PRIMARY KEY,
  conversation_id          UUID        NOT NULL,
  building_id              TEXT        NOT NULL,
  plan_id                  TEXT        NOT NULL,
  summary                  TEXT        NOT NULL DEFAULT '',
  status                   TEXT        NOT NULL DEFAULT 'active',
  cycle_number             INTEGER     NOT NULL DEFAULT 1,
  max_cycles               INTEGER     NOT NULL DEFAULT 3,
  current_contact_index    INTEGER     NOT NULL DEFAULT 0,
  next_action_at           TIMESTAMPTZ NOT NULL,
  processing_lock_until    TIMESTAMPTZ,
  last_provider_action     TEXT,
  accepted_by_phone        TEXT,
  accepted_by_contact_id   TEXT,
  accepted_at              TIMESTAMPTZ,
  contacted_phone_numbers  TEXT[]      NOT NULL DEFAULT '{}',
  internal_alert_sent_cycles INTEGER[] NOT NULL DEFAULT '{}',
  attempts                 JSONB       NOT NULL DEFAULT '[]',
  row_version              INTEGER     NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query: getDueIncidents — find incidents ready for processing
CREATE INDEX IF NOT EXISTS idx_escalation_incidents_due
  ON escalation_incidents (next_action_at)
  WHERE status IN ('active', 'exhausted_retrying')
    AND (processing_lock_until IS NULL OR processing_lock_until < now());

-- Query: getActiveByConversation
CREATE INDEX IF NOT EXISTS idx_escalation_incidents_conversation
  ON escalation_incidents (conversation_id)
  WHERE status IN ('active', 'exhausted_retrying');

-- Constraint: at most one active incident per conversation (prevents TOCTOU race
-- in concurrent CONFIRM_EMERGENCY submissions — plan §5.1 idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS idx_escalation_incidents_one_active_per_convo
  ON escalation_incidents (conversation_id)
  WHERE status IN ('active', 'exhausted_retrying');

-- Query: getActiveByContactedPhone (GIN index on text array)
CREATE INDEX IF NOT EXISTS idx_escalation_incidents_phones
  ON escalation_incidents USING GIN (contacted_phone_numbers)
  WHERE status IN ('active', 'exhausted_retrying');
