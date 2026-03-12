import type { Pool } from '@neondatabase/serverless';
import type { MetricsRecorder, MetricsQueryStore, MetricObservation } from '@wo-agent/core';

/**
 * Postgres-backed operational metrics store.
 * Implements both MetricsRecorder (write) and MetricsQueryStore (read).
 * Append-only: INSERT + SELECT only (spec §2.6).
 */
export class PgOperationalMetricsStore implements MetricsRecorder, MetricsQueryStore {
  constructor(private readonly pool: Pool) {}

  async record(obs: MetricObservation): Promise<void> {
    await this.pool.query(
      `INSERT INTO operational_metrics
        (metric_name, metric_value, component, request_id, conversation_id, action_type, error_code, tags_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        obs.metric_name,
        obs.metric_value,
        obs.component,
        obs.request_id ?? null,
        obs.conversation_id ?? null,
        obs.action_type ?? null,
        obs.error_code ?? null,
        obs.tags ? JSON.stringify(obs.tags) : '{}',
        obs.timestamp,
      ],
    );
  }

  async queryWindow(metricName: string, windowMinutes: number): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(metric_value), 0) AS total
       FROM operational_metrics
       WHERE metric_name = $1 AND created_at >= NOW() - INTERVAL '1 minute' * $2`,
      [metricName, windowMinutes],
    );
    return Number(result.rows[0].total);
  }

  async queryCount(metricName: string, windowMinutes: number): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) AS cnt
       FROM operational_metrics
       WHERE metric_name = $1 AND created_at >= NOW() - INTERVAL '1 minute' * $2`,
      [metricName, windowMinutes],
    );
    return Number(result.rows[0].cnt);
  }
}
