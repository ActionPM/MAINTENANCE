import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { ERPSyncService } from '../../erp/erp-sync-service.js';
import type { ERPAdapter, ERPStatusUpdate } from '../../erp/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';

function makeWorkOrder(id: string = 'wo-1'): WorkOrder {
  return {
    work_order_id: id,
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [
      {
        status: WorkOrderStatus.CREATED,
        changed_at: '2026-03-04T00:00:00Z',
        actor: ActorType.SYSTEM,
      },
    ],
    raw_text: 'Leaking faucet',
    summary_confirmed: 'Leaking faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
  };
}

function makeFakeAdapter(updates: ERPStatusUpdate[]): ERPAdapter {
  return {
    createWorkOrder: async () => ({ ext_id: 'EXT-1' }),
    getWorkOrderStatus: async () => ({
      ext_id: 'EXT-1',
      status: 'created' as WorkOrderStatus,
      updated_at: '2026-03-04T00:00:00Z',
    }),
    syncUpdates: async () => updates,
    healthCheck: async () => ({ healthy: true }),
  };
}

describe('ERPSyncService (Phase 12)', () => {
  let woStore: InMemoryWorkOrderStore;
  let idCounter: number;
  const idGen = () => `gen-${++idCounter}`;
  const clock = () => '2026-03-04T02:00:00Z';

  beforeEach(() => {
    woStore = new InMemoryWorkOrderStore();
    idCounter = 0;
  });

  it('applies status updates from ERP sync to work orders', async () => {
    const wo = makeWorkOrder();
    await woStore.insertBatch([wo]);

    const updates: ERPStatusUpdate[] = [
      {
        ext_id: 'EXT-1',
        work_order_id: 'wo-1',
        previous_status: WorkOrderStatus.CREATED,
        new_status: WorkOrderStatus.ACTION_REQUIRED,
        updated_at: '2026-03-04T01:00:00Z',
      },
    ];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({
      erpAdapter: adapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const result = await service.sync('2026-03-04T00:00:00Z');

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);

    const updated = await woStore.getById('wo-1');
    expect(updated?.status).toBe('action_required');
    expect(updated?.row_version).toBe(2);
  });

  it('returns zero applied when no updates exist', async () => {
    const adapter = makeFakeAdapter([]);
    const service = new ERPSyncService({
      erpAdapter: adapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.applied).toBe(0);
  });

  it('skips updates for unknown work_order_ids without crashing', async () => {
    const updates: ERPStatusUpdate[] = [
      {
        ext_id: 'EXT-999',
        work_order_id: 'nonexistent',
        previous_status: WorkOrderStatus.CREATED,
        new_status: WorkOrderStatus.ACTION_REQUIRED,
        updated_at: '2026-03-04T01:00:00Z',
      },
    ];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({
      erpAdapter: adapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('handles version mismatch gracefully', async () => {
    const wo = makeWorkOrder();
    await woStore.insertBatch([wo]);

    // Simulate a concurrent modification by overriding updateStatus to throw
    const original = woStore.updateStatus.bind(woStore);
    woStore.updateStatus = async () => {
      throw new Error('Version mismatch: expected 1, got 2');
    };

    const updates: ERPStatusUpdate[] = [
      {
        ext_id: 'EXT-1',
        work_order_id: 'wo-1',
        previous_status: WorkOrderStatus.CREATED,
        new_status: WorkOrderStatus.ACTION_REQUIRED,
        updated_at: '2026-03-04T01:00:00Z',
      },
    ];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({
      erpAdapter: adapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    // Should not throw — just count as failed
    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.failed).toBe(1);
    expect(result.errors[0].reason).toContain('Version mismatch');

    // Restore original
    woStore.updateStatus = original;
  });

  it('builds WorkOrderEvent for each applied sync', async () => {
    const wo = makeWorkOrder();
    await woStore.insertBatch([wo]);

    const updates: ERPStatusUpdate[] = [
      {
        ext_id: 'EXT-1',
        work_order_id: 'wo-1',
        previous_status: WorkOrderStatus.CREATED,
        new_status: WorkOrderStatus.ACTION_REQUIRED,
        updated_at: '2026-03-04T01:00:00Z',
      },
    ];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({
      erpAdapter: adapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event_type).toBe('status_changed');
    expect(result.events[0].work_order_id).toBe('wo-1');
  });
});
