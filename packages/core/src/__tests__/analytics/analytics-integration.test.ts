import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    emergency: { response_hours: 1, resolution_hours: 24 },
    high: { response_hours: 4, resolution_hours: 48 },
    normal: { response_hours: 24, resolution_hours: 168 },
    low: { response_hours: 48, resolution_hours: 336 },
  },
  overrides: [
    { taxonomy_path: 'maintenance.plumbing.flood', response_hours: 1, resolution_hours: 12 },
  ],
};

const PINNED = { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' };

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
    status_history: [{ status: 'created', changed_at: '2026-02-15T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: PINNED,
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    row_version: 0,
    ...overrides,
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
    created_at: '2026-02-15T10:00:00Z',
    sent_at: '2026-02-15T10:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('Analytics integration (Phase 13)', () => {
  let woRepo: InMemoryWorkOrderStore;
  let notifRepo: InMemoryNotificationStore;
  let svc: AnalyticsService;

  beforeEach(async () => {
    woRepo = new InMemoryWorkOrderStore();
    notifRepo = new InMemoryNotificationStore();
    svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });

    // Seed realistic data
    await woRepo.insertBatch([
      // Plumbing emergency, resolved quickly — client c-1, property p-1
      makeWO({
        work_order_id: 'wo-1',
        client_id: 'c-1',
        property_id: 'p-1',
        status: 'resolved',
        status_history: [
          { status: 'created', changed_at: '2026-02-15T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-02-15T10:30:00Z', actor: 'system' },
          { status: 'resolved', changed_at: '2026-02-15T14:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Maintenance_Category: 'plumbing', Priority: 'high' },
        risk_flags: { has_emergency: true, highest_severity: 'emergency', trigger_ids: ['flood-001'] },
        created_at: '2026-02-15T10:00:00Z',
      }),
      // Electrical, still in progress — client c-1, property p-2
      makeWO({
        work_order_id: 'wo-2',
        client_id: 'c-1',
        property_id: 'p-2',
        status: 'action_required',
        status_history: [
          { status: 'created', changed_at: '2026-02-20T08:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-02-20T10:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Maintenance_Category: 'electrical', Priority: 'normal' },
        created_at: '2026-02-20T08:00:00Z',
      }),
      // Management issue, needs triage — client c-2
      makeWO({
        work_order_id: 'wo-3',
        client_id: 'c-2',
        property_id: 'p-3',
        status: 'created',
        classification: { Category: 'management', Management_Category: 'lease', Priority: 'low' },
        needs_human_triage: true,
        created_at: '2026-02-25T12:00:00Z',
      }),
    ]);

    await notifRepo.insert(makeNotif({
      event_id: 'ne-1', notification_id: 'n-1',
      channel: 'in_app', notification_type: 'work_order_created',
      status: 'delivered', work_order_ids: ['wo-1'],
      created_at: '2026-02-15T10:00:05Z',
    }));
    await notifRepo.insert(makeNotif({
      event_id: 'ne-2', notification_id: 'n-2',
      channel: 'sms', notification_type: 'status_changed',
      status: 'sent', work_order_ids: ['wo-1'],
      created_at: '2026-02-15T14:00:05Z',
    }));
    await notifRepo.insert(makeNotif({
      event_id: 'ne-3', notification_id: 'n-3',
      channel: 'in_app', notification_type: 'work_order_created',
      status: 'failed', work_order_ids: ['wo-2'],
      created_at: '2026-02-20T08:00:05Z',
    }));
  });

  it('full analytics response has correct structure', async () => {
    const result = await svc.compute({});

    expect(result.query).toEqual({});
    expect(result.generated_at).toBe('2026-03-04T12:00:00Z');

    // Overview
    expect(result.overview.total_work_orders).toBe(3);
    expect(result.overview.by_status).toEqual({ resolved: 1, action_required: 1, created: 1 });
    expect(result.overview.needs_human_triage).toBe(1);
    expect(result.overview.has_emergency).toBe(1);

    // Taxonomy
    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 2, management: 1 });
    expect(result.taxonomy_breakdown['Maintenance_Category']).toEqual({ plumbing: 1, electrical: 1 });
    expect(result.taxonomy_breakdown['Priority']).toEqual({ high: 1, normal: 1, low: 1 });

    // Notifications
    expect(result.notifications.total_sent).toBe(3);
    expect(result.notifications.by_channel).toEqual({ in_app: 2, sms: 1 });
    expect(result.notifications.delivery_success_pct).toBeCloseTo(66.67, 0);
  });

  it('client_id filter narrows results', async () => {
    const result = await svc.compute({ client_id: 'c-1' });
    expect(result.overview.total_work_orders).toBe(2);
    expect(result.overview.has_emergency).toBe(1);
    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 2 });
  });

  it('time range filter works', async () => {
    const result = await svc.compute({
      from: '2026-02-18T00:00:00Z',
      to: '2026-02-28T00:00:00Z',
    });
    // Only wo-2 (Feb 20) and wo-3 (Feb 25) in range
    expect(result.overview.total_work_orders).toBe(2);
  });

  it('SLA metrics compute correctly across mixed statuses', async () => {
    const result = await svc.compute({});

    // wo-1: response 0.5h (within 4h high SLA) ✓, resolution 4h (within 48h) ✓
    // wo-2: response 2h (within 24h normal SLA) ✓, no resolution yet
    // wo-3: no response transition yet — only 'created'
    expect(result.sla.total_with_sla).toBe(2);
    expect(result.sla.response_adherence_pct).toBe(100);
    expect(result.sla.resolution_adherence_pct).toBe(100);
    expect(result.sla.avg_response_hours).toBe(1.25); // (0.5 + 2) / 2
    expect(result.sla.avg_resolution_hours).toBe(4); // only wo-1 resolved
  });
});
