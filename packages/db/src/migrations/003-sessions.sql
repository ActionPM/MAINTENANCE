-- 003-sessions.sql
-- Mutable session table. Stores JSON blob of ConversationSession.
-- Optimistic locking not needed here — session is only written by the
-- orchestrator within a single request, and the state machine prevents
-- concurrent transitions on the same conversation_id.

CREATE TABLE IF NOT EXISTS sessions (
  conversation_id  UUID PRIMARY KEY,
  tenant_user_id   UUID NOT NULL,
  state            TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user
  ON sessions (tenant_user_id);
