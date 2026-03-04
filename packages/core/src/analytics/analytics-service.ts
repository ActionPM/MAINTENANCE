import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import type { WorkOrderRepository } from '../work-order/types.js';
import type { NotificationRepository } from '../notifications/types.js';
import type { SlaPolicies } from '../record-bundle/types.js';
import { computeSlaMetadata } from '../record-bundle/sla-calculator.js';
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
      unit_ids: query.authorized_unit_ids as string[] | undefined,
      from: query.from,
      to: query.to,
    });

    // Scope notifications to WOs in the filtered set (fix: cross-tenant leak)
    const woIdSet = new Set(workOrders.map(wo => wo.work_order_id));
    const allNotifications = await this.deps.notificationRepo.listAll({
      from: query.from,
      to: query.to,
    });
    const notifications = allNotifications.filter(n =>
      n.work_order_ids.some(id => woIdSet.has(id)),
    );

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

  private computeSlaMetrics(workOrders: readonly WorkOrder[]): SlaMetrics {
    if (workOrders.length === 0) {
      return { total_with_sla: 0, response_adherence_pct: 0, resolution_adherence_pct: 0, avg_response_hours: null, avg_resolution_hours: null };
    }

    let totalWithSla = 0;
    let responseMetCount = 0;
    let resolutionMetCount = 0;
    let totalResponseHours = 0;
    let responseCount = 0;
    let totalResolutionHours = 0;
    let resolutionCount = 0;

    for (const wo of workOrders) {
      const priority = wo.classification['Priority'] ?? 'normal';
      const sla = computeSlaMetadata({
        priority,
        classification: wo.classification,
        createdAt: wo.created_at,
        slaPolicies: this.deps.slaPolicies,
      });

      // Find first non-"created" status transition for response time
      const createdMs = new Date(wo.created_at).getTime();
      const firstResponse = wo.status_history.find(
        (e) => e.status !== 'created',
      );

      if (firstResponse) {
        totalWithSla++;
        const responseMs = new Date(firstResponse.changed_at).getTime() - createdMs;
        const responseHours = responseMs / 3_600_000;
        totalResponseHours += responseHours;
        responseCount++;
        if (responseHours <= sla.response_hours) responseMetCount++;
      }

      // Find terminal status (resolved/cancelled) for resolution time
      const terminal = wo.status_history.find(
        (e) => e.status === 'resolved' || e.status === 'cancelled',
      );
      if (terminal) {
        if (!firstResponse) totalWithSla++;
        const resolutionMs = new Date(terminal.changed_at).getTime() - createdMs;
        const resolutionHours = resolutionMs / 3_600_000;
        totalResolutionHours += resolutionHours;
        resolutionCount++;
        if (resolutionHours <= sla.resolution_hours) resolutionMetCount++;
      }
    }

    return {
      total_with_sla: totalWithSla,
      response_adherence_pct: responseCount > 0
        ? Math.round((responseMetCount / responseCount) * 100 * 100) / 100
        : 0,
      resolution_adherence_pct: resolutionCount > 0
        ? Math.round((resolutionMetCount / resolutionCount) * 100 * 100) / 100
        : 0,
      avg_response_hours: responseCount > 0
        ? Math.round(totalResponseHours / responseCount * 100) / 100
        : null,
      avg_resolution_hours: resolutionCount > 0
        ? Math.round(totalResolutionHours / resolutionCount * 100) / 100
        : null,
    };
  }

  private computeNotificationMetrics(notifications: readonly NotificationEvent[]): NotificationMetrics {
    if (notifications.length === 0) {
      return { total_sent: 0, by_channel: {}, by_type: {}, delivery_success_pct: 0 };
    }

    const byChannel: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let successCount = 0;

    for (const n of notifications) {
      byChannel[n.channel] = (byChannel[n.channel] ?? 0) + 1;
      byType[n.notification_type] = (byType[n.notification_type] ?? 0) + 1;
      if (n.status === 'delivered' || n.status === 'sent') successCount++;
    }

    return {
      total_sent: notifications.length,
      by_channel: byChannel,
      by_type: byType,
      delivery_success_pct: Math.round((successCount / notifications.length) * 100 * 100) / 100,
    };
  }
}
