import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresIdempotencyStore } from '../repos/pg-idempotency-store.js';

function createFakePool() {
  const fake = {
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    nextRowCount: 0,
    query: async (text: string, values?: unknown[]) => {
      fake.queries.push({ text, values: values ?? [] });
      return { rows: fake.nextRows, rowCount: fake.nextRowCount };
    },
    end: async () => {},
  };
  return fake;
}

describe('PostgresIdempotencyStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresIdempotencyStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresIdempotencyStore(pool as never);
  });

  it('tryReserve() uses INSERT ON CONFLICT', async () => {
    pool.nextRowCount = 1;
    pool.nextRows = [];
    const result = await store.tryReserve('key-1');
    expect(result.reserved).toBe(true);
    expect(pool.queries[0].text).toContain('INSERT INTO idempotency_keys');
    expect(pool.queries[0].text).toContain('ON CONFLICT');
  });

  it('complete() updates work_order_ids', async () => {
    pool.nextRowCount = 1;
    await store.complete('key-1', { work_order_ids: ['wo-1', 'wo-2'] });
    expect(pool.queries[0].text).toContain('UPDATE idempotency_keys');
    expect(pool.queries[0].text).toContain('completed = true');
  });

  it('get() returns null when no completed record', async () => {
    pool.nextRows = [];
    const result = await store.get('key-missing');
    expect(result).toBeNull();
  });
});
