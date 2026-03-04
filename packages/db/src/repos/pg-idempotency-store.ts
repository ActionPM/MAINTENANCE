import type { Pool } from '@neondatabase/serverless';
import type { IdempotencyStore, IdempotencyRecord, ReservationResult } from '@wo-agent/core';

/**
 * PostgreSQL idempotency store using INSERT ON CONFLICT for atomic reserve.
 * This implements the reserve-then-complete protocol from spec §18.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async tryReserve(key: string): Promise<ReservationResult> {
    // Attempt atomic insert. If key exists, the ON CONFLICT clause does nothing
    // and we detect it via rowCount.
    const result = await this.pool.query(
      `INSERT INTO idempotency_keys (key, work_order_ids, completed)
       VALUES ($1, '{}', false)
       ON CONFLICT (key) DO NOTHING`,
      [key],
    );

    if (result.rowCount === 1) {
      return { reserved: true };
    }

    // Key already exists — fetch the existing record
    const existing = await this.get(key);
    return {
      reserved: false,
      existing: existing ?? { work_order_ids: [] },
    };
  }

  async complete(key: string, record: IdempotencyRecord): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_keys
       SET work_order_ids = $1, completed = true
       WHERE key = $2 AND completed = false`,
      [[...record.work_order_ids], key],
    );
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      'SELECT work_order_ids FROM idempotency_keys WHERE key = $1 AND completed = true',
      [key],
    );
    if (result.rows.length === 0) return null;
    return { work_order_ids: result.rows[0].work_order_ids as string[] };
  }
}
