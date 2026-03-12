import type {
  MatchedTrigger,
  RiskSeverity,
  EscalationResult,
  EscalationAttemptOutcome,
} from '@wo-agent/schemas';

/** All risk event types (append-only, INSERT only, no UPDATE/DELETE — spec §7). */
export type RiskEventType =
  | 'risk_detected'
  | 'escalation_attempt'
  | 'escalation_result'
  | 'emergency_confirmation_requested'
  | 'emergency_confirmed'
  | 'emergency_declined'
  | 'escalation_incident_started'
  | 'voice_call_initiated'
  | 'voice_call_completed'
  | 'sms_prompt_sent'
  | 'sms_reply_received'
  | 'stand_down_sent'
  | 'cycle_exhausted'
  | 'internal_alert_sent'
  | 'escalation_incident_closed';

/**
 * Risk event row — append-only, INSERT only, no UPDATE/DELETE (spec §7).
 */
export interface RiskEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: RiskEventType;
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

// --- Production escalation event builders (plan §3.4) ---

interface BaseEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly createdAt: string;
}

export interface EmergencyConfirmationRequestedInput extends BaseEventInput {
  readonly triggerIds: readonly string[];
  readonly buildingId: string | null;
}

export function buildEmergencyConfirmationRequestedEvent(
  input: EmergencyConfirmationRequestedInput,
): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'emergency_confirmation_requested',
    payload: { trigger_ids: input.triggerIds, building_id: input.buildingId },
    created_at: input.createdAt,
  };
}

export interface EmergencyConfirmedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly planId: string;
  readonly buildingId: string;
}

export function buildEmergencyConfirmedEvent(input: EmergencyConfirmedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'emergency_confirmed',
    payload: {
      incident_id: input.incidentId,
      plan_id: input.planId,
      building_id: input.buildingId,
    },
    created_at: input.createdAt,
  };
}

export interface EmergencyDeclinedInput extends BaseEventInput {}

export function buildEmergencyDeclinedEvent(input: EmergencyDeclinedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'emergency_declined',
    payload: {},
    created_at: input.createdAt,
  };
}

export interface IncidentStartedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly planId: string;
  readonly buildingId: string;
  readonly maxCycles: number;
}

export function buildIncidentStartedEvent(input: IncidentStartedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'escalation_incident_started',
    payload: {
      incident_id: input.incidentId,
      plan_id: input.planId,
      building_id: input.buildingId,
      max_cycles: input.maxCycles,
    },
    created_at: input.createdAt,
  };
}

export interface VoiceCallInitiatedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly contactId: string;
  readonly phone: string;
  readonly cycleNumber: number;
  readonly callSid?: string;
}

export function buildVoiceCallInitiatedEvent(input: VoiceCallInitiatedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'voice_call_initiated',
    payload: {
      incident_id: input.incidentId,
      contact_id: input.contactId,
      phone: input.phone,
      cycle_number: input.cycleNumber,
      call_sid: input.callSid ?? null,
    },
    created_at: input.createdAt,
  };
}

export interface VoiceCallCompletedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly contactId: string;
  readonly outcome: EscalationAttemptOutcome;
  readonly callSid?: string;
}

export function buildVoiceCallCompletedEvent(input: VoiceCallCompletedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'voice_call_completed',
    payload: {
      incident_id: input.incidentId,
      contact_id: input.contactId,
      outcome: input.outcome,
      call_sid: input.callSid ?? null,
    },
    created_at: input.createdAt,
  };
}

export interface SmsPromptSentInput extends BaseEventInput {
  readonly incidentId: string;
  readonly contactId: string;
  readonly phone: string;
  readonly messageSid?: string;
}

export function buildSmsPromptSentEvent(input: SmsPromptSentInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'sms_prompt_sent',
    payload: {
      incident_id: input.incidentId,
      contact_id: input.contactId,
      phone: input.phone,
      message_sid: input.messageSid ?? null,
    },
    created_at: input.createdAt,
  };
}

export interface SmsReplyReceivedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly phone: string;
  readonly reply: 'ACCEPT' | 'IGNORE' | 'unknown';
  readonly rawBody: string;
}

export function buildSmsReplyReceivedEvent(input: SmsReplyReceivedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'sms_reply_received',
    payload: {
      incident_id: input.incidentId,
      phone: input.phone,
      reply: input.reply,
      raw_body: input.rawBody,
    },
    created_at: input.createdAt,
  };
}

export interface StandDownSentInput extends BaseEventInput {
  readonly incidentId: string;
  readonly recipientPhones: readonly string[];
  readonly acceptedByPhone: string;
}

export function buildStandDownSentEvent(input: StandDownSentInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'stand_down_sent',
    payload: {
      incident_id: input.incidentId,
      recipient_phones: input.recipientPhones,
      accepted_by_phone: input.acceptedByPhone,
    },
    created_at: input.createdAt,
  };
}

export interface CycleExhaustedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly cycleNumber: number;
  readonly maxCycles: number;
  readonly willRetry: boolean;
}

export function buildCycleExhaustedEvent(input: CycleExhaustedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'cycle_exhausted',
    payload: {
      incident_id: input.incidentId,
      cycle_number: input.cycleNumber,
      max_cycles: input.maxCycles,
      will_retry: input.willRetry,
    },
    created_at: input.createdAt,
  };
}

export interface InternalAlertSentInput extends BaseEventInput {
  readonly incidentId: string;
  readonly cycleNumber: number;
  readonly alertPhone: string;
}

export function buildInternalAlertSentEvent(input: InternalAlertSentInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'internal_alert_sent',
    payload: {
      incident_id: input.incidentId,
      cycle_number: input.cycleNumber,
      alert_phone: input.alertPhone,
    },
    created_at: input.createdAt,
  };
}

export interface IncidentClosedInput extends BaseEventInput {
  readonly incidentId: string;
  readonly finalStatus: string;
  readonly acceptedByPhone?: string | null;
  readonly acceptedByContactId?: string | null;
}

export function buildIncidentClosedEvent(input: IncidentClosedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'escalation_incident_closed',
    payload: {
      incident_id: input.incidentId,
      final_status: input.finalStatus,
      accepted_by_phone: input.acceptedByPhone ?? null,
      accepted_by_contact_id: input.acceptedByContactId ?? null,
    },
    created_at: input.createdAt,
  };
}
