-- Operational metrics table for spec §25 (S25-02)
-- Append-only: INSERT + SELECT only. No UPDATE, no DELETE.
CREATE TABLE IF NOT EXISTS operational_metrics (
  id              BIGSERIAL PRIMARY KEY,
  metric_name     TEXT NOT NULL,
  metric_value    DOUBLE PRECISION NOT NULL,
  component       TEXT NOT NULL,
  request_id      TEXT,
  conversation_id TEXT,
  action_type     TEXT,
  error_code      TEXT,
  tags_json       JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_om_name_created ON operational_metrics (metric_name, created_at);
CREATE INDEX IF NOT EXISTS idx_om_component_created ON operational_metrics (component, created_at);
