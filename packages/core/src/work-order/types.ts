import type { WorkOrder } from '@wo-agent/schemas';

/**
 * Append-only work order event (spec §7 — work_order_events table).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface WorkOrderEvent {
  readonly event_id: string;
  readonly work_order_id: string;
  readonly event_type: 'work_order_created' | 'status_changed';
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

/**
 * Work order persistence. Multi-WO batch insert is one logical transaction (spec §18).
 * Production: PostgreSQL with INSERT-only event table + optimistic locking on WO row.
 * Testing: in-memory.
 */
export interface WorkOrderRepository {
  /** Insert one or more WOs atomically. Rejects on duplicate work_order_id. */
  insertBatch(workOrders: readonly WorkOrder[]): Promise<void>;
  /** Get a single WO by ID. Returns null if not found. */
  getById(workOrderId: string): Promise<WorkOrder | null>;
  /** Get all WOs sharing an issue_group_id. No aggregate status (spec §18). */
  getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]>;
}
