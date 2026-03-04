import { describe, it, expect, beforeEach } from 'vitest';
import { updateNotificationPreferences, grantSmsConsent, revokeSmsConsent } from '../../notifications/preference-service.js';
import { InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';

describe('Preference updates', () => {
  let prefStore: InMemoryNotificationPreferenceStore;
  let counter: number;
  const idGenerator = () => `id-${++counter}`;
  const clock = () => '2026-03-03T12:00:00Z';

  beforeEach(() => {
    prefStore = new InMemoryNotificationPreferenceStore();
    counter = 0;
  });

  it('creates default preferences on first update', async () => {
    const result = await updateNotificationPreferences({
      tenantAccountId: 'acct-1',
      updates: { in_app_enabled: true },
      prefStore,
      idGenerator,
      clock,
    });

    expect(result.in_app_enabled).toBe(true);
    expect(result.sms_enabled).toBe(false); // default
    expect(result.cooldown_minutes).toBe(5); // default

    const stored = await prefStore.get('acct-1');
    expect(stored).toEqual(result);
  });

  it('merges partial updates into existing preferences', async () => {
    await updateNotificationPreferences({
      tenantAccountId: 'acct-1',
      updates: { cooldown_minutes: 10 },
      prefStore,
      idGenerator,
      clock,
    });

    const updated = await updateNotificationPreferences({
      tenantAccountId: 'acct-1',
      updates: { in_app_enabled: false },
      prefStore,
      idGenerator,
      clock,
    });

    expect(updated.in_app_enabled).toBe(false);
    expect(updated.cooldown_minutes).toBe(10); // preserved
  });

  it('grantSmsConsent sets consent with phone number', async () => {
    const result = await grantSmsConsent({
      tenantAccountId: 'acct-1',
      phoneNumber: '+14165551234',
      prefStore,
      idGenerator,
      clock,
    });

    expect(result.sms_enabled).toBe(true);
    expect(result.sms_consent?.phone_number).toBe('+14165551234');
    expect(result.sms_consent?.consent_given_at).toBe('2026-03-03T12:00:00Z');
    expect(result.sms_consent?.consent_revoked_at).toBeNull();
  });

  it('revokeSmsConsent sets revocation timestamp', async () => {
    await grantSmsConsent({
      tenantAccountId: 'acct-1',
      phoneNumber: '+14165551234',
      prefStore,
      idGenerator,
      clock,
    });

    const result = await revokeSmsConsent({
      tenantAccountId: 'acct-1',
      prefStore,
      clock,
    });

    expect(result.sms_enabled).toBe(false);
    expect(result.sms_consent?.consent_revoked_at).toBe('2026-03-03T12:00:00Z');
  });

  it('revokeSmsConsent is no-op when no consent exists', async () => {
    const result = await revokeSmsConsent({
      tenantAccountId: 'acct-1',
      prefStore,
      clock,
    });

    // Creates default prefs with no consent
    expect(result.sms_consent).toBeNull();
    expect(result.sms_enabled).toBe(false);
  });
});
