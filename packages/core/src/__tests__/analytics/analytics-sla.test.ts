import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    normal: { response_hours: 24, resolution_hours: 168 },
    high: { response_hours: 4, resolution_hours: 48 },
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
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('AnalyticsService.computeSlaMetrics (Phase 13)', () => {
  it('returns zeroes when no WOs exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });

    const result = await svc.compute({});
    expect(result.sla.total_with_sla).toBe(0);
    expect(result.sla.avg_response_hours).toBeNull();
    expect(result.sla.avg_resolution_hours).toBeNull();
  });

  it('computes 100% adherence when action_required within response SLA', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    // WO created at 10:00, action_required at 12:00 = 2 hours (within 24h normal SLA)
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        status: 'action_required',
        status_history: [
          { status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-03-01T12:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Priority: 'normal' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.sla.total_with_sla).toBe(1);
    expect(result.sla.response_adherence_pct).toBe(100);
    expect(result.sla.avg_response_hours).toBe(2);
  });

  it('computes response + resolution adherence for resolved WOs', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    // WO created at 10:00, action_required at 12:00 (2h), resolved at 34:00 (24h = within 168h)
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        status: 'resolved',
        status_history: [
          { status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-03-01T12:00:00Z', actor: 'system' },
          { status: 'resolved', changed_at: '2026-03-02T10:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Priority: 'normal' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.sla.response_adherence_pct).toBe(100);
    expect(result.sla.resolution_adherence_pct).toBe(100);
    expect(result.sla.avg_response_hours).toBe(2);
    expect(result.sla.avg_resolution_hours).toBe(24);
  });

  it('detects SLA breach when response exceeds threshold', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    // High priority: 4h response SLA. Actual: 6h → breach
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        status: 'action_required',
        status_history: [
          { status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-03-01T16:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Priority: 'high' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.sla.response_adherence_pct).toBe(0);
    expect(result.sla.avg_response_hours).toBe(6);
  });
});
