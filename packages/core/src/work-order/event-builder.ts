import type { WorkOrder } from '@wo-agent/schemas';
import type { WorkOrderEvent } from './types.js';

export interface WOCreatedEventInput {
  readonly eventId: string;
  readonly workOrder: WorkOrder;
  readonly conversationId: string;
  readonly createdAt: string;
}

/**
 * Build an append-only work_order_created event (spec §7 — INSERT only).
 */
export function buildWorkOrderCreatedEvent(input: WOCreatedEventInput): WorkOrderEvent {
  const { eventId, workOrder, conversationId, createdAt } = input;
  return {
    event_id: eventId,
    work_order_id: workOrder.work_order_id,
    event_type: 'work_order_created',
    payload: {
      conversation_id: conversationId,
      issue_group_id: workOrder.issue_group_id,
      issue_id: workOrder.issue_id,
      classification: workOrder.classification,
      confidence_by_field: workOrder.confidence_by_field,
      needs_human_triage: workOrder.needs_human_triage,
      pinned_versions: workOrder.pinned_versions,
    },
    created_at: createdAt,
  };
}
