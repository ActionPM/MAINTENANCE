import type { NotificationEvent, NotificationPreference } from '@wo-agent/schemas';

/**
 * Notification event repository — append-only (spec §7, §20).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface NotificationRepository {
  /** Append a notification event. Rejects on duplicate event_id. */
  insert(event: NotificationEvent): Promise<void>;
  /** Query notification events for a tenant user, newest first. */
  queryByTenantUser(tenantUserId: string, limit?: number): Promise<readonly NotificationEvent[]>;
  /** Query notification events for a conversation. */
  queryByConversation(conversationId: string): Promise<readonly NotificationEvent[]>;
  /** Find an existing notification by idempotency key. Returns null if unseen. */
  findByIdempotencyKey(key: string): Promise<NotificationEvent | null>;
  /** Find recent notifications within cooldown window for dedup (spec §20). */
  findRecentByTenantAndType(
    tenantUserId: string,
    notificationType: string,
    cooldownMinutes: number,
    now: string,
  ): Promise<readonly NotificationEvent[]>;
}

/**
 * Notification preference store — mutable (not an event table).
 */
export interface NotificationPreferenceStore {
  /** Get preferences for a tenant account. Returns null if no prefs set (use defaults). */
  get(tenantAccountId: string): Promise<NotificationPreference | null>;
  /** Save/update preferences for a tenant account. */
  save(pref: NotificationPreference): Promise<void>;
}

/**
 * SMS sender abstraction. MVP: no-op / mock.
 * Production: Twilio or similar.
 */
export interface SmsSender {
  send(phoneNumber: string, message: string): Promise<{ success: boolean; error?: string }>;
}
