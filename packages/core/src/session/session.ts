import { ConversationState } from '@wo-agent/schemas';
import type { SplitIssue, FollowUpQuestion, PreviousQuestion, MatchedTrigger, EscalationState } from '@wo-agent/schemas';
import type { ConversationSession, CreateSessionInput, IssueClassificationResult } from './types.js';

const ERROR_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.LLM_ERROR_RETRYABLE,
  ConversationState.LLM_ERROR_TERMINAL,
  ConversationState.INTAKE_ABANDONED,
]);

/**
 * Create a new conversation session in intake_started state.
 */
export function createSession(input: CreateSessionInput): ConversationSession {
  const now = new Date().toISOString();
  return {
    conversation_id: input.conversation_id,
    tenant_user_id: input.tenant_user_id,
    tenant_account_id: input.tenant_account_id,
    state: ConversationState.INTAKE_STARTED,
    unit_id: null,
    split_issues: null,
    classification_results: null,
    authorized_unit_ids: input.authorized_unit_ids,
    pinned_versions: input.pinned_versions,
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: now,
    last_activity_at: now,
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: null,
    client_id: null,
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
  };
}

/**
 * Transition session to a new state.
 * Stores prior state when entering error/abandoned states (for RESUME/RETRY recovery).
 */
export function updateSessionState(
  session: ConversationSession,
  newState: ConversationState,
): ConversationSession {
  const priorState = ERROR_STATES.has(newState) ? session.state : session.prior_state_before_error;
  return {
    ...session,
    state: newState,
    prior_state_before_error: priorState,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Update last_activity_at without changing state (e.g., for photo uploads).
 */
export function touchActivity(session: ConversationSession): ConversationSession {
  return {
    ...session,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Set the resolved unit_id on the session.
 */
export function setSessionUnit(
  session: ConversationSession,
  unitId: string,
): ConversationSession {
  return {
    ...session,
    unit_id: unitId,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Store split issues on the session (spec §13).
 * Issues are defensively copied to prevent external mutation.
 */
export function setSplitIssues(
  session: ConversationSession,
  issues: readonly SplitIssue[] | null,
): ConversationSession {
  return {
    ...session,
    split_issues: issues ? [...issues] : null,
    last_activity_at: new Date().toISOString(),
  };
}

export interface ExpirationConfig {
  readonly abandonedExpiryMs: number;
}

/**
 * Mark a session as abandoned, storing the prior state for possible RESUME.
 */
export function markAbandoned(session: ConversationSession): ConversationSession {
  return updateSessionState(session, ConversationState.INTAKE_ABANDONED);
}

/**
 * Mark an abandoned session as expired (system event).
 */
export function markExpired(session: ConversationSession): ConversationSession {
  return {
    ...session,
    state: ConversationState.INTAKE_EXPIRED,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Check if an abandoned session has exceeded the expiry window.
 */
export function isExpired(
  session: ConversationSession,
  config: ExpirationConfig,
): boolean {
  if (session.state !== ConversationState.INTAKE_ABANDONED) return false;
  const elapsed = Date.now() - new Date(session.last_activity_at).getTime();
  return elapsed > config.abandonedExpiryMs;
}

/**
 * Store classification results on the session.
 * Results are defensively copied to prevent external mutation.
 */
export function setClassificationResults(
  session: ConversationSession,
  results: readonly IssueClassificationResult[] | null,
): ConversationSession {
  return {
    ...session,
    classification_results: results ? [...results] : null,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Update session follow-up tracking after generating questions for a turn.
 * Increments turn number, total questions asked, and per-field ask counts.
 */
export function updateFollowUpTracking(
  session: ConversationSession,
  questionsAsked: readonly FollowUpQuestion[],
): ConversationSession {
  const newTurn = session.followup_turn_number + 1;
  const newTotal = session.total_questions_asked + questionsAsked.length;

  // Update per-field ask counts
  const askCounts = new Map<string, number>();
  for (const pq of session.previous_questions) {
    askCounts.set(pq.field_target, pq.times_asked);
  }
  for (const q of questionsAsked) {
    askCounts.set(q.field_target, (askCounts.get(q.field_target) ?? 0) + 1);
  }
  const updatedPrevious: PreviousQuestion[] = Array.from(askCounts.entries()).map(
    ([field_target, times_asked]) => ({ field_target, times_asked }),
  );

  return {
    ...session,
    followup_turn_number: newTurn,
    total_questions_asked: newTotal,
    previous_questions: updatedPrevious,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Store pending follow-up questions awaiting tenant answers.
 */
export function setPendingFollowUpQuestions(
  session: ConversationSession,
  questions: readonly FollowUpQuestion[] | null,
): ConversationSession {
  return {
    ...session,
    pending_followup_questions: questions ? [...questions] : null,
    last_activity_at: new Date().toISOString(),
  };
}

export interface ConfirmationTrackingInput {
  readonly confirmationEnteredAt: string;
  readonly sourceTextHash: string;
  readonly splitHash: string;
}

/**
 * Set confirmation tracking fields when entering tenant_confirmation_pending.
 */
export function setConfirmationTracking(
  session: ConversationSession,
  input: ConfirmationTrackingInput,
): ConversationSession {
  return {
    ...session,
    confirmation_entered_at: input.confirmationEnteredAt,
    source_text_hash: input.sourceTextHash,
    split_hash: input.splitHash,
    confirmation_presented: false,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Mark that the confirmation payload has been presented to the tenant.
 */
export function markConfirmationPresented(
  session: ConversationSession,
): ConversationSession {
  return {
    ...session,
    confirmation_presented: true,
    last_activity_at: new Date().toISOString(),
  };
}

export interface ScopeInput {
  readonly property_id: string;
  readonly client_id: string;
}

/**
 * Set property and client scope on the session (derived from UnitResolver).
 */
export function setSessionScope(
  session: ConversationSession,
  scope: ScopeInput,
): ConversationSession {
  return { ...session, property_id: scope.property_id, client_id: scope.client_id };
}

export function setRiskTriggers(
  session: ConversationSession,
  triggers: readonly MatchedTrigger[],
): ConversationSession {
  return { ...session, risk_triggers: triggers };
}

export function setEscalationState(
  session: ConversationSession,
  state: EscalationState,
  planId?: string,
): ConversationSession {
  return {
    ...session,
    escalation_state: state,
    ...(planId !== undefined ? { escalation_plan_id: planId } : {}),
  };
}
