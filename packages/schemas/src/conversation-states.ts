export const ConversationState = {
  // Core states
  INTAKE_STARTED: 'intake_started',
  UNIT_SELECTION_REQUIRED: 'unit_selection_required',
  UNIT_SELECTED: 'unit_selected',
  SPLIT_IN_PROGRESS: 'split_in_progress',
  SPLIT_PROPOSED: 'split_proposed',
  SPLIT_FINALIZED: 'split_finalized',
  CLASSIFICATION_IN_PROGRESS: 'classification_in_progress',
  NEEDS_TENANT_INPUT: 'needs_tenant_input',
  TENANT_CONFIRMATION_PENDING: 'tenant_confirmation_pending',
  SUBMITTED: 'submitted',
  // Failure / recovery states
  LLM_ERROR_RETRYABLE: 'llm_error_retryable',
  LLM_ERROR_TERMINAL: 'llm_error_terminal',
  INTAKE_ABANDONED: 'intake_abandoned',
  INTAKE_EXPIRED: 'intake_expired',
} as const;

export type ConversationState = (typeof ConversationState)[keyof typeof ConversationState];

export const ALL_CONVERSATION_STATES: readonly ConversationState[] = Object.values(ConversationState);

/**
 * States from which a conversation can be resumed (spec §12.1).
 * GET /conversations/drafts returns conversations in these states.
 */
export const RESUMABLE_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.UNIT_SELECTION_REQUIRED,
  ConversationState.SPLIT_PROPOSED,
  ConversationState.CLASSIFICATION_IN_PROGRESS,
  ConversationState.NEEDS_TENANT_INPUT,
  ConversationState.TENANT_CONFIRMATION_PENDING,
  ConversationState.LLM_ERROR_RETRYABLE,
  ConversationState.INTAKE_ABANDONED,
]);
