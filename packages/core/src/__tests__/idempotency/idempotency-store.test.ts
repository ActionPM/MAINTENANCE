import { describe, it, expect } from 'vitest';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

describe('InMemoryIdempotencyStore', () => {
  it('returns null for unseen key', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get('key-1')).toBeNull();
  });

  it('tryReserve succeeds on fresh key', async () => {
    const store = new InMemoryIdempotencyStore();
    const result = await store.tryReserve('key-1');
    expect(result.reserved).toBe(true);
  });

  it('tryReserve returns existing record on second attempt', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryReserve('key-1');
    await store.complete('key-1', { work_order_ids: ['wo-1'] });

    const result = await store.tryReserve('key-1');
    expect(result.reserved).toBe(false);
    if (!result.reserved) {
      expect(result.existing.work_order_ids).toEqual(['wo-1']);
    }
  });

  it('get returns null for reserved-but-incomplete key', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryReserve('key-1');
    // Reserved but not completed
    expect(await store.get('key-1')).toBeNull();
  });

  it('complete fills in WO IDs after reservation', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryReserve('key-1');
    await store.complete('key-1', { work_order_ids: ['wo-1'] });
    expect(await store.get('key-1')).toEqual({ work_order_ids: ['wo-1'] });
  });

  it('complete does not overwrite an already-completed key', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryReserve('key-1');
    await store.complete('key-1', { work_order_ids: ['wo-1'] });
    await store.complete('key-1', { work_order_ids: ['wo-WRONG'] });
    expect(await store.get('key-1')).toEqual({ work_order_ids: ['wo-1'] });
  });

  it('stores different keys independently', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.tryReserve('key-1');
    await store.complete('key-1', { work_order_ids: ['wo-1'] });
    await store.tryReserve('key-2');
    await store.complete('key-2', { work_order_ids: ['wo-2'] });
    expect(await store.get('key-1')).toEqual({ work_order_ids: ['wo-1'] });
    expect(await store.get('key-2')).toEqual({ work_order_ids: ['wo-2'] });
  });
});
