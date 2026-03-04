-- 002-notification-events.sql
-- Append-only notification event table (spec §7, §20). INSERT + SELECT only.

CREATE TABLE IF NOT EXISTS notification_events (
  event_id           UUID PRIMARY KEY,
  notification_id    UUID NOT NULL,
  conversation_id    UUID NOT NULL,
  tenant_user_id     UUID NOT NULL,
  tenant_account_id  UUID NOT NULL,
  channel            TEXT NOT NULL,
  notification_type  TEXT NOT NULL,
  work_order_ids     UUID[] NOT NULL DEFAULT '{}',
  issue_group_id     UUID,
  template_id        TEXT NOT NULL,
  status             TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL UNIQUE,
  payload            JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at            TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  failed_at          TIMESTAMPTZ,
  failure_reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_notif_events_tenant_user
  ON notification_events (tenant_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_events_conversation
  ON notification_events (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_events_tenant_type_created
  ON notification_events (tenant_user_id, notification_type, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'no_update_notification_events'
  ) THEN
    CREATE TRIGGER no_update_notification_events
      BEFORE UPDATE OR DELETE ON notification_events
      FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
  END IF;
END;
$$;
