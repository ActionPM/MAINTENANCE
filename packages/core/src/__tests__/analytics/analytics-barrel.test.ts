import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '@wo-agent/core';
import type {
  AnalyticsServiceDeps,
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from '@wo-agent/core';

describe('Analytics barrel exports (Phase 13)', () => {
  it('exports AnalyticsService class', () => {
    expect(AnalyticsService).toBeDefined();
  });

  it('AnalyticsServiceDeps type is importable', () => {
    const deps: Partial<AnalyticsServiceDeps> = {};
    expect(deps).toBeDefined();
  });

  it('all result types are importable', () => {
    const q: Partial<AnalyticsQuery> = {};
    const r: Partial<AnalyticsResult> = {};
    const o: Partial<OverviewMetrics> = {};
    const t: Partial<TaxonomyBreakdown> = {};
    const s: Partial<SlaMetrics> = {};
    const n: Partial<NotificationMetrics> = {};
    expect([q, r, o, t, s, n]).toHaveLength(6);
  });
});
