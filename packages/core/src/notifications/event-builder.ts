import type { NotificationChannel, NotificationEvent } from '@wo-agent/schemas';

export interface WoCreatedNotificationInput {
  readonly eventId: string;
  readonly notificationId: string;
  readonly conversationId: string;
  readonly tenantUserId: string;
  readonly tenantAccountId: string;
  readonly channel: NotificationChannel;
  readonly workOrderIds: readonly string[];
  readonly issueGroupId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

/**
 * Build a notification event for WO creation (spec §20).
 * Batches: one notification for all WOs in an issue group.
 * In-app: immediately sent. SMS: pending until sender processes.
 */
export function buildWoCreatedNotificationEvent(
  input: WoCreatedNotificationInput,
): NotificationEvent {
  const isSms = input.channel === 'sms';
  const count = input.workOrderIds.length;
  const message =
    count === 1
      ? 'Your service request has been submitted.'
      : 'Your service requests have been submitted.';

  return {
    event_id: input.eventId,
    notification_id: input.notificationId,
    conversation_id: input.conversationId,
    tenant_user_id: input.tenantUserId,
    tenant_account_id: input.tenantAccountId,
    channel: input.channel,
    notification_type: 'work_order_created',
    work_order_ids: [...input.workOrderIds],
    issue_group_id: input.issueGroupId,
    template_id: 'tpl-wo-created',
    status: isSms ? 'pending' : 'sent',
    idempotency_key: input.idempotencyKey,
    payload: { message, work_order_count: count },
    created_at: input.createdAt,
    sent_at: isSms ? null : input.createdAt,
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
  };
}
