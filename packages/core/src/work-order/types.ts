import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';

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
/**
 * Filters for listing work orders (Phase 13 analytics).
 * All fields optional — omitted fields mean "no filter".
 */
export interface WorkOrderListFilters {
  /** Filter to WOs owned by this tenant user (ownership scope). */
  readonly tenant_user_id?: string;
  readonly client_id?: string;
  readonly property_id?: string;
  readonly unit_id?: string;
  /** Filter to WOs in any of these units (auth scope). */
  readonly unit_ids?: readonly string[];
  /** ISO 8601 start of time range (inclusive, compared to created_at). */
  readonly from?: string;
  /** ISO 8601 end of time range (exclusive, compared to created_at). */
  readonly to?: string;
}

export interface WorkOrderRepository {
  /** Insert one or more WOs atomically. Rejects on duplicate work_order_id. */
  insertBatch(workOrders: readonly WorkOrder[]): Promise<void>;
  /** Get a single WO by ID. Returns null if not found. */
  getById(workOrderId: string): Promise<WorkOrder | null>;
  /** Get all WOs sharing an issue_group_id. No aggregate status (spec §18). */
  getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]>;
  /** List all WOs matching optional filters. Used by analytics (Phase 13). */
  listAll(filters?: WorkOrderListFilters): Promise<readonly WorkOrder[]>;
  /** Update a WO's status with optimistic locking (spec §18). Rejects on version mismatch. */
  updateStatus(
    workOrderId: string,
    newStatus: WorkOrderStatus,
    actor: ActorType,
    changedAt: string,
    expectedVersion: number,
  ): Promise<WorkOrder>;
}
