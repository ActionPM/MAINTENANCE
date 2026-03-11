import type { NotificationPreference } from '@wo-agent/schemas';
import type { NotificationPreferenceStore } from './types.js';

const DEFAULT_COOLDOWN = 5;

function defaultPrefs(
  tenantAccountId: string,
  prefId: string,
  now: string,
): NotificationPreference {
  return {
    preference_id: prefId,
    tenant_account_id: tenantAccountId,
    in_app_enabled: true,
    sms_enabled: false,
    sms_consent: null,
    notification_type_overrides: {},
    cooldown_minutes: DEFAULT_COOLDOWN,
    updated_at: now,
  };
}

export interface UpdatePrefsInput {
  readonly tenantAccountId: string;
  readonly updates: {
    readonly in_app_enabled?: boolean;
    readonly sms_enabled?: boolean;
    readonly cooldown_minutes?: number;
    readonly notification_type_overrides?: Readonly<Record<string, boolean>>;
  };
  readonly prefStore: NotificationPreferenceStore;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export async function updateNotificationPreferences(
  input: UpdatePrefsInput,
): Promise<NotificationPreference> {
  const { tenantAccountId, updates, prefStore, idGenerator, clock } = input;
  const now = clock();
  const existing = await prefStore.get(tenantAccountId);
  const base = existing ?? defaultPrefs(tenantAccountId, idGenerator(), now);

  const updated: NotificationPreference = {
    ...base,
    in_app_enabled: updates.in_app_enabled ?? base.in_app_enabled,
    sms_enabled: updates.sms_enabled ?? base.sms_enabled,
    cooldown_minutes: updates.cooldown_minutes ?? base.cooldown_minutes,
    notification_type_overrides:
      updates.notification_type_overrides ?? base.notification_type_overrides,
    updated_at: now,
  };

  await prefStore.save(updated);
  return updated;
}

export interface GrantSmsConsentInput {
  readonly tenantAccountId: string;
  readonly phoneNumber: string;
  readonly prefStore: NotificationPreferenceStore;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export async function grantSmsConsent(
  input: GrantSmsConsentInput,
): Promise<NotificationPreference> {
  const { tenantAccountId, phoneNumber, prefStore, idGenerator, clock } = input;
  const now = clock();
  const existing = await prefStore.get(tenantAccountId);
  const base = existing ?? defaultPrefs(tenantAccountId, idGenerator(), now);

  const updated: NotificationPreference = {
    ...base,
    sms_enabled: true,
    sms_consent: {
      phone_number: phoneNumber,
      consent_given_at: now,
      consent_revoked_at: null,
    },
    updated_at: now,
  };

  await prefStore.save(updated);
  return updated;
}

export interface RevokeSmsConsentInput {
  readonly tenantAccountId: string;
  readonly prefStore: NotificationPreferenceStore;
  readonly clock: () => string;
}

export async function revokeSmsConsent(
  input: RevokeSmsConsentInput,
): Promise<NotificationPreference> {
  const { tenantAccountId, prefStore, clock } = input;
  const now = clock();
  const existing = await prefStore.get(tenantAccountId);

  if (!existing || !existing.sms_consent) {
    // No consent to revoke — ensure prefs exist with defaults
    const def = defaultPrefs(tenantAccountId, 'default', now);
    await prefStore.save(def);
    return def;
  }

  const updated: NotificationPreference = {
    ...existing,
    sms_enabled: false,
    sms_consent: {
      ...existing.sms_consent,
      consent_revoked_at: now,
    },
    updated_at: now,
  };

  await prefStore.save(updated);
  return updated;
}
