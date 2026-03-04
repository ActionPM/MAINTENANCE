-- 005-idempotency-keys.sql
-- Idempotency store for deduplicating WO creation (spec §18).
-- Atomic reserve-then-complete protocol using INSERT ON CONFLICT.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key              TEXT PRIMARY KEY,
  work_order_ids   UUID[] NOT NULL DEFAULT '{}',
  completed        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
