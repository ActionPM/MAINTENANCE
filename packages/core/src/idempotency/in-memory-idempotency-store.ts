import type { IdempotencyStore, IdempotencyRecord } from './types.js';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    if (!this.store.has(key)) {
      this.store.set(key, record);
    }
  }
}
