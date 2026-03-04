import { describe, it, expect, beforeEach } from 'vitest';
import { assembleRecordBundle } from '../../record-bundle/record-bundle-assembler.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryNotificationStore } from '../../notifications/in-memory-notification-store.js';
import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import type { RecordBundleDeps } from '../../record-bundle/types.js';

describe('assembleRecordBundle', () => {
  let workOrderRepo: InMemoryWorkOrderStore;
  let notificationRepo: InMemoryNotificationStore;
  let deps: RecordBundleDeps;

  const NOW = '2026-03-04T12:00:00.000Z';

  const SLA_POLICIES = {
    version: '1.0.0',
    client_defaults: {
      emergency: { response_hours: 1, resolution_hours: 24 },
      high: { response_hours: 4, resolution_hours: 48 },
      normal: { response_hours: 24, resolution_hours: 168 },
      low: { response_hours: 48, resolution_hours: 336 },
    },
    overrides: [],
  };

  beforeEach(() => {
    workOrderRepo = new InMemoryWorkOrderStore();
    notificationRepo = new InMemoryNotificationStore();
    deps = {
      workOrderRepo,
      notificationRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => NOW,
    };
  });

  function makeWorkOrder(overrides?: Partial<WorkOrder>): WorkOrder {
    return {
      work_order_id: 'wo-1',
      conversation_id: 'conv-1',
      issue_group_id: 'group-1',
      issue_id: 'issue-1',
      client_id: 'client-1',
      property_id: 'prop-1',
      unit_id: 'unit-1',
      tenant_user_id: 'tenant-1',
      tenant_account_id: 'account-1',
      status: WorkOrderStatus.CREATED,
      status_history: [
        { status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00.000Z', actor: ActorType.SYSTEM },
      ],
      raw_text: 'My faucet leaks',
      summary_confirmed: 'Leaky faucet in kitchen',
      photos: [],
      classification: { Category: 'maintenance', Priority: 'normal' },
      confidence_by_field: { Category: 0.9, Priority: 0.8 },
      missing_fields: [],
      pets_present: 'unknown',
      needs_human_triage: false,
      pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
      row_version: 1,
      ...overrides,
    } as WorkOrder;
  }

  function makeNotification(overrides?: Partial<NotificationEvent>): NotificationEvent {
    return {
      event_id: 'notif-evt-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'tenant-1',
      tenant_account_id: 'account-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1'],
      issue_group_id: 'group-1',
      template_id: 'wo_created_in_app',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: { message: 'Your service request has been submitted.' },
      created_at: '2026-03-04T00:01:00.000Z',
      sent_at: '2026-03-04T00:01:00.000Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
      ...overrides,
    } as NotificationEvent;
  }

  it('returns null when WO not found', async () => {
    const result = await assembleRecordBundle('nonexistent', deps);
    expect(result).toBeNull();
  });

  it('assembles a complete record bundle', async () => {
    const wo = makeWorkOrder();
    await workOrderRepo.insertBatch([wo]);
    await notificationRepo.insert(makeNotification());

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle).not.toBeNull();
    expect(bundle!.work_order_id).toBe('wo-1');
    expect(bundle!.conversation_id).toBe('conv-1');
    expect(bundle!.created_at).toBe('2026-03-04T00:00:00.000Z');
    expect(bundle!.unit_id).toBe('unit-1');
    expect(bundle!.summary).toBe('Leaky faucet in kitchen');
    expect(bundle!.classification).toEqual({ Category: 'maintenance', Priority: 'normal' });
    expect(bundle!.urgency_basis).toEqual({ has_emergency: false, highest_severity: null, trigger_ids: [] });
    expect(bundle!.status_history).toEqual(wo.status_history);
    expect(bundle!.communications).toHaveLength(1);
    expect(bundle!.communications[0].notification_id).toBe('notif-1');
    expect(bundle!.communications[0].channel).toBe('in_app');
    expect(bundle!.schedule.priority).toBe('normal');
    expect(bundle!.schedule.response_hours).toBe(24);
    expect(bundle!.resolution).toEqual({ resolved: false, final_status: 'created', resolved_at: null });
    expect(bundle!.exported_at).toBe(NOW);
  });

  it('handles WO with risk_flags', async () => {
    const wo = makeWorkOrder({
      risk_flags: {
        trigger_ids: ['flood-1'],
        highest_severity: 'high',
        has_emergency: false,
      },
    });
    await workOrderRepo.insertBatch([wo]);

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle!.urgency_basis.trigger_ids).toEqual(['flood-1']);
    expect(bundle!.urgency_basis.highest_severity).toBe('high');
    expect(bundle!.urgency_basis.has_emergency).toBe(false);
  });

  it('handles resolved WO', async () => {
    const wo = makeWorkOrder({
      status: WorkOrderStatus.RESOLVED,
      status_history: [
        { status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00.000Z', actor: ActorType.SYSTEM },
        { status: WorkOrderStatus.ACTION_REQUIRED, changed_at: '2026-03-04T01:00:00.000Z', actor: ActorType.SYSTEM },
        { status: WorkOrderStatus.RESOLVED, changed_at: '2026-03-04T10:00:00.000Z', actor: ActorType.PM_USER },
      ],
    });
    await workOrderRepo.insertBatch([wo]);

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle!.resolution.resolved).toBe(true);
    expect(bundle!.resolution.final_status).toBe('resolved');
    expect(bundle!.resolution.resolved_at).toBe('2026-03-04T10:00:00.000Z');
  });

  it('assembles with zero notifications', async () => {
    await workOrderRepo.insertBatch([makeWorkOrder()]);

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle!.communications).toEqual([]);
  });
});
