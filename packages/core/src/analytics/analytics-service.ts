import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import type { WorkOrderRepository } from '../work-order/types.js';
import type { NotificationRepository } from '../notifications/types.js';
import type { SlaPolicies } from '../record-bundle/types.js';
import type {
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from './types.js';

export interface AnalyticsServiceDeps {
  readonly workOrderRepo: WorkOrderRepository;
  readonly notificationRepo: NotificationRepository;
  readonly slaPolicies: SlaPolicies;
  readonly clock: () => string;
}

export class AnalyticsService {
  private readonly deps: AnalyticsServiceDeps;

  constructor(deps: AnalyticsServiceDeps) {
    this.deps = deps;
  }

  async compute(query: AnalyticsQuery): Promise<AnalyticsResult> {
    const workOrders = await this.deps.workOrderRepo.listAll({
      client_id: query.client_id,
      property_id: query.property_id,
      unit_id: query.unit_id,
      from: query.from,
      to: query.to,
    });

    const notifications = await this.deps.notificationRepo.listAll({
      from: query.from,
      to: query.to,
    });

    return {
      query,
      overview: this.computeOverview(workOrders),
      taxonomy_breakdown: this.computeTaxonomyBreakdown(workOrders),
      sla: this.computeSlaMetrics(workOrders),
      notifications: this.computeNotificationMetrics(notifications),
      generated_at: this.deps.clock(),
    };
  }

  private computeOverview(workOrders: readonly WorkOrder[]): OverviewMetrics {
    const byStatus: Record<string, number> = {};
    let needsHumanTriage = 0;
    let hasEmergency = 0;

    for (const wo of workOrders) {
      byStatus[wo.status] = (byStatus[wo.status] ?? 0) + 1;
      if (wo.needs_human_triage) needsHumanTriage++;
      if (wo.risk_flags?.['has_emergency'] === true) hasEmergency++;
    }

    return {
      total_work_orders: workOrders.length,
      by_status: byStatus,
      needs_human_triage: needsHumanTriage,
      has_emergency: hasEmergency,
    };
  }

  private computeTaxonomyBreakdown(workOrders: readonly WorkOrder[]): TaxonomyBreakdown {
    const result: Record<string, Record<string, number>> = {};

    for (const wo of workOrders) {
      for (const [field, value] of Object.entries(wo.classification)) {
        if (!result[field]) result[field] = {};
        result[field]![value] = (result[field]![value] ?? 0) + 1;
      }
    }

    return result;
  }

  private computeSlaMetrics(_workOrders: readonly WorkOrder[]): SlaMetrics {
    return { total_with_sla: 0, response_adherence_pct: 0, resolution_adherence_pct: 0, avg_response_hours: null, avg_resolution_hours: null };
  }

  private computeNotificationMetrics(_notifications: readonly NotificationEvent[]): NotificationMetrics {
    return { total_sent: 0, by_channel: {}, by_type: {}, delivery_success_pct: 0 };
  }
}
