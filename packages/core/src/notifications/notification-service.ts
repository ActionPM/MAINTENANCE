import type { NotificationPreference } from '@wo-agent/schemas';
import type { NotificationRepository, NotificationPreferenceStore, SmsSender } from './types.js';
import { buildWoCreatedNotificationEvent } from './event-builder.js';

const DEFAULT_COOLDOWN_MINUTES = 5;

export interface NotificationServiceDeps {
  readonly notificationRepo: NotificationRepository;
  readonly preferenceStore: NotificationPreferenceStore;
  readonly smsSender: SmsSender;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export interface NotifyWoCreatedInput {
  readonly conversationId: string;
  readonly tenantUserId: string;
  readonly tenantAccountId: string;
  readonly workOrderIds: readonly string[];
  readonly issueGroupId: string;
  readonly idempotencyKey: string;
}

export interface NotifyResult {
  readonly in_app_sent: boolean;
  readonly sms_sent: boolean;
  readonly sms_failed?: boolean;
  readonly deduplicated?: boolean;
  readonly cooldown_suppressed?: boolean;
}

/**
 * Notification service (spec §20).
 * Sends in-app + SMS notifications with batching, dedup, preferences, and consent.
 */
export class NotificationService {
  private readonly deps: NotificationServiceDeps;

  constructor(deps: NotificationServiceDeps) {
    this.deps = deps;
  }

  async notifyWorkOrdersCreated(input: NotifyWoCreatedInput): Promise<NotifyResult> {
    const { notificationRepo, preferenceStore, idGenerator, clock } = this.deps;
    const now = clock();

    // 1. Idempotency dedup (spec §18, §20)
    const existing = await notificationRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { in_app_sent: false, sms_sent: false, deduplicated: true };
    }

    // 2. Load preferences (defaults: in-app on, sms off)
    const prefs = await preferenceStore.get(input.tenantAccountId);
    const inAppEnabled = prefs?.in_app_enabled ?? true;
    const smsEnabled = this.isSmsEnabled(prefs);
    const cooldownMinutes = prefs?.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES;

    // 3. Cooldown dedup (spec §20)
    const recent = await notificationRepo.findRecentByTenantAndType(
      input.tenantUserId,
      'work_order_created',
      cooldownMinutes,
      now,
    );
    if (recent.length > 0) {
      return { in_app_sent: false, sms_sent: false, cooldown_suppressed: true };
    }

    let inAppSent = false;
    let smsSent = false;
    let smsFailed = false;

    // 4. Send in-app notification
    if (inAppEnabled) {
      const notifId = idGenerator();
      const event = buildWoCreatedNotificationEvent({
        eventId: idGenerator(),
        notificationId: notifId,
        conversationId: input.conversationId,
        tenantUserId: input.tenantUserId,
        tenantAccountId: input.tenantAccountId,
        channel: 'in_app',
        workOrderIds: input.workOrderIds,
        issueGroupId: input.issueGroupId,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });
      await notificationRepo.insert(event);
      inAppSent = true;
    }

    // 5. Send SMS if enabled + consent valid (spec §20 — default SMS off)
    if (smsEnabled && prefs?.sms_consent) {
      const smsResult = await this.deps.smsSender.send(
        prefs.sms_consent.phone_number,
        this.buildSmsMessage(input.workOrderIds.length),
      );

      const smsNotifId = idGenerator();
      const smsEvent = buildWoCreatedNotificationEvent({
        eventId: idGenerator(),
        notificationId: smsNotifId,
        conversationId: input.conversationId,
        tenantUserId: input.tenantUserId,
        tenantAccountId: input.tenantAccountId,
        channel: 'sms',
        workOrderIds: input.workOrderIds,
        issueGroupId: input.issueGroupId,
        idempotencyKey: `${input.idempotencyKey}-sms`,
        createdAt: now,
      });

      if (smsResult.success) {
        await notificationRepo.insert({
          ...smsEvent,
          status: 'sent',
          sent_at: now,
        });
        smsSent = true;
      } else {
        await notificationRepo.insert({
          ...smsEvent,
          status: 'failed',
          failed_at: now,
          failure_reason: smsResult.error ?? 'Unknown error',
        });
        smsFailed = true;
      }
    }

    return { in_app_sent: inAppSent, sms_sent: smsSent, sms_failed: smsFailed || undefined };
  }

  private isSmsEnabled(prefs: NotificationPreference | null): boolean {
    if (!prefs) return false;
    if (!prefs.sms_enabled) return false;
    if (!prefs.sms_consent) return false;
    // Consent revoked?
    if (prefs.sms_consent.consent_revoked_at !== null) return false;
    return true;
  }

  private buildSmsMessage(woCount: number): string {
    return woCount === 1
      ? 'Your service request has been submitted. Check the app for details.'
      : `Your ${woCount} service requests have been submitted. Check the app for details.`;
  }
}
