import type { WorkOrder } from '@wo-agent/schemas';
import type { WorkOrderRepository } from './types.js';

/**
 * In-memory WO store for testing (spec §18 — multi-WO atomic insert).
 * Production would use PostgreSQL with BEGIN/COMMIT.
 */
export class InMemoryWorkOrderStore implements WorkOrderRepository {
  private readonly store = new Map<string, WorkOrder>();

  async insertBatch(workOrders: readonly WorkOrder[]): Promise<void> {
    // Check for duplicates before inserting any (atomicity)
    for (const wo of workOrders) {
      if (this.store.has(wo.work_order_id)) {
        throw new Error(`Duplicate work_order_id: ${wo.work_order_id}`);
      }
    }
    for (const wo of workOrders) {
      this.store.set(wo.work_order_id, wo);
    }
  }

  async getById(workOrderId: string): Promise<WorkOrder | null> {
    return this.store.get(workOrderId) ?? null;
  }

  async getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]> {
    return [...this.store.values()].filter(wo => wo.issue_group_id === issueGroupId);
  }
}
