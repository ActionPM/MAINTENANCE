import { describe, it, expect } from 'vitest';
import type { NotificationEvent } from '@wo-agent/schemas';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';

describe('EventRepository NotificationEvent support', () => {
  it('accepts NotificationEvent via insert()', async () => {
    const store = new InMemoryEventStore();
    const notifEvent: NotificationEvent = {
      event_id: 'nevt-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1'],
      issue_group_id: 'grp-1',
      template_id: 'tpl-wo-created',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: {},
      created_at: '2026-03-03T12:00:00Z',
      sent_at: '2026-03-03T12:00:00Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(notifEvent);

    // Verify event was stored (queryAll returns all events for a conversation)
    const all = await store.queryAll('conv-1');
    expect(all).toHaveLength(1);
    expect(all[0].event_id).toBe('nevt-1');
  });

  it('rejects duplicate notification event_id', async () => {
    const store = new InMemoryEventStore();
    const event: NotificationEvent = {
      event_id: 'dup-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1'],
      issue_group_id: 'grp-1',
      template_id: 'tpl-wo-created',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: {},
      created_at: '2026-03-03T12:00:00Z',
      sent_at: null,
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(event);
    await expect(store.insert(event)).rejects.toThrow('Duplicate event_id');
  });
});
