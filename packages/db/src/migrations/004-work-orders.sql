-- 004-work-orders.sql
-- Mutable work order table with optimistic locking (spec §18).

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id    UUID PRIMARY KEY,
  issue_group_id   UUID NOT NULL,
  issue_id         UUID NOT NULL,
  conversation_id  UUID NOT NULL,
  client_id        TEXT NOT NULL,
  property_id      TEXT NOT NULL,
  unit_id          TEXT NOT NULL,
  tenant_user_id   TEXT NOT NULL,
  tenant_account_id TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'created',
  status_history   JSONB NOT NULL DEFAULT '[]',
  raw_text         TEXT NOT NULL,
  summary_confirmed TEXT NOT NULL,
  photos           JSONB NOT NULL DEFAULT '[]',
  classification   JSONB NOT NULL DEFAULT '{}',
  confidence_by_field JSONB NOT NULL DEFAULT '{}',
  missing_fields   JSONB NOT NULL DEFAULT '[]',
  pets_present     TEXT NOT NULL DEFAULT 'unknown',
  risk_flags       JSONB,
  needs_human_triage BOOLEAN NOT NULL DEFAULT false,
  pinned_versions  JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_wo_issue_group
  ON work_orders (issue_group_id);

CREATE INDEX IF NOT EXISTS idx_wo_unit
  ON work_orders (unit_id);

CREATE INDEX IF NOT EXISTS idx_wo_client
  ON work_orders (client_id);

CREATE INDEX IF NOT EXISTS idx_wo_created
  ON work_orders (created_at);
