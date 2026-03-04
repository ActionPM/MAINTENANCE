import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { buildWorkOrderStatusChangedEvent } from '../../work-order/event-builder.js';

function makeWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    work_order_id: 'wo-1',
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [{ status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00Z', actor: ActorType.SYSTEM }],
    raw_text: 'Leaking faucet',
    summary_confirmed: 'Leaking faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

describe('WorkOrder status update (Phase 12)', () => {
  let store: InMemoryWorkOrderStore;

  beforeEach(() => {
    store = new InMemoryWorkOrderStore();
  });

  it('updates status, appends to status_history, bumps row_version', async () => {
    const wo = makeWorkOrder();
    await store.insertBatch([wo]);

    const updated = await store.updateStatus(
      'wo-1',
      WorkOrderStatus.ACTION_REQUIRED,
      ActorType.SYSTEM,
      '2026-03-04T01:00:00Z',
      1, // expectedVersion
    );

    expect(updated.status).toBe('action_required');
    expect(updated.status_history).toHaveLength(2);
    expect(updated.status_history[1]).toEqual({
      status: 'action_required',
      changed_at: '2026-03-04T01:00:00Z',
      actor: 'system',
    });
    expect(updated.row_version).toBe(2);
    expect(updated.updated_at).toBe('2026-03-04T01:00:00Z');
  });

  it('rejects on version mismatch (optimistic locking, spec §18)', async () => {
    const wo = makeWorkOrder();
    await store.insertBatch([wo]);

    await expect(
      store.updateStatus('wo-1', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T01:00:00Z', 999),
    ).rejects.toThrow('Version mismatch');
  });

  it('rejects on unknown work_order_id', async () => {
    await expect(
      store.updateStatus('nonexistent', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T01:00:00Z', 1),
    ).rejects.toThrow('not found');
  });

  it('persists update for subsequent getById', async () => {
    const wo = makeWorkOrder();
    await store.insertBatch([wo]);
    await store.updateStatus('wo-1', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T01:00:00Z', 1);

    const fetched = await store.getById('wo-1');
    expect(fetched?.status).toBe('action_required');
    expect(fetched?.row_version).toBe(2);
  });
});

describe('buildWorkOrderStatusChangedEvent (Phase 12)', () => {
  it('builds a status_changed event', () => {
    const event = buildWorkOrderStatusChangedEvent({
      eventId: 'evt-1',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      previousStatus: WorkOrderStatus.CREATED,
      newStatus: WorkOrderStatus.ACTION_REQUIRED,
      actor: ActorType.SYSTEM,
      createdAt: '2026-03-04T01:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.work_order_id).toBe('wo-1');
    expect(event.event_type).toBe('status_changed');
    expect(event.payload).toEqual({
      conversation_id: 'conv-1',
      previous_status: 'created',
      new_status: 'action_required',
      actor: 'system',
    });
  });
});
