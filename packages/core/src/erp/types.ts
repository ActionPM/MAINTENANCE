import type { WorkOrder, WorkOrderStatus } from '@wo-agent/schemas';

/**
 * ERP adapter interface (spec §23).
 * Production: real ERP integration (Yardi, etc.).
 * MVP: MockERPAdapter in packages/adapters/mock/.
 */
export interface ERPAdapter {
  /** Register a work order with the ERP. Returns an external ID (EXT-<uuid>). */
  createWorkOrder(workOrder: WorkOrder): Promise<ERPCreateResult>;
  /** Poll a single work order's current status from the ERP. */
  getWorkOrderStatus(extId: string): Promise<ERPStatusResult>;
  /** Batch-poll for all status changes since a given timestamp. */
  syncUpdates(since: string): Promise<readonly ERPStatusUpdate[]>;
  /** Check ERP connectivity. */
  healthCheck(): Promise<ERPHealthResult>;
}

export interface ERPCreateResult {
  readonly ext_id: string;
}

export interface ERPStatusResult {
  readonly ext_id: string;
  readonly status: WorkOrderStatus;
  readonly updated_at: string;
}

export interface ERPStatusUpdate {
  readonly ext_id: string;
  readonly work_order_id: string;
  readonly previous_status: WorkOrderStatus;
  readonly new_status: WorkOrderStatus;
  readonly updated_at: string;
}

export interface ERPHealthResult {
  readonly healthy: boolean;
  readonly latency_ms?: number;
}

/**
 * Append-only ERP sync event (spec §7 — INSERT + SELECT only).
 * Logs every ERP operation for audit.
 */
export interface ERPSyncEvent {
  readonly event_id: string;
  readonly work_order_id: string;
  readonly conversation_id: string;
  readonly event_type: 'erp_create' | 'erp_status_poll' | 'erp_sync';
  readonly ext_id: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}
