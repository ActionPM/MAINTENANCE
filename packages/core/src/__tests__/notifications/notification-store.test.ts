import { describe, it, expect } from 'vitest';
import type { NotificationEvent } from '@wo-agent/schemas';
import { InMemoryNotificationStore } from '../../notifications/in-memory-notification-store.js';

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    event_id: 'evt-1',
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
    sent_at: '2026-03-03T12:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('InMemoryNotificationStore', () => {
  it('inserts and queries by tenant_user_id', async () => {
    const store = new InMemoryNotificationStore();
    await store.insert(makeEvent());
    const results = await store.queryByTenantUser('user-1');
    expect(results).toHaveLength(1);
    expect(results[0].notification_id).toBe('notif-1');
  });

  it('rejects duplicate event_id', async () => {
    const store = new InMemoryNotificationStore();
    await store.insert(makeEvent());
    await expect(store.insert(makeEvent())).rejects.toThrow('Duplicate event_id');
  });

  it('queries by conversation_id', async () => {
    const store = new InMemoryNotificationStore();
    await store.insert(makeEvent({ event_id: 'e1', conversation_id: 'c1' }));
    await store.insert(makeEvent({ event_id: 'e2', conversation_id: 'c2', notification_id: 'n2', idempotency_key: 'k2' }));
    const results = await store.queryByConversation('c1');
    expect(results).toHaveLength(1);
  });

  it('findByIdempotencyKey returns existing event', async () => {
    const store = new InMemoryNotificationStore();
    const event = makeEvent();
    await store.insert(event);
    const found = await store.findByIdempotencyKey('idem-1');
    expect(found).toEqual(event);
  });

  it('findByIdempotencyKey returns null for unknown key', async () => {
    const store = new InMemoryNotificationStore();
    const found = await store.findByIdempotencyKey('unknown');
    expect(found).toBeNull();
  });

  it('findRecentByTenantAndType returns events within cooldown window', async () => {
    const store = new InMemoryNotificationStore();
    const now = '2026-03-03T12:05:00Z';
    await store.insert(makeEvent({
      event_id: 'e1',
      created_at: '2026-03-03T12:03:00Z', // 2 min ago
    }));
    await store.insert(makeEvent({
      event_id: 'e2',
      notification_id: 'n2',
      idempotency_key: 'k2',
      created_at: '2026-03-03T11:50:00Z', // 15 min ago
    }));
    const recent = await store.findRecentByTenantAndType(
      'user-1',
      'work_order_created',
      5, // 5 minute cooldown
      now,
    );
    expect(recent).toHaveLength(1);
    expect(recent[0].event_id).toBe('e1');
  });
});
