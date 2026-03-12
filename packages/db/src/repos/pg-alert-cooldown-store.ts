import type { Pool } from '@neondatabase/serverless';
import type { AlertCooldownStore } from '@wo-agent/core';

/**
 * Postgres-backed alert cooldown store.
 * Prevents duplicate alerts within a cooldown window.
 * Composite key: (alert_name, scope).
 */
export class PgAlertCooldownStore implements AlertCooldownStore {
  constructor(private readonly pool: Pool) {}

  async shouldAlert(alertName: string, scope: string, cooldownMinutes: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT last_alerted_at
       FROM alert_cooldowns
       WHERE alert_name = $1 AND scope = $2
         AND last_alerted_at > NOW() - INTERVAL '1 minute' * $3`,
      [alertName, scope, cooldownMinutes],
    );
    return result.rows.length === 0;
  }

  async recordAlert(alertName: string, scope: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO alert_cooldowns (alert_name, scope, last_alerted_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (alert_name, scope)
       DO UPDATE SET last_alerted_at = NOW()`,
      [alertName, scope],
    );
  }
}
