import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresWorkOrderStore } from '../repos/pg-wo-store.js';

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

function makeWo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    work_order_id: 'wo-1',
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'c-1',
    client_id: 'cl-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-04T00:00:00Z', actor: 'system' }],
    raw_text: 'leaky faucet',
    summary_confirmed: 'Leaky faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'no' as const,
    needs_human_triage: false,
    pinned_versions: {
      taxonomy_version: '1.0',
      schema_version: '1.0',
      model_id: 'm1',
      prompt_version: '1.0',
    },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

describe('PostgresWorkOrderStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresWorkOrderStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresWorkOrderStore(pool as never);
  });

  it('insertBatch() wraps multiple WOs in a transaction', async () => {
    const wo1 = makeWo({ work_order_id: 'wo-1' });
    const wo2 = makeWo({ work_order_id: 'wo-2' });
    await store.insertBatch([wo1, wo2] as never);

    const texts = pool.queries.map((q) => q.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts.filter((t) => t.includes('INSERT INTO work_orders')).length).toBe(2);
    expect(texts[texts.length - 1]).toBe('COMMIT');
  });

  it('getById() returns null when no rows', async () => {
    pool.nextRows = [];
    const result = await store.getById('wo-missing');
    expect(result).toBeNull();
  });

  it('updateStatus() uses optimistic locking', async () => {
    pool.nextRowCount = 1;
    pool.nextRows = [
      {
        ...makeWo(),
        row_version: 2,
        status: 'action_required',
        status_history: [],
        updated_at: new Date(),
      },
    ];

    await store.updateStatus('wo-1', 'action_required', 'system', '2026-03-04T01:00:00Z', 1);

    const updateQuery = pool.queries.find((q) => q.text.includes('UPDATE work_orders'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.text).toContain('row_version = $');
    expect(updateQuery!.text).toContain('row_version + 1');
  });

  it('updateStatus() throws on version mismatch', async () => {
    pool.nextRowCount = 0;
    pool.nextRows = [];

    await expect(
      store.updateStatus('wo-1', 'action_required', 'system', '2026-03-04T01:00:00Z', 1),
    ).rejects.toThrow('Version mismatch');
  });

  it('listAll() builds dynamic WHERE from filters', async () => {
    pool.nextRows = [];
    await store.listAll({ client_id: 'cl-1', from: '2026-01-01T00:00:00Z' });

    const query = pool.queries.find((q) => q.text.includes('SELECT'));
    expect(query!.text).toContain('client_id');
    expect(query!.text).toContain('created_at >=');
  });

  it('listAll() returns empty when unit_ids is empty array (deny-all)', async () => {
    pool.nextRows = [makeWo()];
    const result = await store.listAll({ unit_ids: [] });
    expect(result).toEqual([]);
    // Should not even hit the database
    expect(pool.queries.length).toBe(0);
  });
});
