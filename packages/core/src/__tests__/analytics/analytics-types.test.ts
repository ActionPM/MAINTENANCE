import { describe, it, expect } from 'vitest';
import type {
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from '../../analytics/types.js';

describe('Analytics types (Phase 13)', () => {
  it('AnalyticsQuery accepts all filter fields', () => {
    const query: AnalyticsQuery = {
      from: '2026-01-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
      client_id: 'c-1',
      property_id: 'p-1',
      unit_id: 'u-1',
    };
    expect(query.from).toBe('2026-01-01T00:00:00Z');
    expect(query.client_id).toBe('c-1');
  });

  it('AnalyticsQuery fields are all optional', () => {
    const empty: AnalyticsQuery = {};
    expect(empty.from).toBeUndefined();
  });

  it('OverviewMetrics has required fields', () => {
    const overview: OverviewMetrics = {
      total_work_orders: 10,
      by_status: { created: 3, action_required: 2, scheduled: 2, resolved: 2, cancelled: 1 },
      needs_human_triage: 1,
      has_emergency: 2,
    };
    expect(overview.total_work_orders).toBe(10);
  });

  it('TaxonomyBreakdown maps field to value counts', () => {
    const breakdown: TaxonomyBreakdown = {
      Category: { maintenance: 8, management: 2 },
      Priority: { normal: 5, high: 3, low: 2 },
    };
    expect(breakdown['Category']?.['maintenance']).toBe(8);
  });

  it('SlaMetrics computes adherence and averages', () => {
    const sla: SlaMetrics = {
      total_with_sla: 10,
      response_adherence_pct: 85.0,
      resolution_adherence_pct: 70.0,
      avg_response_hours: 6.5,
      avg_resolution_hours: 72.0,
    };
    expect(sla.response_adherence_pct).toBe(85.0);
  });

  it('NotificationMetrics tracks delivery', () => {
    const notif: NotificationMetrics = {
      total_sent: 20,
      by_channel: { in_app: 15, sms: 5 },
      by_type: { work_order_created: 10, status_changed: 7, needs_input: 3 },
      delivery_success_pct: 90.0,
    };
    expect(notif.total_sent).toBe(20);
  });

  it('AnalyticsResult composes all metrics', () => {
    const result: AnalyticsResult = {
      query: {},
      overview: {
        total_work_orders: 0,
        by_status: {},
        needs_human_triage: 0,
        has_emergency: 0,
      },
      taxonomy_breakdown: {},
      sla: {
        total_with_sla: 0,
        response_adherence_pct: 0,
        resolution_adherence_pct: 0,
        avg_response_hours: null,
        avg_resolution_hours: null,
      },
      notifications: {
        total_sent: 0,
        by_channel: {},
        by_type: {},
        delivery_success_pct: 0,
      },
      generated_at: '2026-03-04T12:00:00Z',
    };
    expect(result.generated_at).toBeDefined();
  });
});
