/**
 * Stored result for an idempotency key.
 * When a CONFIRM_SUBMISSION with the same key is retried,
 * return this instead of creating duplicate WOs (spec §18).
 */
export interface IdempotencyRecord {
  readonly work_order_ids: readonly string[];
}

/**
 * Idempotency store. Production: PostgreSQL row with TTL.
 * Testing: in-memory Map.
 */
export interface IdempotencyStore {
  /** Get existing result for key. Returns null if unseen. */
  get(key: string): Promise<IdempotencyRecord | null>;
  /** Store result. No-op if key already exists (first-write-wins). */
  set(key: string, record: IdempotencyRecord): Promise<void>;
}
