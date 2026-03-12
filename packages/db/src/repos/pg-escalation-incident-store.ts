import type { Pool } from '@neondatabase/serverless';
import type { EscalationIncident, EscalationContactAttempt } from '@wo-agent/schemas';
import type { EscalationIncidentStore } from '@wo-agent/core';

/**
 * PostgreSQL escalation incident store with optimistic locking (CAS via row_version).
 * Durable store for production emergency routing — survives serverless cold starts.
 */
export class PostgresEscalationIncidentStore implements EscalationIncidentStore {
  constructor(private readonly pool: Pool) {}

  async create(incident: EscalationIncident): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `INSERT INTO escalation_incidents
          (incident_id, conversation_id, building_id, plan_id, summary, status,
           cycle_number, max_cycles, current_contact_index, next_action_at,
           processing_lock_until, last_provider_action, accepted_by_phone,
           accepted_by_contact_id, accepted_at, contacted_phone_numbers,
           internal_alert_sent_cycles, attempts, row_version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          incident.incident_id,
          incident.conversation_id,
          incident.building_id,
          incident.plan_id,
          incident.summary,
          incident.status,
          incident.cycle_number,
          incident.max_cycles,
          incident.current_contact_index,
          incident.next_action_at,
          incident.processing_lock_until,
          incident.last_provider_action,
          incident.accepted_by_phone,
          incident.accepted_by_contact_id,
          incident.accepted_at,
          [...incident.contacted_phone_numbers],
          [...incident.internal_alert_sent_cycles],
          JSON.stringify(incident.attempts),
          incident.row_version,
          incident.created_at,
          incident.updated_at,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      // Postgres unique_violation (23505) from partial unique index
      // idx_escalation_incidents_one_active_per_convo — duplicate active incident
      if ((err as { code?: string }).code === '23505') {
        return false;
      }
      throw err;
    }
  }

  async getById(incidentId: string): Promise<EscalationIncident | null> {
    const result = await this.pool.query(
      'SELECT * FROM escalation_incidents WHERE incident_id = $1',
      [incidentId],
    );
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
  }

  async getActiveByConversation(conversationId: string): Promise<EscalationIncident | null> {
    const result = await this.pool.query(
      `SELECT * FROM escalation_incidents
       WHERE conversation_id = $1 AND status IN ('active', 'exhausted_retrying')
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    );
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
  }

  async getDueIncidents(now: string): Promise<readonly EscalationIncident[]> {
    const result = await this.pool.query(
      `SELECT * FROM escalation_incidents
       WHERE status IN ('active', 'exhausted_retrying')
         AND next_action_at <= $1
         AND (processing_lock_until IS NULL OR processing_lock_until < $1)
       ORDER BY next_action_at`,
      [now],
    );
    return result.rows.map(mapRow);
  }

  async getActiveByContactedPhone(phone: string): Promise<readonly EscalationIncident[]> {
    const result = await this.pool.query(
      `SELECT * FROM escalation_incidents
       WHERE status IN ('active', 'exhausted_retrying')
         AND $1 = ANY(contacted_phone_numbers)`,
      [phone],
    );
    return result.rows.map(mapRow);
  }

  async update(incident: EscalationIncident, expectedVersion: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE escalation_incidents
       SET status = $1,
           cycle_number = $2,
           current_contact_index = $3,
           next_action_at = $4,
           processing_lock_until = $5,
           last_provider_action = $6,
           accepted_by_phone = $7,
           accepted_by_contact_id = $8,
           accepted_at = $9,
           contacted_phone_numbers = $10,
           internal_alert_sent_cycles = $11,
           attempts = $12,
           row_version = row_version + 1,
           updated_at = $13
       WHERE incident_id = $14 AND row_version = $15`,
      [
        incident.status,
        incident.cycle_number,
        incident.current_contact_index,
        incident.next_action_at,
        incident.processing_lock_until,
        incident.last_provider_action,
        incident.accepted_by_phone,
        incident.accepted_by_contact_id,
        incident.accepted_at,
        [...incident.contacted_phone_numbers],
        [...incident.internal_alert_sent_cycles],
        JSON.stringify(incident.attempts),
        incident.updated_at,
        incident.incident_id,
        expectedVersion,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async countOverdue(): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM escalation_incidents
       WHERE status IN ('active', 'exhausted_retrying')
         AND next_action_at <= NOW()
         AND (processing_lock_until IS NULL OR processing_lock_until < NOW())`,
    );
    return Number(result.rows[0].cnt);
  }
}

function mapRow(row: Record<string, unknown>): EscalationIncident {
  return {
    incident_id: row.incident_id as string,
    conversation_id: row.conversation_id as string,
    building_id: row.building_id as string,
    plan_id: row.plan_id as string,
    summary: row.summary as string,
    status: row.status as EscalationIncident['status'],
    cycle_number: row.cycle_number as number,
    max_cycles: row.max_cycles as number,
    current_contact_index: row.current_contact_index as number,
    next_action_at: toIso(row.next_action_at),
    processing_lock_until: row.processing_lock_until ? toIso(row.processing_lock_until) : null,
    last_provider_action: row.last_provider_action as string | null,
    accepted_by_phone: row.accepted_by_phone as string | null,
    accepted_by_contact_id: row.accepted_by_contact_id as string | null,
    accepted_at: row.accepted_at ? toIso(row.accepted_at) : null,
    contacted_phone_numbers: row.contacted_phone_numbers as string[],
    internal_alert_sent_cycles: row.internal_alert_sent_cycles as number[],
    attempts: row.attempts as readonly EscalationContactAttempt[],
    row_version: row.row_version as number,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : (value as string);
}
