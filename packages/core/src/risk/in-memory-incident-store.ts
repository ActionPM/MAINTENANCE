import type { EscalationIncident } from '@wo-agent/schemas';
import type { EscalationIncidentStore } from './escalation-incident-store.js';

/**
 * In-memory implementation of EscalationIncidentStore for tests.
 * Uses a Map keyed by incident_id with CAS via row_version.
 */
export class InMemoryEscalationIncidentStore implements EscalationIncidentStore {
  private readonly incidents = new Map<string, EscalationIncident>();

  async create(incident: EscalationIncident): Promise<boolean> {
    if (this.incidents.has(incident.incident_id)) {
      return false;
    }
    // Enforce one-active-per-conversation constraint (mirrors DB partial unique index)
    for (const existing of this.incidents.values()) {
      if (
        existing.conversation_id === incident.conversation_id &&
        (existing.status === 'active' || existing.status === 'exhausted_retrying')
      ) {
        return false;
      }
    }
    this.incidents.set(incident.incident_id, incident);
    return true;
  }

  async getById(incidentId: string): Promise<EscalationIncident | null> {
    return this.incidents.get(incidentId) ?? null;
  }

  async getActiveByConversation(conversationId: string): Promise<EscalationIncident | null> {
    for (const incident of this.incidents.values()) {
      if (
        incident.conversation_id === conversationId &&
        (incident.status === 'active' || incident.status === 'exhausted_retrying')
      ) {
        return incident;
      }
    }
    return null;
  }

  async getDueIncidents(now: string): Promise<readonly EscalationIncident[]> {
    const results: EscalationIncident[] = [];
    for (const incident of this.incidents.values()) {
      if (incident.status !== 'active' && incident.status !== 'exhausted_retrying') continue;
      if (incident.next_action_at > now) continue;
      if (incident.processing_lock_until !== null && incident.processing_lock_until > now) continue;
      results.push(incident);
    }
    return results;
  }

  async getActiveByContactedPhone(phone: string): Promise<readonly EscalationIncident[]> {
    const results: EscalationIncident[] = [];
    for (const incident of this.incidents.values()) {
      if (incident.status !== 'active' && incident.status !== 'exhausted_retrying') continue;
      if (incident.contacted_phone_numbers.includes(phone)) {
        results.push(incident);
      }
    }
    return results;
  }

  async update(incident: EscalationIncident, expectedVersion: number): Promise<boolean> {
    const existing = this.incidents.get(incident.incident_id);
    if (!existing) return false;
    if (existing.row_version !== expectedVersion) return false;
    this.incidents.set(incident.incident_id, {
      ...incident,
      row_version: expectedVersion + 1,
    });
    return true;
  }

  async countOverdue(): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const incident of this.incidents.values()) {
      if (incident.status !== 'active' && incident.status !== 'exhausted_retrying') continue;
      if (incident.next_action_at > now) continue;
      if (incident.processing_lock_until !== null && incident.processing_lock_until > now) continue;
      count++;
    }
    return count;
  }

  /** Test helper: get all incidents. */
  getAll(): readonly EscalationIncident[] {
    return Array.from(this.incidents.values());
  }

  /** Test helper: clear all incidents. */
  clear(): void {
    this.incidents.clear();
  }
}
