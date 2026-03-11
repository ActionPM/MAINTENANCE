import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { NotificationEvent } from '@wo-agent/schemas';

function makeNotif(
  overrides: Partial<NotificationEvent> & { event_id: string; notification_id: string },
): NotificationEvent {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    channel: 'in_app',
    notification_type: 'work_order_created',
    work_order_ids: ['wo-1'],
    issue_group_id: null,
    template_id: 'tpl-1',
    status: 'sent',
    idempotency_key: `idem-${overrides.event_id}`,
    payload: {},
    created_at: '2026-03-01T10:00:00Z',
    sent_at: '2026-03-01T10:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('NotificationRepository.listAll (Phase 13)', () => {
  let store: InMemoryNotificationStore;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
  });

  it('returns empty array when no notifications exist', async () => {
    const result = await store.listAll();
    expect(result).toEqual([]);
  });

  it('returns all notifications when no filters', async () => {
    await store.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1' }));
    await store.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2' }));
    const result = await store.listAll();
    expect(result).toHaveLength(2);
  });

  it('filters by time range', async () => {
    await store.insert(
      makeNotif({ event_id: 'e-1', notification_id: 'n-1', created_at: '2026-01-15T00:00:00Z' }),
    );
    await store.insert(
      makeNotif({ event_id: 'e-2', notification_id: 'n-2', created_at: '2026-02-15T00:00:00Z' }),
    );
    await store.insert(
      makeNotif({ event_id: 'e-3', notification_id: 'n-3', created_at: '2026-03-15T00:00:00Z' }),
    );
    const result = await store.listAll({
      from: '2026-02-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.event_id).toBe('e-2');
  });

  it('filters by tenant_user_id', async () => {
    await store.insert(
      makeNotif({ event_id: 'e-1', notification_id: 'n-1', tenant_user_id: 'tu-1' }),
    );
    await store.insert(
      makeNotif({ event_id: 'e-2', notification_id: 'n-2', tenant_user_id: 'tu-2' }),
    );
    const result = await store.listAll({ tenant_user_id: 'tu-1' });
    expect(result).toHaveLength(1);
  });
});
