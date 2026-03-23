import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { ERPSyncService } from '../../erp/erp-sync-service.js';
import { buildERPCreateEvent } from '../../erp/event-builder.js';

interface ERPRecord {
  ext_id: string;
  work_order_id: string;
  status: WorkOrderStatus;
  updated_at: string;
}

function makeWorkOrder(id: string): WorkOrder {
  return {
    work_order_id: id,
    issue_group_id: 'ig-1',
    issue_id: `issue-${id}`,
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
    raw_text: 'Test issue',
    summary_confirmed: 'Test issue summary',
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

describe('ERP integration (Phase 12)', () => {
  let woStore: InMemoryWorkOrderStore;
  let idCounter: number;
  const idGen = () => `gen-${++idCounter}`;
  const clock = () => '2026-03-04T10:00:00Z';

  beforeEach(() => {
    woStore = new InMemoryWorkOrderStore();
    idCounter = 0;
  });

  it('full flow: create WOs → register with ERP → advance → sync → verify', async () => {
    // 1. Create work orders locally
    const wo1 = makeWorkOrder('wo-1');
    const wo2 = makeWorkOrder('wo-2');
    await woStore.insertBatch([wo1, wo2]);

    // 2. Simulate ERP registration (inline mock adapter)
    const erpRecords = new Map<string, ERPRecord>();
    const statusChanges: Array<{
      ext_id: string;
      work_order_id: string;
      previous_status: WorkOrderStatus;
      new_status: WorkOrderStatus;
      updated_at: string;
    }> = [];

    const registerWithERP = (wo: WorkOrder): string => {
      const extId = `EXT-${wo.work_order_id}`;
      erpRecords.set(extId, {
        ext_id: extId,
        work_order_id: wo.work_order_id,
        status: wo.status,
        updated_at: wo.created_at,
      });
      return extId;
    };

    const extId1 = registerWithERP(wo1);
    const extId2 = registerWithERP(wo2);

    expect(extId1).toBe('EXT-wo-1');
    expect(extId2).toBe('EXT-wo-2');

    // 3. Simulate ERP status advancement
    const record1 = erpRecords.get(extId1)!;
    statusChanges.push({
      ext_id: extId1,
      work_order_id: record1.work_order_id,
      previous_status: record1.status,
      new_status: WorkOrderStatus.ACTION_REQUIRED,
      updated_at: '2026-03-04T05:00:00Z',
    });
    record1.status = WorkOrderStatus.ACTION_REQUIRED;

    // 4. Run sync service
    const fakeAdapter = {
      createWorkOrder: async () => ({ ext_id: 'unused' }),
      getWorkOrderStatus: async () => ({
        ext_id: 'unused',
        status: 'created' as WorkOrderStatus,
        updated_at: '',
      }),
      syncUpdates: async () => statusChanges,
      healthCheck: async () => ({ healthy: true }),
    };

    const syncService = new ERPSyncService({
      erpAdapter: fakeAdapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const syncResult = await syncService.sync('2026-03-04T00:00:00Z');

    // 5. Verify
    expect(syncResult.applied).toBe(1);
    expect(syncResult.failed).toBe(0);
    expect(syncResult.events).toHaveLength(1);
    expect(syncResult.events[0].event_type).toBe('status_changed');

    const updatedWo1 = await woStore.getById('wo-1');
    expect(updatedWo1?.status).toBe('action_required');
    expect(updatedWo1?.row_version).toBe(2);
    expect(updatedWo1?.status_history).toHaveLength(2);

    // wo-2 should be unchanged
    const unchangedWo2 = await woStore.getById('wo-2');
    expect(unchangedWo2?.status).toBe('created');
    expect(unchangedWo2?.row_version).toBe(1);
  });

  it('ERP event builders produce valid audit events', () => {
    const createEvent = buildERPCreateEvent({
      eventId: 'evt-1',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-wo-1',
      createdAt: '2026-03-04T00:00:00Z',
    });

    expect(createEvent.event_type).toBe('erp_create');
    expect(createEvent.ext_id).toBe('EXT-wo-1');
    expect(createEvent.work_order_id).toBe('wo-1');
    expect(createEvent.conversation_id).toBe('conv-1');
  });

  it('multiple status transitions applied in sequence', async () => {
    const wo = makeWorkOrder('wo-seq');
    await woStore.insertBatch([wo]);

    const updates = [
      {
        ext_id: 'EXT-seq',
        work_order_id: 'wo-seq',
        previous_status: WorkOrderStatus.CREATED,
        new_status: WorkOrderStatus.ACTION_REQUIRED,
        updated_at: '2026-03-04T01:00:00Z',
      },
      {
        ext_id: 'EXT-seq',
        work_order_id: 'wo-seq',
        previous_status: WorkOrderStatus.ACTION_REQUIRED,
        new_status: WorkOrderStatus.SCHEDULED,
        updated_at: '2026-03-04T02:00:00Z',
      },
      {
        ext_id: 'EXT-seq',
        work_order_id: 'wo-seq',
        previous_status: WorkOrderStatus.SCHEDULED,
        new_status: WorkOrderStatus.RESOLVED,
        updated_at: '2026-03-04T03:00:00Z',
      },
    ];

    const fakeAdapter = {
      createWorkOrder: async () => ({ ext_id: 'unused' }),
      getWorkOrderStatus: async () => ({
        ext_id: 'unused',
        status: 'created' as WorkOrderStatus,
        updated_at: '',
      }),
      syncUpdates: async () => updates,
      healthCheck: async () => ({ healthy: true }),
    };

    const syncService = new ERPSyncService({
      erpAdapter: fakeAdapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const result = await syncService.sync('2026-03-04T00:00:00Z');

    expect(result.applied).toBe(3);
    expect(result.events).toHaveLength(3);

    const final = await woStore.getById('wo-seq');
    expect(final?.status).toBe('resolved');
    expect(final?.row_version).toBe(4); // 1 + 3 updates
    expect(final?.status_history).toHaveLength(4);
  });
});
