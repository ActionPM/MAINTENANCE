-- 006-notification-preferences.sql
-- Mutable notification preferences per tenant account (spec §20).

CREATE TABLE IF NOT EXISTS notification_preferences (
  preference_id               UUID PRIMARY KEY,
  tenant_account_id           TEXT NOT NULL UNIQUE,
  in_app_enabled              BOOLEAN NOT NULL DEFAULT true,
  sms_enabled                 BOOLEAN NOT NULL DEFAULT false,
  sms_consent                 JSONB,
  notification_type_overrides JSONB NOT NULL DEFAULT '{}',
  cooldown_minutes            INTEGER NOT NULL DEFAULT 30,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
