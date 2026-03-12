CREATE TABLE IF NOT EXISTS alert_cooldowns (
  alert_name       TEXT NOT NULL,
  scope            TEXT NOT NULL DEFAULT '_global',
  last_alerted_at  TIMESTAMPTZ NOT NULL,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  PRIMARY KEY (alert_name, scope)
);
