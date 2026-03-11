import type { Pool } from '@neondatabase/serverless';
import type { SessionStore } from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async get(conversationId: string): Promise<ConversationSession | null> {
    const result = await this.pool.query('SELECT data FROM sessions WHERE conversation_id = $1', [
      conversationId,
    ]);
    return result.rows.length > 0 ? (result.rows[0].data as ConversationSession) : null;
  }

  async getByTenantUser(tenantUserId: string): Promise<readonly ConversationSession[]> {
    const result = await this.pool.query(
      'SELECT data FROM sessions WHERE tenant_user_id = $1 ORDER BY last_activity_at DESC',
      [tenantUserId],
    );
    return result.rows.map((row) => row.data as ConversationSession);
  }

  async save(session: ConversationSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (conversation_id, tenant_user_id, state, data, created_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conversation_id)
       DO UPDATE SET state = $3, data = $4, last_activity_at = $6`,
      [
        session.conversation_id,
        session.tenant_user_id,
        session.state,
        JSON.stringify(session),
        session.created_at,
        session.last_activity_at,
      ],
    );
  }
}
