import type { IdempotencyStore, IdempotencyRecord, ReservationResult } from './types.js';

/** Sentinel value indicating a key is reserved but WO creation hasn't completed yet. */
const RESERVED_SENTINEL: IdempotencyRecord = { work_order_ids: [] };

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();

  async tryReserve(key: string): Promise<ReservationResult> {
    const existing = this.store.get(key);
    if (existing) {
      // Key already claimed — return existing record for replay
      // (could be sentinel if prior reserve never completed, but that's the prior caller's problem)
      return existing === RESERVED_SENTINEL
        ? { reserved: false, existing }
        : { reserved: false, existing };
    }
    // Atomically claim the key with a sentinel
    this.store.set(key, RESERVED_SENTINEL);
    return { reserved: true };
  }

  async complete(key: string, record: IdempotencyRecord): Promise<void> {
    // Only overwrite the sentinel — if someone else already completed, keep theirs
    const existing = this.store.get(key);
    if (existing === RESERVED_SENTINEL) {
      this.store.set(key, record);
    }
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const record = this.store.get(key) ?? null;
    // Don't return incomplete reservations
    if (record === RESERVED_SENTINEL) {
      return null;
    }
    return record;
  }
}
