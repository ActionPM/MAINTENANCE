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
    },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('AnalyticsService.computeTaxonomyBreakdown (Phase 13)', () => {
  it('returns empty object when no WOs exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });

    const result = await svc.compute({});
    expect(result.taxonomy_breakdown).toEqual({});
  });

  it('groups WOs by each classification field', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        classification: {
          Category: 'maintenance',
          Maintenance_Category: 'plumbing',
          Priority: 'high',
        },
      }),
      makeWO({
        work_order_id: 'wo-2',
        classification: {
          Category: 'maintenance',
          Maintenance_Category: 'electrical',
          Priority: 'normal',
        },
      }),
      makeWO({
        work_order_id: 'wo-3',
        classification: {
          Category: 'management',
          Management_Category: 'lease',
          Priority: 'normal',
        },
      }),
    ]);

    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });
    const result = await svc.compute({});

    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 2, management: 1 });
    expect(result.taxonomy_breakdown['Maintenance_Category']).toEqual({
      plumbing: 1,
      electrical: 1,
    });
    expect(result.taxonomy_breakdown['Management_Category']).toEqual({ lease: 1 });
    expect(result.taxonomy_breakdown['Priority']).toEqual({ high: 1, normal: 2 });
  });

  it('omits fields not present in any WO classification', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        classification: { Category: 'maintenance' },
      }),
    ]);

    const svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });
    const result = await svc.compute({});

    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 1 });
    expect(result.taxonomy_breakdown['Location']).toBeUndefined();
  });
});
