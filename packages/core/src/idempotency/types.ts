/**
 * Stored result for an idempotency key.
 * When a CONFIRM_SUBMISSION with the same key is retried,
 * return this instead of creating duplicate WOs (spec §18).
 */
export interface IdempotencyRecord {
  readonly work_order_ids: readonly string[];
}

/**
 * Result of attempting to reserve an idempotency key.
 * - reserved: true  → key was unclaimed, caller now owns it and should proceed with WO creation
 * - reserved: false → key was already claimed; existing record is returned for replay
 */
export type ReservationResult =
  | { readonly reserved: true }
  | { readonly reserved: false; readonly existing: IdempotencyRecord };

/**
 * Idempotency store with atomic reserve-then-complete protocol.
 *
 * Usage:
 *   1. tryReserve(key) — atomically claim the key
 *   2. If reserved: create WOs, then complete(key, record)
 *   3. If not reserved: return existing.work_order_ids as cached replay
 *
 * Production: PostgreSQL row with INSERT … ON CONFLICT.
 * Testing: in-memory Map.
 */
export interface IdempotencyStore {
  /** Atomically reserve a key. Returns existing record if already claimed. */
  tryReserve(key: string): Promise<ReservationResult>;
  /** Fill in the WO IDs after successful creation. Only valid after a successful reserve. */
  complete(key: string, record: IdempotencyRecord): Promise<void>;
  /** Get existing result for key. Returns null if unseen or reserved-but-incomplete. */
  get(key: string): Promise<IdempotencyRecord | null>;
}
