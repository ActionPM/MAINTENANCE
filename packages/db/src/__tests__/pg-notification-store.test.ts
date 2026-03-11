import { describe, it, expect, beforeEach } from 'vitest';
import {
  PostgresNotificationStore,
  PostgresNotificationPreferenceStore,
} from '../repos/pg-notification-store.js';

function createFakePool() {
  const fake = {
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    query: async (text: string, values?: unknown[]) => {
      fake.queries.push({ text, values: values ?? [] });
      return { rows: fake.nextRows, rowCount: fake.nextRows.length };
    },
    end: async () => {},
  };
  return fake;
}

describe('PostgresNotificationStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresNotificationStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresNotificationStore(pool as never);
  });

  it('insert() writes to notification_events', async () => {
    const event = {
      event_id: 'ne-1',
      notification_id: 'n-1',
      conversation_id: 'c-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      channel: 'in_app' as const,
      notification_type: 'work_order_created' as const,
      work_order_ids: ['wo-1'],
      issue_group_id: 'ig-1',
      template_id: 'tpl-1',
      status: 'sent' as const,
      idempotency_key: 'ik-1',
      payload: {},
      created_at: '2026-03-04T00:00:00Z',
      sent_at: '2026-03-04T00:00:01Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(event);
    expect(pool.queries[0].text).toContain('INSERT INTO notification_events');
  });

  it('queryByTenantUser() sorts by created_at DESC', async () => {
    pool.nextRows = [];
    await store.queryByTenantUser('tu-1', 10);
    expect(pool.queries[0].text).toContain('DESC');
    expect(pool.queries[0].text).toContain('LIMIT');
  });

  it('findRecentByTenantAndType() filters by cooldown', async () => {
    pool.nextRows = [];
    await store.findRecentByTenantAndType('tu-1', 'work_order_created', 30, '2026-03-04T01:00:00Z');
    expect(pool.queries[0].text).toContain('tenant_user_id');
    expect(pool.queries[0].text).toContain('notification_type');
    expect(pool.queries[0].text).toContain('created_at >=');
  });

  it('insert() swallows unique violation on idempotency_key (23505)', async () => {
    const throwingPool = createFakePool();
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });
    throwingPool.query = async () => {
      throw err;
    };
    const throwingStore = new PostgresNotificationStore(throwingPool as never);

    const event = {
      event_id: 'ne-2',
      notification_id: 'n-2',
      conversation_id: 'c-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      channel: 'in_app' as const,
      notification_type: 'work_order_created' as const,
      work_order_ids: ['wo-1'],
      issue_group_id: 'ig-1',
      template_id: 'tpl-1',
      status: 'sent' as const,
      idempotency_key: 'ik-duplicate',
      payload: {},
      created_at: '2026-03-04T00:00:00Z',
      sent_at: null,
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    // Should not throw — unique violation is treated as dedup
    await expect(throwingStore.insert(event)).resolves.toBeUndefined();
  });

  it('insert() rethrows non-unique-violation errors', async () => {
    const throwingPool = createFakePool();
    throwingPool.query = async () => {
      throw new Error('connection lost');
    };
    const throwingStore = new PostgresNotificationStore(throwingPool as never);

    const event = {
      event_id: 'ne-3',
      notification_id: 'n-3',
      conversation_id: 'c-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      channel: 'in_app' as const,
      notification_type: 'work_order_created' as const,
      work_order_ids: ['wo-1'],
      issue_group_id: null,
      template_id: 'tpl-1',
      status: 'sent' as const,
      idempotency_key: 'ik-3',
      payload: {},
      created_at: '2026-03-04T00:00:00Z',
      sent_at: null,
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await expect(throwingStore.insert(event)).rejects.toThrow('connection lost');
  });
});

describe('PostgresNotificationPreferenceStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresNotificationPreferenceStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresNotificationPreferenceStore(pool as never);
  });

  it('get() returns null for missing account', async () => {
    pool.nextRows = [];
    const result = await store.get('ta-missing');
    expect(result).toBeNull();
  });

  it('save() uses UPSERT on tenant_account_id', async () => {
    const pref = {
      preference_id: 'pref-1',
      tenant_account_id: 'ta-1',
      in_app_enabled: true,
      sms_enabled: false,
      sms_consent: null,
      notification_type_overrides: {},
      cooldown_minutes: 30,
      updated_at: '2026-03-04T00:00:00Z',
    };

    await store.save(pref);
    expect(pool.queries[0].text).toContain('ON CONFLICT');
  });
});
