import type { Pool } from '@neondatabase/serverless';
import type { NotificationEvent, FollowUpEvent } from '@wo-agent/schemas';
import type { EventRepository } from '@wo-agent/core';
import type { ConversationEvent, EventQuery } from '@wo-agent/core';
import type { ConfirmationEvent, StalenessEvent } from '@wo-agent/core';
import type { RiskEvent } from '@wo-agent/core';
import type { ClassificationEvent } from '@wo-agent/core';

type AnyEvent =
  | ConversationEvent
  | FollowUpEvent
  | ConfirmationEvent
  | StalenessEvent
  | RiskEvent
  | NotificationEvent
  | ClassificationEvent;

/* ------------------------------------------------------------------ */
/*  Structural type guards                                            */
/* ------------------------------------------------------------------ */

const CLASSIFICATION_EVENT_TYPES = new Set<ClassificationEvent['event_type']>([
  'classification_hierarchy_violation_unresolved',
  'classification_constraint_resolution',
  'classification_pinned_answer_contradiction',
  'classification_descendant_invalidation',
]);

function isNotificationEvent(e: AnyEvent): e is NotificationEvent {
  return 'notification_id' in e;
}

function isClassificationEvent(e: AnyEvent): e is ClassificationEvent {
  return (
    'issue_id' in e &&
    'event_type' in e &&
    typeof e.event_type === 'string' &&
    CLASSIFICATION_EVENT_TYPES.has(e.event_type as ClassificationEvent['event_type'])
  );
}

function isFollowUpEvent(e: AnyEvent): e is FollowUpEvent {
  return 'issue_id' in e && 'turn_number' in e;
}

function isConversationEvent(e: AnyEvent): e is ConversationEvent {
  return 'actor' in e;
}

/**
 * PostgreSQL-backed event store (append-only, spec §7).
 * INSERT + SELECT only. Trigger guards prevent UPDATE/DELETE in the DB.
 */
export class PostgresEventStore implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async insert(event: AnyEvent): Promise<void> {
    if (isNotificationEvent(event)) {
      return this.insertNotification(event);
    }
    if (isClassificationEvent(event)) {
      return this.insertClassification(event);
    }
    if (isFollowUpEvent(event)) {
      return this.insertFollowUp(event);
    }
    if (isConversationEvent(event)) {
      return this.insertConversation(event);
    }
    // RiskEvent | ConfirmationEvent | StalenessEvent — have event_type + payload
    return this.insertMinimalEvent(event);
  }

  /** ConversationEvent → conversation_events with all columns. */
  private async insertConversation(e: ConversationEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_events
        (event_id, conversation_id, event_type, prior_state, new_state, action_type, actor, payload, pinned_versions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        e.event_id,
        e.conversation_id,
        e.event_type,
        e.prior_state ?? null,
        e.new_state ?? null,
        e.action_type ?? null,
        e.actor,
        e.payload ? JSON.stringify(e.payload) : null,
        e.pinned_versions ? JSON.stringify(e.pinned_versions) : null,
        e.created_at,
      ],
    );
  }

  /**
   * RiskEvent | ConfirmationEvent | StalenessEvent → conversation_events.
   * These have event_type + payload but no actor/state/pinned_versions.
   */
  private async insertMinimalEvent(
    e: RiskEvent | ConfirmationEvent | StalenessEvent,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_events
        (event_id, conversation_id, event_type, prior_state, new_state, action_type, actor, payload, pinned_versions, created_at)
       VALUES ($1, $2, $3, NULL, NULL, NULL, 'system', $4, NULL, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [e.event_id, e.conversation_id, e.event_type, JSON.stringify(e.payload), e.created_at],
    );
  }

  /**
   * FollowUpEvent → conversation_events.
   * Derives event_type from answers_received presence and packs fields into payload.
   */
  private async insertFollowUp(e: FollowUpEvent): Promise<void> {
    const eventType = e.answers_received ? 'followup_answers_received' : 'followup_questions_asked';
    const payload = {
      issue_id: e.issue_id,
      turn_number: e.turn_number,
      questions_asked: e.questions_asked,
      answers_received: e.answers_received,
    };
    await this.pool.query(
      `INSERT INTO conversation_events
        (event_id, conversation_id, event_type, prior_state, new_state, action_type, actor, payload, pinned_versions, created_at)
       VALUES ($1, $2, $3, NULL, NULL, NULL, 'system', $4, NULL, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [e.event_id, e.conversation_id, eventType, JSON.stringify(payload), e.created_at],
    );
  }

  /**
   * ClassificationEvent → conversation_events.
   * Preserves issue_id as a discrete queryable field inside the JSONB payload
   * so classification-event audit queries can filter by issue_id without
   * scanning the entire payload (S07-05).
   */
  private async insertClassification(e: ClassificationEvent): Promise<void> {
    const payload = {
      ...e.payload,
      issue_id: e.issue_id,
    };
    await this.pool.query(
      `INSERT INTO conversation_events
        (event_id, conversation_id, event_type, prior_state, new_state, action_type, actor, payload, pinned_versions, created_at)
       VALUES ($1, $2, $3, NULL, NULL, NULL, 'system', $4, NULL, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [e.event_id, e.conversation_id, e.event_type, JSON.stringify(payload), e.created_at],
    );
  }

  /** NotificationEvent → notification_events table. */
  private async insertNotification(e: NotificationEvent): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO notification_events
          (event_id, notification_id, conversation_id, tenant_user_id, tenant_account_id,
           channel, notification_type, work_order_ids, issue_group_id, template_id,
           status, idempotency_key, payload, created_at, sent_at, delivered_at, failed_at, failure_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          e.event_id,
          e.notification_id,
          e.conversation_id,
          e.tenant_user_id,
          e.tenant_account_id,
          e.channel,
          e.notification_type,
          e.work_order_ids,
          e.issue_group_id,
          e.template_id,
          e.status,
          e.idempotency_key,
          JSON.stringify(e.payload),
          e.created_at,
          e.sent_at,
          e.delivered_at,
          e.failed_at,
          e.failure_reason,
        ],
      );
    } catch (err: unknown) {
      // Unique violation on idempotency_key (code 23505) — treat as safe dedup
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') return;
      throw err;
    }
  }

  async query(filters: EventQuery): Promise<readonly ConversationEvent[]> {
    const conditions: string[] = ['conversation_id = $1'];
    const values: unknown[] = [filters.conversation_id];
    let paramIndex = 2;

    if (filters.event_type) {
      conditions.push(`event_type = $${paramIndex}`);
      values.push(filters.event_type);
      paramIndex++;
    }

    const order = filters.order === 'desc' ? 'DESC' : 'ASC';
    let sql = `SELECT * FROM conversation_events WHERE ${conditions.join(' AND ')} ORDER BY created_at ${order}`;

    if (filters.limit !== undefined) {
      sql += ` LIMIT $${paramIndex}`;
      values.push(filters.limit);
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map(mapRowToConversationEvent);
  }
}

function mapRowToConversationEvent(row: Record<string, unknown>): ConversationEvent {
  return {
    event_id: row.event_id as string,
    conversation_id: row.conversation_id as string,
    event_type: row.event_type as ConversationEvent['event_type'],
    prior_state: (row.prior_state as string) ?? null,
    new_state: (row.new_state as string) ?? null,
    action_type: (row.action_type as string) ?? null,
    actor: row.actor as ConversationEvent['actor'],
    payload: (row.payload as Record<string, unknown>) ?? null,
    pinned_versions: (row.pinned_versions as ConversationEvent['pinned_versions']) ?? null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at as string),
  };
}
