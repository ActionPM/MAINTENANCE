import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    emergency: { response_hours: 1, resolution_hours: 24 },
    high: { response_hours: 4, resolution_hours: 48 },
    normal: { response_hours: 24, resolution_hours: 168 },
    low: { response_hours: 48, resolution_hours: 336 },
  },
  overrides: [],
};

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
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('AnalyticsService.computeOverview (Phase 13)', () => {
  it('returns zeroes when no WOs exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });

    const result = await svc.compute({});
    expect(result.overview.total_work_orders).toBe(0);
    expect(result.overview.by_status).toEqual({});
    expect(result.overview.needs_human_triage).toBe(0);
    expect(result.overview.has_emergency).toBe(0);
  });

  it('counts total WOs and groups by status', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({ work_order_id: 'wo-1', status: 'created' }),
      makeWO({ work_order_id: 'wo-2', status: 'created' }),
      makeWO({ work_order_id: 'wo-3', status: 'resolved' }),
    ]);

    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });
    const result = await svc.compute({});

    expect(result.overview.total_work_orders).toBe(3);
    expect(result.overview.by_status).toEqual({ created: 2, resolved: 1 });
  });

  it('counts needs_human_triage and has_emergency', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({ work_order_id: 'wo-1', needs_human_triage: true }),
      makeWO({
        work_order_id: 'wo-2',
        risk_flags: {
          has_emergency: true,
          highest_severity: 'emergency',
          trigger_ids: ['fire-001'],
        },
      }),
      makeWO({ work_order_id: 'wo-3' }),
    ]);

    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });
    const result = await svc.compute({});

    expect(result.overview.needs_human_triage).toBe(1);
    expect(result.overview.has_emergency).toBe(1);
  });

  it('passes authorized_unit_ids filter through to repository', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({ work_order_id: 'wo-1', unit_id: 'u-1' }),
      makeWO({ work_order_id: 'wo-2', unit_id: 'u-2' }),
    ]);

    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });
    const result = await svc.compute({ authorized_unit_ids: ['u-1'] });

    expect(result.overview.total_work_orders).toBe(1);
  });
});
