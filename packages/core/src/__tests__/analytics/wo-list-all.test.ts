import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import type { WorkOrder } from '@wo-agent/schemas';

function makeWO(overrides: Partial<WorkOrder> & { work_order_id: string }): WorkOrder {
  return {
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'conv-1',
    client_id: 'c-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('WorkOrderRepository.listAll (Phase 13)', () => {
  let store: InMemoryWorkOrderStore;

  beforeEach(() => {
    store = new InMemoryWorkOrderStore();
  });

  it('returns empty array when no WOs exist', async () => {
    const result = await store.listAll();
    expect(result).toEqual([]);
  });

  it('returns all WOs when no filters provided', async () => {
    await store.insertBatch([makeWO({ work_order_id: 'wo-1' }), makeWO({ work_order_id: 'wo-2' })]);
    const result = await store.listAll();
    expect(result).toHaveLength(2);
  });

  it('filters by client_id', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', client_id: 'c-1' }),
      makeWO({ work_order_id: 'wo-2', client_id: 'c-2' }),
    ]);
    const result = await store.listAll({ client_id: 'c-1' });
    expect(result).toHaveLength(1);
    expect(result[0]!.work_order_id).toBe('wo-1');
  });

  it('filters by property_id', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', property_id: 'p-1' }),
      makeWO({ work_order_id: 'wo-2', property_id: 'p-2' }),
    ]);
    const result = await store.listAll({ property_id: 'p-1' });
    expect(result).toHaveLength(1);
  });

  it('filters by unit_id', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', unit_id: 'u-1' }),
      makeWO({ work_order_id: 'wo-2', unit_id: 'u-2' }),
    ]);
    const result = await store.listAll({ unit_id: 'u-1' });
    expect(result).toHaveLength(1);
  });

  it('filters by time range (from inclusive, to exclusive)', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', created_at: '2026-01-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-2', created_at: '2026-02-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-3', created_at: '2026-03-15T00:00:00Z' }),
    ]);
    const result = await store.listAll({
      from: '2026-02-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.work_order_id).toBe('wo-2');
  });

  it('combines multiple filters', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', client_id: 'c-1', created_at: '2026-02-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-2', client_id: 'c-2', created_at: '2026-02-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-3', client_id: 'c-1', created_at: '2026-04-15T00:00:00Z' }),
    ]);
    const result = await store.listAll({
      client_id: 'c-1',
      from: '2026-01-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.work_order_id).toBe('wo-1');
  });
});
