import type { Pool } from '@neondatabase/serverless';
import type { NotificationEvent } from '@wo-agent/schemas';
import type { EventRepository } from '@wo-agent/core';
import type { ConversationEvent, EventQuery } from '@wo-agent/core';
import type { ConfirmationEvent, StalenessEvent } from '@wo-agent/core';
import type { RiskEvent } from '@wo-agent/core';
import type { FollowUpEvent } from '@wo-agent/core';

type AnyEvent = ConversationEvent | FollowUpEvent | ConfirmationEvent | StalenessEvent | RiskEvent | NotificationEvent;

/**
 * PostgreSQL-backed event store (append-only, spec §7).
 * INSERT + SELECT only. Trigger guards prevent UPDATE/DELETE in the DB.
 */
export class PostgresEventStore implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async insert(event: AnyEvent): Promise<void> {
    const e = event as ConversationEvent;
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
    created_at: (row.created_at as Date).toISOString(),
  };
}
