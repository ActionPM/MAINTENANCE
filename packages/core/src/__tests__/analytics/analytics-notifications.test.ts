import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: { normal: { response_hours: 24, resolution_hours: 168 } },
  overrides: [],
};

/** Seed a minimal WO so notification scoping can match on work_order_ids */
function makeWO(id: string): WorkOrder {
  return {
    work_order_id: id,
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
  };
}

function makeNotif(overrides: Partial<NotificationEvent> & { event_id: string; notification_id: string }): NotificationEvent {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    channel: 'in_app',
    notification_type: 'work_order_created',
    work_order_ids: ['wo-1'],
    issue_group_id: null,
    template_id: 'tpl-1',
    status: 'sent',
    idempotency_key: `idem-${overrides.event_id}`,
    payload: {},
    created_at: '2026-03-01T10:00:00Z',
    sent_at: '2026-03-01T10:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('AnalyticsService.computeNotificationMetrics (Phase 13)', () => {
  it('returns zeroes when no notifications exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });

    const result = await svc.compute({});
    expect(result.notifications.total_sent).toBe(0);
    expect(result.notifications.by_channel).toEqual({});
    expect(result.notifications.delivery_success_pct).toBe(0);
  });

  it('counts by channel and type', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([makeWO('wo-1')]);
    await notifRepo.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1', channel: 'in_app', notification_type: 'work_order_created' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2', channel: 'sms', notification_type: 'status_changed' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-3', notification_id: 'n-3', channel: 'in_app', notification_type: 'needs_input' }));

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.notifications.total_sent).toBe(3);
    expect(result.notifications.by_channel).toEqual({ in_app: 2, sms: 1 });
    expect(result.notifications.by_type).toEqual({ work_order_created: 1, status_changed: 1, needs_input: 1 });
  });

  it('computes delivery success percentage', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([makeWO('wo-1')]);
    await notifRepo.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1', status: 'delivered' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2', status: 'delivered' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-3', notification_id: 'n-3', status: 'sent' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-4', notification_id: 'n-4', status: 'failed' }));

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.notifications.total_sent).toBe(4);
    // delivered + sent = 3 success out of 4 total = 75%
    expect(result.notifications.delivery_success_pct).toBe(75);
  });
});
