import { randomUUID } from 'node:crypto';
import type { WorkOrder, WorkOrderStatus } from '@wo-agent/schemas';
import type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
} from '@wo-agent/core';

export interface MockERPAdapterConfig {
  readonly shouldFail?: boolean;
  readonly failureError?: string;
}

interface ERPRecord {
  ext_id: string;
  work_order_id: string;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
}

interface StatusChange {
  ext_id: string;
  work_order_id: string;
  previous_status: WorkOrderStatus;
  new_status: WorkOrderStatus;
  updated_at: string;
}

/**
 * WO status lifecycle (spec §1.5):
 * created → action_required → scheduled → resolved | cancelled
 */
const NEXT_STATUS: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = {
  created: 'action_required' as WorkOrderStatus,
  action_required: 'scheduled' as WorkOrderStatus,
  scheduled: 'resolved' as WorkOrderStatus,
};

/**
 * Mock ERP adapter for testing and MVP (spec §23).
 * Returns EXT-<uuid> IDs and simulates status transitions.
 */
export class MockERPAdapter implements ERPAdapter {
  private readonly config: MockERPAdapterConfig;
  private readonly records = new Map<string, ERPRecord>();
  private readonly byWorkOrderId = new Map<string, string>(); // wo_id → ext_id
  private readonly statusChanges: StatusChange[] = [];

  /** Recorded calls for test assertion. */
  readonly calls = {
    createWorkOrder: [] as Array<{ work_order_id: string; ext_id: string }>,
    getWorkOrderStatus: [] as Array<{ ext_id: string }>,
    syncUpdates: [] as Array<{ since: string }>,
    healthCheck: [] as Array<Record<string, never>>,
  };

  constructor(config: MockERPAdapterConfig = {}) {
    this.config = config;
  }

  async createWorkOrder(workOrder: WorkOrder): Promise<ERPCreateResult> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failureError ?? 'Mock ERP failure');
    }

    if (this.byWorkOrderId.has(workOrder.work_order_id)) {
      throw new Error(`Work order ${workOrder.work_order_id} already registered with ERP`);
    }

    const ext_id = `EXT-${randomUUID()}`;
    const now = workOrder.created_at;

    this.records.set(ext_id, {
      ext_id,
      work_order_id: workOrder.work_order_id,
      status: workOrder.status,
      created_at: now,
      updated_at: now,
    });
    this.byWorkOrderId.set(workOrder.work_order_id, ext_id);

    this.calls.createWorkOrder.push({ work_order_id: workOrder.work_order_id, ext_id });
    return { ext_id };
  }

  async getWorkOrderStatus(extId: string): Promise<ERPStatusResult> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failureError ?? 'Mock ERP failure');
    }

    const record = this.records.get(extId);
    if (!record) {
      throw new Error(`ERP record not found: ${extId}`);
    }

    this.calls.getWorkOrderStatus.push({ ext_id: extId });
    return {
      ext_id: record.ext_id,
      status: record.status,
      updated_at: record.updated_at,
    };
  }

  async syncUpdates(since: string): Promise<readonly ERPStatusUpdate[]> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failureError ?? 'Mock ERP failure');
    }

    this.calls.syncUpdates.push({ since });
    const sinceTime = new Date(since).getTime();
    return this.statusChanges.filter((change) => new Date(change.updated_at).getTime() > sinceTime);
  }

  async healthCheck(): Promise<ERPHealthResult> {
    this.calls.healthCheck.push({});
    return { healthy: !this.config.shouldFail };
  }

  /**
   * Test helper: advance a work order to the next status in the lifecycle.
   * Spec §1.5: created → action_required → scheduled → resolved | cancelled
   */
  advanceStatus(extId: string, changedAt: string): ERPStatusUpdate {
    const record = this.records.get(extId);
    if (!record) {
      throw new Error(`ERP record not found: ${extId}`);
    }

    const nextStatus = NEXT_STATUS[record.status];
    if (!nextStatus) {
      throw new Error(`Cannot advance from terminal status: ${record.status}`);
    }

    const update: StatusChange = {
      ext_id: extId,
      work_order_id: record.work_order_id,
      previous_status: record.status,
      new_status: nextStatus,
      updated_at: changedAt,
    };

    record.status = nextStatus;
    record.updated_at = changedAt;
    this.statusChanges.push(update);

    return update;
  }

  /** Test helper: get ext_id for a work_order_id. */
  getExtId(workOrderId: string): string | undefined {
    return this.byWorkOrderId.get(workOrderId);
  }
}
