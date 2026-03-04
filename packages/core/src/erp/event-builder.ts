import type { WorkOrderStatus } from '@wo-agent/schemas';
import type { ERPSyncEvent } from './types.js';

export interface ERPCreateEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly extId: string;
  readonly createdAt: string;
}

export interface ERPStatusPollEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly extId: string;
  readonly status: WorkOrderStatus;
  readonly createdAt: string;
}

export interface ERPSyncEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly extId: string;
  readonly previousStatus: WorkOrderStatus;
  readonly newStatus: WorkOrderStatus;
  readonly createdAt: string;
}

/** Build an append-only erp_create event (spec §7 — INSERT only). */
export function buildERPCreateEvent(input: ERPCreateEventInput): ERPSyncEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    conversation_id: input.conversationId,
    event_type: 'erp_create',
    ext_id: input.extId,
    payload: {},
    created_at: input.createdAt,
  };
}

/** Build an append-only erp_status_poll event (spec §7 — INSERT only). */
export function buildERPStatusPollEvent(input: ERPStatusPollEventInput): ERPSyncEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    conversation_id: input.conversationId,
    event_type: 'erp_status_poll',
    ext_id: input.extId,
    payload: { status: input.status },
    created_at: input.createdAt,
  };
}

/** Build an append-only erp_sync event (spec §7 — INSERT only). */
export function buildERPSyncEvent(input: ERPSyncEventInput): ERPSyncEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    conversation_id: input.conversationId,
    event_type: 'erp_sync',
    ext_id: input.extId,
    payload: {
      previous_status: input.previousStatus,
      new_status: input.newStatus,
    },
    created_at: input.createdAt,
  };
}
