import { ConversationState } from '@wo-agent/schemas';
import type { SplitIssue } from '@wo-agent/schemas';
import type { ConversationSession, CreateSessionInput } from './types.js';

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
    authorized_unit_ids: input.authorized_unit_ids,
    pinned_versions: input.pinned_versions,
    prior_state_before_error: null,
    draft_photo_ids: [],
    created_at: now,
    last_activity_at: now,
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
