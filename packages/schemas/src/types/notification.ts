/**
 * Notification channel (spec §20 — in-app + outbound SMS only).
 */
export type NotificationChannel = 'in_app' | 'sms';

/**
 * Notification types for the system.
 * work_order_created: sent after CONFIRM_SUBMISSION creates WOs
 * status_changed: sent when WO status updates
 * needs_input: sent when follow-up questions are pending
 */
export type NotificationType = 'work_order_created' | 'status_changed' | 'needs_input';

/**
 * Notification delivery status.
 */
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed';

/**
 * Append-only notification event (spec §7 — notification_events table).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface NotificationEvent {
  readonly event_id: string;
  readonly notification_id: string;
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly channel: NotificationChannel;
  readonly notification_type: NotificationType;
  /** WO IDs — multiple for batched multi-issue notifications (spec §20). */
  readonly work_order_ids: readonly string[];
  readonly issue_group_id: string | null;
  readonly template_id: string;
  readonly status: NotificationStatus;
  readonly idempotency_key: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
  readonly sent_at: string | null;
  readonly delivered_at: string | null;
  readonly failed_at: string | null;
  readonly failure_reason: string | null;
}

/**
 * SMS consent record (spec §20 — default SMS off until consent).
 */
export interface SmsConsent {
  readonly phone_number: string;
  readonly consent_given_at: string;
  readonly consent_revoked_at: string | null;
}

/**
 * Notification preferences per tenant account (spec §20).
 * Preferences are mutable — not an event table.
 */
export interface NotificationPreference {
  readonly preference_id: string;
  readonly tenant_account_id: string;
  readonly in_app_enabled: boolean;
  readonly sms_enabled: boolean;
  readonly sms_consent: SmsConsent | null;
  /** Per-type overrides. Key is NotificationType, value is enabled. Missing = default. */
  readonly notification_type_overrides: Readonly<Record<string, boolean>>;
  readonly cooldown_minutes: number;
  readonly updated_at: string;
}
