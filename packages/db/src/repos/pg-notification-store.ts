import type { Pool } from '@neondatabase/serverless';
import type { NotificationEvent, NotificationPreference } from '@wo-agent/schemas';
import type { NotificationRepository, NotificationListFilters, NotificationPreferenceStore } from '@wo-agent/core';

export class PostgresNotificationStore implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async insert(event: NotificationEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_events
        (event_id, notification_id, conversation_id, tenant_user_id, tenant_account_id,
         channel, notification_type, work_order_ids, issue_group_id, template_id,
         status, idempotency_key, payload, created_at, sent_at, delivered_at, failed_at, failure_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.event_id, event.notification_id, event.conversation_id,
        event.tenant_user_id, event.tenant_account_id, event.channel,
        event.notification_type, event.work_order_ids,
        event.issue_group_id, event.template_id, event.status, event.idempotency_key,
        JSON.stringify(event.payload), event.created_at,
        event.sent_at, event.delivered_at, event.failed_at, event.failure_reason,
      ],
    );
  }

  async queryByTenantUser(tenantUserId: string, limit?: number): Promise<readonly NotificationEvent[]> {
    let sql = 'SELECT * FROM notification_events WHERE tenant_user_id = $1 ORDER BY created_at DESC';
    const values: unknown[] = [tenantUserId];
    if (limit !== undefined) {
      sql += ' LIMIT $2';
      values.push(limit);
    }
    const result = await this.pool.query(sql, values);
    return result.rows.map(mapRowToNotification);
  }

  async queryByConversation(conversationId: string): Promise<readonly NotificationEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM notification_events WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId],
    );
    return result.rows.map(mapRowToNotification);
  }

  async listAll(filters?: NotificationListFilters): Promise<readonly NotificationEvent[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.tenant_user_id) {
      conditions.push(`tenant_user_id = $${idx++}`);
      values.push(filters.tenant_user_id);
    }
    if (filters?.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters?.to) {
      conditions.push(`created_at < $${idx++}`);
      values.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM notification_events ${where} ORDER BY created_at`,
      values,
    );
    return result.rows.map(mapRowToNotification);
  }

  async findByIdempotencyKey(key: string): Promise<NotificationEvent | null> {
    const result = await this.pool.query(
      'SELECT * FROM notification_events WHERE idempotency_key = $1',
      [key],
    );
    return result.rows.length > 0 ? mapRowToNotification(result.rows[0]) : null;
  }

  async findRecentByTenantAndType(
    tenantUserId: string,
    notificationType: string,
    cooldownMinutes: number,
    now: string,
  ): Promise<readonly NotificationEvent[]> {
    const cutoff = new Date(new Date(now).getTime() - cooldownMinutes * 60_000).toISOString();
    const result = await this.pool.query(
      `SELECT * FROM notification_events
       WHERE tenant_user_id = $1 AND notification_type = $2 AND created_at >= $3`,
      [tenantUserId, notificationType, cutoff],
    );
    return result.rows.map(mapRowToNotification);
  }
}

export class PostgresNotificationPreferenceStore implements NotificationPreferenceStore {
  constructor(private readonly pool: Pool) {}

  async get(tenantAccountId: string): Promise<NotificationPreference | null> {
    const result = await this.pool.query(
      'SELECT * FROM notification_preferences WHERE tenant_account_id = $1',
      [tenantAccountId],
    );
    return result.rows.length > 0 ? mapRowToPref(result.rows[0]) : null;
  }

  async save(pref: NotificationPreference): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_preferences
        (preference_id, tenant_account_id, in_app_enabled, sms_enabled, sms_consent,
         notification_type_overrides, cooldown_minutes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_account_id)
       DO UPDATE SET in_app_enabled = $3, sms_enabled = $4, sms_consent = $5,
                     notification_type_overrides = $6, cooldown_minutes = $7, updated_at = $8`,
      [
        pref.preference_id, pref.tenant_account_id, pref.in_app_enabled, pref.sms_enabled,
        pref.sms_consent ? JSON.stringify(pref.sms_consent) : null,
        JSON.stringify(pref.notification_type_overrides), pref.cooldown_minutes, pref.updated_at,
      ],
    );
  }
}

function mapRowToNotification(row: Record<string, unknown>): NotificationEvent {
  return {
    event_id: row.event_id as string,
    notification_id: row.notification_id as string,
    conversation_id: row.conversation_id as string,
    tenant_user_id: row.tenant_user_id as string,
    tenant_account_id: row.tenant_account_id as string,
    channel: row.channel as NotificationEvent['channel'],
    notification_type: row.notification_type as NotificationEvent['notification_type'],
    work_order_ids: row.work_order_ids as string[],
    issue_group_id: (row.issue_group_id as string) ?? null,
    template_id: row.template_id as string,
    status: row.status as NotificationEvent['status'],
    idempotency_key: row.idempotency_key as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at as string,
    sent_at: row.sent_at ? (row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at as string) : null,
    delivered_at: row.delivered_at ? (row.delivered_at instanceof Date ? row.delivered_at.toISOString() : row.delivered_at as string) : null,
    failed_at: row.failed_at ? (row.failed_at instanceof Date ? row.failed_at.toISOString() : row.failed_at as string) : null,
    failure_reason: (row.failure_reason as string) ?? null,
  };
}

function mapRowToPref(row: Record<string, unknown>): NotificationPreference {
  return {
    preference_id: row.preference_id as string,
    tenant_account_id: row.tenant_account_id as string,
    in_app_enabled: row.in_app_enabled as boolean,
    sms_enabled: row.sms_enabled as boolean,
    sms_consent: (row.sms_consent as NotificationPreference['sms_consent']) ?? null,
    notification_type_overrides: (row.notification_type_overrides as Record<string, boolean>) ?? {},
    cooldown_minutes: row.cooldown_minutes as number,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at as string,
  };
}
