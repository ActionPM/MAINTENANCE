import { describe, it, expect } from 'vitest';
import type {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationEvent,
  NotificationPreference,
  SmsConsent,
} from '@wo-agent/schemas';

describe('Notification types', () => {
  it('NotificationEvent has required readonly fields', () => {
    const event: NotificationEvent = {
      event_id: 'evt-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1', 'wo-2'],
      issue_group_id: 'grp-1',
      template_id: 'tpl-wo-created',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: { summary: 'Your requests have been submitted' },
      created_at: '2026-03-03T12:00:00Z',
      sent_at: '2026-03-03T12:00:01Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };
    expect(event.event_id).toBe('evt-1');
    expect(event.channel).toBe('in_app');
    expect(event.work_order_ids).toHaveLength(2);
  });

  it('NotificationPreference has required readonly fields', () => {
    const pref: NotificationPreference = {
      preference_id: 'pref-1',
      tenant_account_id: 'acct-1',
      in_app_enabled: true,
      sms_enabled: false,
      sms_consent: null,
      notification_type_overrides: {},
      cooldown_minutes: 5,
      updated_at: '2026-03-03T12:00:00Z',
    };
    expect(pref.sms_enabled).toBe(false);
    expect(pref.sms_consent).toBeNull();
  });

  it('SmsConsent tracks consent timestamp and phone', () => {
    const consent: SmsConsent = {
      phone_number: '+14165551234',
      consent_given_at: '2026-03-03T12:00:00Z',
      consent_revoked_at: null,
    };
    expect(consent.phone_number).toBe('+14165551234');
    expect(consent.consent_revoked_at).toBeNull();
  });
});
