import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import type { WorkOrderRepository, WorkOrderListFilters } from './types.js';

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

  async listAll(filters?: WorkOrderListFilters): Promise<readonly WorkOrder[]> {
    let results = [...this.store.values()];

    if (filters?.client_id) {
      results = results.filter(wo => wo.client_id === filters.client_id);
    }
    if (filters?.property_id) {
      results = results.filter(wo => wo.property_id === filters.property_id);
    }
    if (filters?.unit_id) {
      results = results.filter(wo => wo.unit_id === filters.unit_id);
    }
    if (filters?.from) {
      const fromMs = new Date(filters.from).getTime();
      results = results.filter(wo => new Date(wo.created_at).getTime() >= fromMs);
    }
    if (filters?.to) {
      const toMs = new Date(filters.to).getTime();
      results = results.filter(wo => new Date(wo.created_at).getTime() < toMs);
    }

    return results;
  }

  async getById(workOrderId: string): Promise<WorkOrder | null> {
    return this.store.get(workOrderId) ?? null;
  }

  async getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]> {
    return [...this.store.values()].filter(wo => wo.issue_group_id === issueGroupId);
  }

  async updateStatus(
    workOrderId: string,
    newStatus: WorkOrderStatus,
    actor: ActorType,
    changedAt: string,
    expectedVersion: number,
  ): Promise<WorkOrder> {
    const existing = this.store.get(workOrderId);
    if (!existing) {
      throw new Error(`WorkOrder not found: ${workOrderId}`);
    }
    if (existing.row_version !== expectedVersion) {
      throw new Error(`Version mismatch: expected ${expectedVersion}, got ${existing.row_version}`);
    }

    const updated: WorkOrder = {
      ...existing,
      status: newStatus,
      status_history: [
        ...existing.status_history,
        { status: newStatus, changed_at: changedAt, actor },
      ],
      updated_at: changedAt,
      row_version: existing.row_version + 1,
    };

    this.store.set(workOrderId, updated);
    return updated;
  }
}
