import { describe, it, expect } from 'vitest';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

describe('InMemoryIdempotencyStore', () => {
  it('returns null for unseen key', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get('key-1')).toBeNull();
  });

  it('stores and retrieves a result by key', async () => {
    const store = new InMemoryIdempotencyStore();
    const result = { work_order_ids: ['wo-1'] };
    await store.set('key-1', result);
    expect(await store.get('key-1')).toEqual(result);
  });

  it('does not overwrite an existing key (set is idempotent)', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('key-1', { work_order_ids: ['wo-1'] });
    await store.set('key-1', { work_order_ids: ['wo-2'] }); // should NOT overwrite
    const stored = await store.get('key-1');
    expect(stored).toEqual({ work_order_ids: ['wo-1'] });
  });

  it('stores different keys independently', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('key-1', { work_order_ids: ['wo-1'] });
    await store.set('key-2', { work_order_ids: ['wo-2'] });
    expect(await store.get('key-1')).toEqual({ work_order_ids: ['wo-1'] });
    expect(await store.get('key-2')).toEqual({ work_order_ids: ['wo-2'] });
  });
});
