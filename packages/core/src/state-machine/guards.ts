import { ConversationState } from '@wo-agent/schemas';

/**
 * Context provided to guards to resolve multi-target transitions.
 * The orchestrator populates this from session state and action payload.
 */
export interface TransitionContext {
  authorized_unit_ids?: readonly string[];
  selected_unit_id?: string | null;
  unit_resolved?: boolean;
  retry_count?: number;
  fields_needing_input?: readonly string[];
  prior_state?: ConversationState | null;
}

const VALID_RETRY_PRIOR_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.SPLIT_IN_PROGRESS,
  ConversationState.CLASSIFICATION_IN_PROGRESS,
]);

const TERMINAL_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.SUBMITTED,
  ConversationState.INTAKE_EXPIRED,
  ConversationState.LLM_ERROR_TERMINAL,
]);

/**
 * Resolve SELECT_UNIT target state.
 * - Single authorized unit → auto-select → unit_selected
 * - Multiple units + valid selection → unit_selected
 * - Multiple units + no selection → unit_selection_required
 * - Invalid unit_id → null (rejected)
 */
export function resolveSelectUnit(
  _currentState: ConversationState,
  ctx: TransitionContext,
): ConversationState | null {
  const units = ctx.authorized_unit_ids ?? [];
  const selected = ctx.selected_unit_id ?? null;

  // If a unit was explicitly selected, validate it against the authorized list
  if (selected !== null) {
    return units.includes(selected) ? ConversationState.UNIT_SELECTED : null;
  }

  // No selection provided — auto-select if single unit, otherwise require selection
  return units.length === 1
    ? ConversationState.UNIT_SELECTED
    : ConversationState.UNIT_SELECTION_REQUIRED;
}

/**
 * Guard for SUBMIT_INITIAL_MESSAGE — requires unit resolved (spec §11.2).
 */
export function resolveSubmitInitialMessage(
  ctx: Pick<TransitionContext, 'unit_resolved'>,
): ConversationState | null {
  return ctx.unit_resolved ? ConversationState.SPLIT_IN_PROGRESS : null;
}

/**
 * Resolve LLM_FAIL target — retryable on first failure, terminal after.
 */
export function resolveLlmFailure(ctx: Pick<TransitionContext, 'retry_count'>): ConversationState {
  return (ctx.retry_count ?? 0) < 1
    ? ConversationState.LLM_ERROR_RETRYABLE
    : ConversationState.LLM_ERROR_TERMINAL;
}

/**
 * Resolve LLM_CLASSIFY_SUCCESS — needs input or ready for confirmation.
 */
export function resolveLlmClassifySuccess(
  ctx: Pick<TransitionContext, 'fields_needing_input'>,
): ConversationState {
  const fields = ctx.fields_needing_input ?? [];
  return fields.length > 0
    ? ConversationState.NEEDS_TENANT_INPUT
    : ConversationState.TENANT_CONFIRMATION_PENDING;
}

/**
 * Resolve RETRY_LLM — return to the LLM in-progress state that failed.
 */
export function resolveRetryLlm(
  ctx: Pick<TransitionContext, 'prior_state'>,
): ConversationState | null {
  const prior = ctx.prior_state ?? null;
  if (prior === null || !VALID_RETRY_PRIOR_STATES.has(prior)) {
    return null;
  }
  return prior;
}

/**
 * Resolve RESUME from intake_abandoned — return to stored prior state.
 */
export function resolveAbandonResume(
  ctx: Pick<TransitionContext, 'prior_state'>,
): ConversationState | null {
  const prior = ctx.prior_state ?? null;
  if (prior === null || TERMINAL_STATES.has(prior)) {
    return null;
  }
  return prior;
}
