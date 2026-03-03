import { describe, it, expect } from 'vitest';
import { buildWoCreatedNotificationEvent } from '../../notifications/event-builder.js';

describe('buildWoCreatedNotificationEvent', () => {
  it('builds in-app notification event for batched WO creation', () => {
    const event = buildWoCreatedNotificationEvent({
      eventId: 'evt-1',
      notificationId: 'notif-1',
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      channel: 'in_app',
      workOrderIds: ['wo-1', 'wo-2'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
      createdAt: '2026-03-03T12:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.notification_type).toBe('work_order_created');
    expect(event.channel).toBe('in_app');
    expect(event.work_order_ids).toEqual(['wo-1', 'wo-2']);
    expect(event.issue_group_id).toBe('grp-1');
    expect(event.status).toBe('sent');
    expect(event.sent_at).toBe('2026-03-03T12:00:00Z');
    expect(event.template_id).toBe('tpl-wo-created');
  });

  it('builds SMS notification event', () => {
    const event = buildWoCreatedNotificationEvent({
      eventId: 'evt-2',
      notificationId: 'notif-2',
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      channel: 'sms',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-2',
      createdAt: '2026-03-03T12:00:00Z',
    });

    expect(event.channel).toBe('sms');
    expect(event.status).toBe('pending');
    expect(event.sent_at).toBeNull();
  });

  it('batches multiple WO IDs into single notification (spec §20)', () => {
    const event = buildWoCreatedNotificationEvent({
      eventId: 'evt-3',
      notificationId: 'notif-3',
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      channel: 'in_app',
      workOrderIds: ['wo-1', 'wo-2', 'wo-3'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-3',
      createdAt: '2026-03-03T12:00:00Z',
    });

    expect(event.work_order_ids).toHaveLength(3);
    expect(event.payload).toEqual({
      message: 'Your service requests have been submitted.',
      work_order_count: 3,
    });
  });
});
