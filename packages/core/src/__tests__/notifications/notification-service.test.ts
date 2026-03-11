import { describe, it, expect, beforeEach } from 'vitest';
import type { NotificationPreference } from '@wo-agent/schemas';
import { NotificationService } from '../../notifications/notification-service.js';
import {
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
} from '../../notifications/in-memory-notification-store.js';
import type { SmsSender } from '../../notifications/types.js';

function makePrefs(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    preference_id: 'pref-1',
    tenant_account_id: 'acct-1',
    in_app_enabled: true,
    sms_enabled: false,
    sms_consent: null,
    notification_type_overrides: {},
    cooldown_minutes: 5,
    updated_at: '2026-03-03T12:00:00Z',
    ...overrides,
  };
}

const noopSmsSender: SmsSender = {
  send: async () => ({ success: true }),
};

describe('NotificationService', () => {
  let notifStore: InMemoryNotificationStore;
  let prefStore: InMemoryNotificationPreferenceStore;
  let service: NotificationService;
  let counter: number;

  beforeEach(() => {
    notifStore = new InMemoryNotificationStore();
    prefStore = new InMemoryNotificationPreferenceStore();
    counter = 0;
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: noopSmsSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });
  });

  it('sends in-app notification for WO creation', async () => {
    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(true);
    expect(result.sms_sent).toBe(false);

    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1);
    expect(stored[0].channel).toBe('in_app');
    expect(stored[0].notification_type).toBe('work_order_created');
  });

  it('deduplicates via idempotency key', async () => {
    await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    const result2 = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result2.deduplicated).toBe(true);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1); // not duplicated
  });

  it('suppresses in-app within cooldown window', async () => {
    // Insert a recent notification
    await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    // Save a short cooldown preference
    await prefStore.save(makePrefs({ cooldown_minutes: 10 }));

    const result2 = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-2',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-2'],
      issueGroupId: 'grp-2',
      idempotencyKey: 'idem-2',
    });

    expect(result2.cooldown_suppressed).toBe(true);
  });

  it('sends SMS when consent given and sms_enabled', async () => {
    const smsCalls: string[] = [];
    const trackingSender: SmsSender = {
      send: async (phone, msg) => {
        smsCalls.push(phone);
        return { success: true };
      },
    };
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: trackingSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    await prefStore.save(
      makePrefs({
        sms_enabled: true,
        sms_consent: {
          phone_number: '+14165551234',
          consent_given_at: '2026-01-01T00:00:00Z',
          consent_revoked_at: null,
        },
      }),
    );

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(true);
    expect(smsCalls).toEqual(['+14165551234']);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(2); // in-app + sms
  });

  it('does NOT send SMS when consent revoked', async () => {
    await prefStore.save(
      makePrefs({
        sms_enabled: true,
        sms_consent: {
          phone_number: '+14165551234',
          consent_given_at: '2026-01-01T00:00:00Z',
          consent_revoked_at: '2026-02-01T00:00:00Z',
        },
      }),
    );

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(false);
  });

  it('respects in_app_enabled=false preference', async () => {
    await prefStore.save(makePrefs({ in_app_enabled: false }));

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(false);
  });

  it('batches multi-issue WO creation into one notification', async () => {
    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1', 'wo-2', 'wo-3'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(true);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1); // ONE notification, three WO IDs
    expect(stored[0].work_order_ids).toHaveLength(3);
  });

  it('deduplicates SMS-only sends via SMS idempotency key', async () => {
    // Enable SMS, disable in-app so only SMS events exist
    const trackingSender: SmsSender = {
      send: async () => ({ success: true }),
    };
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: trackingSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    await prefStore.save(
      makePrefs({
        in_app_enabled: false,
        sms_enabled: true,
        sms_consent: {
          phone_number: '+14165551234',
          consent_given_at: '2026-01-01T00:00:00Z',
          consent_revoked_at: null,
        },
      }),
    );

    await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    // Retry same key — should be deduplicated even though only SMS was sent
    const result2 = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result2.deduplicated).toBe(true);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1); // not duplicated
  });

  it('respects notification_type_overrides disabling work_order_created', async () => {
    await prefStore.save(
      makePrefs({
        in_app_enabled: true,
        notification_type_overrides: { work_order_created: false },
      }),
    );

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(false);
    expect(result.sms_sent).toBe(false);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(0);
  });

  it('notification_type_overrides disables SMS too', async () => {
    const smsCalls: string[] = [];
    const trackingSender: SmsSender = {
      send: async (phone) => {
        smsCalls.push(phone);
        return { success: true };
      },
    };
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: trackingSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    await prefStore.save(
      makePrefs({
        sms_enabled: true,
        sms_consent: {
          phone_number: '+14165551234',
          consent_given_at: '2026-01-01T00:00:00Z',
          consent_revoked_at: null,
        },
        notification_type_overrides: { work_order_created: false },
      }),
    );

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(false);
    expect(smsCalls).toHaveLength(0);
  });

  it('records failed SMS as event with failure_reason', async () => {
    const failingSender: SmsSender = {
      send: async () => ({ success: false, error: 'Network timeout' }),
    };
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: failingSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    await prefStore.save(
      makePrefs({
        sms_enabled: true,
        sms_consent: {
          phone_number: '+14165551234',
          consent_given_at: '2026-01-01T00:00:00Z',
          consent_revoked_at: null,
        },
      }),
    );

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(false);
    expect(result.sms_failed).toBe(true);

    const stored = await notifStore.queryByTenantUser('user-1');
    const smsEvent = stored.find((e) => e.channel === 'sms');
    expect(smsEvent?.status).toBe('failed');
    expect(smsEvent?.failure_reason).toBe('Network timeout');
  });
});
