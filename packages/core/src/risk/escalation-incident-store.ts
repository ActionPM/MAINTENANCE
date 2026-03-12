import type { EscalationIncident } from '@wo-agent/schemas';

/**
 * Store for mutable escalation incident records (plan §3.4).
 *
 * Justified because:
 * - Delayed retries need durable scheduling state
 * - Inbound SMS replies need idempotent claim handling
 * - Stand-down notifications need fast lookup of contacted numbers
 * - Reconstructing workflow state from append-only events on every webhook is impractical
 *
 * Uses optimistic locking via `row_version` for concurrent ACCEPT handling.
 */
export interface EscalationIncidentStore {
  /**
   * Insert a new incident. Returns true if created, false if a duplicate active
   * incident already exists for the same conversation (unique constraint).
   */
  create(incident: EscalationIncident): Promise<boolean>;
  getById(incidentId: string): Promise<EscalationIncident | null>;
  getActiveByConversation(conversationId: string): Promise<EscalationIncident | null>;
  getDueIncidents(now: string): Promise<readonly EscalationIncident[]>;
  /** Find active incidents that have contacted this phone number. */
  getActiveByContactedPhone(phone: string): Promise<readonly EscalationIncident[]>;
  /** CAS update — returns true if version matched, false on conflict. */
  update(incident: EscalationIncident, expectedVersion: number): Promise<boolean>;
  /** Count overdue incidents (active/exhausted_retrying, past next_action_at, not locked). */
  countOverdue(): Promise<number>;
}
