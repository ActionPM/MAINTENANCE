-- 001-conversation-events.sql
-- Append-only event table (spec §7). INSERT + SELECT only.

CREATE TABLE IF NOT EXISTS conversation_events (
  event_id       UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  event_type     TEXT NOT NULL,
  prior_state    TEXT,
  new_state      TEXT,
  action_type    TEXT,
  actor          TEXT NOT NULL,
  payload        JSONB,
  pinned_versions JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_events_conversation
  ON conversation_events (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conv_events_type
  ON conversation_events (conversation_id, event_type);

-- Trigger guard: prevent UPDATE/DELETE on append-only table
CREATE OR REPLACE FUNCTION prevent_mutation()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'UPDATE/DELETE not allowed on append-only table %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'no_update_conversation_events'
  ) THEN
    CREATE TRIGGER no_update_conversation_events
      BEFORE UPDATE OR DELETE ON conversation_events
      FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
  END IF;
END;
$$;
