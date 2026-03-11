import type { NotificationEvent, NotificationPreference } from '@wo-agent/schemas';
import type {
  NotificationRepository,
  NotificationPreferenceStore,
  NotificationListFilters,
} from './types.js';

/**
 * In-memory notification event store for testing (append-only).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export class InMemoryNotificationStore implements NotificationRepository {
  private readonly events: NotificationEvent[] = [];
  private readonly ids = new Set<string>();

  async insert(event: NotificationEvent): Promise<void> {
    if (this.ids.has(event.event_id)) {
      throw new Error(`Duplicate event_id: ${event.event_id}`);
    }
    this.ids.add(event.event_id);
    this.events.push(event);
  }

  async listAll(filters?: NotificationListFilters): Promise<readonly NotificationEvent[]> {
    let results = [...this.events];

    if (filters?.tenant_user_id) {
      results = results.filter((e) => e.tenant_user_id === filters.tenant_user_id);
    }
    if (filters?.from) {
      const fromMs = new Date(filters.from).getTime();
      results = results.filter((e) => new Date(e.created_at).getTime() >= fromMs);
    }
    if (filters?.to) {
      const toMs = new Date(filters.to).getTime();
      results = results.filter((e) => new Date(e.created_at).getTime() < toMs);
    }

    return results;
  }

  async queryByTenantUser(
    tenantUserId: string,
    limit?: number,
  ): Promise<readonly NotificationEvent[]> {
    const results = this.events
      .filter((e) => e.tenant_user_id === tenantUserId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return limit ? results.slice(0, limit) : results;
  }

  async queryByConversation(conversationId: string): Promise<readonly NotificationEvent[]> {
    return this.events
      .filter((e) => e.conversation_id === conversationId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async findByIdempotencyKey(key: string): Promise<NotificationEvent | null> {
    return this.events.find((e) => e.idempotency_key === key) ?? null;
  }

  async findRecentByTenantAndType(
    tenantUserId: string,
    notificationType: string,
    cooldownMinutes: number,
    now: string,
  ): Promise<readonly NotificationEvent[]> {
    const cutoff = new Date(now).getTime() - cooldownMinutes * 60_000;
    return this.events.filter(
      (e) =>
        e.tenant_user_id === tenantUserId &&
        e.notification_type === notificationType &&
        new Date(e.created_at).getTime() >= cutoff,
    );
  }
}

/**
 * In-memory notification preference store for testing.
 */
export class InMemoryNotificationPreferenceStore implements NotificationPreferenceStore {
  private readonly prefs = new Map<string, NotificationPreference>();

  async get(tenantAccountId: string): Promise<NotificationPreference | null> {
    return this.prefs.get(tenantAccountId) ?? null;
  }

  async save(pref: NotificationPreference): Promise<void> {
    this.prefs.set(pref.tenant_account_id, pref);
  }
}
