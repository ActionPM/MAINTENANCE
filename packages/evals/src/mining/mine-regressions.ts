export interface RegressionCandidate {
  readonly conversation_id: string;
  readonly signal: string;
  readonly issue_text?: string;
  readonly classification?: Record<string, string>;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface MineableEvent {
  readonly event_type: string;
  readonly conversation_id: string;
  readonly issue_text?: string;
  readonly classification?: Record<string, string>;
  readonly needs_human_triage?: boolean;
  readonly cap_exhausted?: boolean;
  readonly turn_number?: number;
  readonly tenant_edited_fields?: readonly string[];
  readonly human_override_fields?: readonly string[];
  readonly retry_count?: number;
  readonly contradictory?: boolean;
  readonly created_at: string;
}

/**
 * Scan events for regression candidate signals:
 * - needs_human_triage
 * - followup_cap_exhaustion
 * - tenant_correction (tenant edited classified fields during confirmation)
 * - human_override (staff overrode classification)
 * - contradictory_retry (classifier contradiction after retry)
 * - repeated_followup (same field asked multiple times)
 */
export function mineRegressionCandidates(events: readonly MineableEvent[]): RegressionCandidate[] {
  const candidates: RegressionCandidate[] = [];

  for (const event of events) {
    // Signal: needs_human_triage
    if (event.needs_human_triage) {
      candidates.push({
        conversation_id: event.conversation_id,
        signal: 'needs_human_triage',
        issue_text: event.issue_text,
        classification: event.classification,
        metadata: { event_type: event.event_type },
        created_at: event.created_at,
      });
    }

    // Signal: followup cap exhaustion
    if (event.cap_exhausted) {
      candidates.push({
        conversation_id: event.conversation_id,
        signal: 'followup_cap_exhaustion',
        issue_text: event.issue_text,
        metadata: { turn_number: event.turn_number, event_type: event.event_type },
        created_at: event.created_at,
      });
    }

    // Signal: tenant correction
    if (event.tenant_edited_fields && event.tenant_edited_fields.length > 0) {
      candidates.push({
        conversation_id: event.conversation_id,
        signal: 'tenant_correction',
        issue_text: event.issue_text,
        classification: event.classification,
        metadata: { edited_fields: event.tenant_edited_fields },
        created_at: event.created_at,
      });
    }

    // Signal: human override
    if (event.human_override_fields && event.human_override_fields.length > 0) {
      candidates.push({
        conversation_id: event.conversation_id,
        signal: 'human_override',
        issue_text: event.issue_text,
        classification: event.classification,
        metadata: { override_fields: event.human_override_fields },
        created_at: event.created_at,
      });
    }

    // Signal: contradictory retry
    if (event.contradictory && event.retry_count && event.retry_count > 0) {
      candidates.push({
        conversation_id: event.conversation_id,
        signal: 'contradictory_retry',
        issue_text: event.issue_text,
        classification: event.classification,
        metadata: { retry_count: event.retry_count },
        created_at: event.created_at,
      });
    }
  }

  return candidates;
}
