/**
 * Work Order status lifecycle (spec §1.5):
 * created → action_required → scheduled → resolved | cancelled
 */
export const WorkOrderStatus = {
  CREATED: 'created',
  ACTION_REQUIRED: 'action_required',
  SCHEDULED: 'scheduled',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
} as const;

export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

export const ALL_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = Object.values(WorkOrderStatus);
