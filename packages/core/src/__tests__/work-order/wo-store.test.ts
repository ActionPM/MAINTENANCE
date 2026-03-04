import { describe, it, expect } from 'vitest';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import type { WorkOrder } from '@wo-agent/schemas';

const makeWO = (overrides?: Partial<WorkOrder>): WorkOrder => ({
  work_order_id: 'wo-1',
  issue_group_id: 'ig-1',
  issue_id: 'iss-1',
  conversation_id: 'conv-1',
  client_id: 'client-1',
  property_id: 'prop-1',
  unit_id: 'unit-1',
  tenant_user_id: 'tu-1',
  tenant_account_id: 'ta-1',
  status: 'created',
  status_history: [{ status: 'created', changed_at: '2026-03-03T12:00:00Z', actor: 'system' }],
  raw_text: 'Leaky faucet',
  summary_confirmed: 'Kitchen faucet dripping',
  photos: [],
  classification: { category: 'plumbing' },
  confidence_by_field: { category: 0.92 },
  missing_fields: [],
  pets_present: 'unknown',
  needs_human_triage: false,
  pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  created_at: '2026-03-03T12:00:00Z',
  updated_at: '2026-03-03T12:00:00Z',
  row_version: 1,
  ...overrides,
});

describe('InMemoryWorkOrderStore', () => {
  it('inserts and retrieves a work order by ID', async () => {
    const store = new InMemoryWorkOrderStore();
    const wo = makeWO();
    await store.insertBatch([wo]);
    const retrieved = await store.getById('wo-1');
    expect(retrieved).toEqual(wo);
  });

  it('inserts multiple WOs atomically (batch)', async () => {
    const store = new InMemoryWorkOrderStore();
    const wos = [
      makeWO({ work_order_id: 'wo-1', issue_id: 'iss-1' }),
      makeWO({ work_order_id: 'wo-2', issue_id: 'iss-2' }),
    ];
    await store.insertBatch(wos);
    expect(await store.getById('wo-1')).toBeTruthy();
    expect(await store.getById('wo-2')).toBeTruthy();
  });

  it('retrieves WOs by issue_group_id', async () => {
    const store = new InMemoryWorkOrderStore();
    const wos = [
      makeWO({ work_order_id: 'wo-1', issue_group_id: 'ig-1' }),
      makeWO({ work_order_id: 'wo-2', issue_group_id: 'ig-1' }),
      makeWO({ work_order_id: 'wo-3', issue_group_id: 'ig-2' }),
    ];
    await store.insertBatch(wos);
    const group = await store.getByIssueGroup('ig-1');
    expect(group).toHaveLength(2);
  });

  it('rejects duplicate work_order_id', async () => {
    const store = new InMemoryWorkOrderStore();
    await store.insertBatch([makeWO()]);
    await expect(store.insertBatch([makeWO()])).rejects.toThrow(/duplicate/i);
  });

  it('returns null for unknown work_order_id', async () => {
    const store = new InMemoryWorkOrderStore();
    expect(await store.getById('nope')).toBeNull();
  });
});
