import type { MatchedTrigger, RiskSeverity, EscalationResult } from '@wo-agent/schemas';

/**
 * Risk event row — append-only, INSERT only, no UPDATE/DELETE (spec §7).
 */
export interface RiskEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: 'risk_detected' | 'escalation_attempt' | 'escalation_result';
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

export interface RiskDetectedInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly triggersMatched: readonly MatchedTrigger[];
  readonly hasEmergency: boolean;
  readonly highestSeverity: RiskSeverity | null;
  readonly createdAt: string;
}

export function buildRiskDetectedEvent(input: RiskDetectedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'risk_detected',
    payload: {
      triggers_matched: input.triggersMatched.map((t) => ({
        trigger_id: t.trigger.trigger_id,
        name: t.trigger.name,
        severity: t.trigger.severity,
        matched_keywords: t.matched_keywords,
        matched_regex: t.matched_regex,
        matched_taxonomy_paths: t.matched_taxonomy_paths,
      })),
      has_emergency: input.hasEmergency,
      highest_severity: input.highestSeverity,
    },
    created_at: input.createdAt,
  };
}

export interface EscalationAttemptInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly role: string;
  readonly name: string;
  readonly answered: boolean;
  readonly createdAt: string;
}

export function buildEscalationAttemptEvent(input: EscalationAttemptInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'escalation_attempt',
    payload: {
      contact_id: input.contactId,
      role: input.role,
      name: input.name,
      answered: input.answered,
    },
    created_at: input.createdAt,
  };
}

export interface EscalationResultInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly escalationResult: EscalationResult;
  readonly createdAt: string;
}

export function buildEscalationResultEvent(input: EscalationResultInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'escalation_result',
    payload: {
      plan_id: input.escalationResult.plan_id,
      state: input.escalationResult.state,
      attempts: input.escalationResult.attempts,
      answered_by: input.escalationResult.answered_by,
      exhaustion_message: input.escalationResult.exhaustion_message,
    },
    created_at: input.createdAt,
  };
}
