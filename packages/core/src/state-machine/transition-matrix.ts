import { ConversationState, ActionType } from '@wo-agent/schemas';
import { SystemEvent } from './system-events.js';

export type TransitionTrigger = ActionType | SystemEvent;

/**
 * Photo actions are valid from EVERY state and never change the state.
 * Handled as a special case outside the matrix (spec §11.2).
 */
export const PHOTO_ACTIONS: ReadonlySet<ActionType> = new Set([
  ActionType.UPLOAD_PHOTO_INIT,
  ActionType.UPLOAD_PHOTO_COMPLETE,
]);

export function isPhotoAction(trigger: TransitionTrigger): trigger is ActionType {
  return PHOTO_ACTIONS.has(trigger as ActionType);
}

/**
 * States a conversation can resume to from intake_abandoned (spec §11.2).
 * The actual target is resolved by a guard using the stored prior_state.
 */
const ABANDON_RESUME_TARGETS: readonly ConversationState[] = [
  ConversationState.INTAKE_STARTED,
  ConversationState.UNIT_SELECTION_REQUIRED,
  ConversationState.UNIT_SELECTED,
  ConversationState.SPLIT_PROPOSED,
  ConversationState.SPLIT_FINALIZED,
  ConversationState.NEEDS_TENANT_INPUT,
  ConversationState.TENANT_CONFIRMATION_PENDING,
];

/**
 * Authoritative transition matrix (spec §11.2).
 *
 * Maps (state, trigger) → possible next states.
 * Photo actions are excluded — they are valid everywhere and never change state.
 * Multi-target entries require a guard to resolve the actual next state.
 */
export const TRANSITION_MATRIX: Record<
  ConversationState,
  Partial<Record<TransitionTrigger, readonly ConversationState[]>>
> = {
  [ConversationState.INTAKE_STARTED]: {
    [ActionType.SELECT_UNIT]: [ConversationState.UNIT_SELECTED, ConversationState.UNIT_SELECTION_REQUIRED],
    [ActionType.SUBMIT_INITIAL_MESSAGE]: [ConversationState.SPLIT_IN_PROGRESS],
    [ActionType.RESUME]: [ConversationState.INTAKE_STARTED],
  },

  [ConversationState.UNIT_SELECTION_REQUIRED]: {
    [ActionType.SELECT_UNIT]: [ConversationState.UNIT_SELECTED],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.UNIT_SELECTED]: {
    [ActionType.SUBMIT_INITIAL_MESSAGE]: [ConversationState.SPLIT_IN_PROGRESS],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SPLIT_IN_PROGRESS]: {
    [SystemEvent.LLM_SPLIT_SUCCESS]: [ConversationState.SPLIT_PROPOSED],
    [SystemEvent.LLM_FAIL]: [ConversationState.LLM_ERROR_RETRYABLE, ConversationState.LLM_ERROR_TERMINAL],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SPLIT_PROPOSED]: {
    [ActionType.CONFIRM_SPLIT]: [ConversationState.SPLIT_FINALIZED],
    [ActionType.MERGE_ISSUES]: [ConversationState.SPLIT_PROPOSED],
    [ActionType.EDIT_ISSUE]: [ConversationState.SPLIT_PROPOSED],
    [ActionType.ADD_ISSUE]: [ConversationState.SPLIT_PROPOSED],
    [ActionType.REJECT_SPLIT]: [ConversationState.SPLIT_FINALIZED],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SPLIT_FINALIZED]: {
    [SystemEvent.START_CLASSIFICATION]: [ConversationState.CLASSIFICATION_IN_PROGRESS],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.CLASSIFICATION_IN_PROGRESS]: {
    [SystemEvent.LLM_CLASSIFY_SUCCESS]: [ConversationState.NEEDS_TENANT_INPUT, ConversationState.TENANT_CONFIRMATION_PENDING],
    [SystemEvent.LLM_FAIL]: [ConversationState.LLM_ERROR_RETRYABLE, ConversationState.LLM_ERROR_TERMINAL],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.NEEDS_TENANT_INPUT]: {
    [ActionType.ANSWER_FOLLOWUPS]: [ConversationState.CLASSIFICATION_IN_PROGRESS],
    [ActionType.SUBMIT_ADDITIONAL_MESSAGE]: [ConversationState.NEEDS_TENANT_INPUT],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.TENANT_CONFIRMATION_PENDING]: {
    [ActionType.CONFIRM_SUBMISSION]: [ConversationState.SUBMITTED],
    [ActionType.SUBMIT_ADDITIONAL_MESSAGE]: [ConversationState.TENANT_CONFIRMATION_PENDING],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SUBMITTED]: {
    [ActionType.SUBMIT_INITIAL_MESSAGE]: [ConversationState.SUBMITTED],
    [ActionType.RESUME]: [ConversationState.SUBMITTED],
  },

  [ConversationState.LLM_ERROR_RETRYABLE]: {
    [SystemEvent.RETRY_LLM]: [ConversationState.SPLIT_IN_PROGRESS, ConversationState.CLASSIFICATION_IN_PROGRESS],
    [ActionType.RESUME]: [ConversationState.LLM_ERROR_RETRYABLE],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.LLM_ERROR_TERMINAL]: {
    [ActionType.RESUME]: [ConversationState.LLM_ERROR_TERMINAL],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.INTAKE_ABANDONED]: {
    [ActionType.RESUME]: ABANDON_RESUME_TARGETS,
    [SystemEvent.EXPIRE]: [ConversationState.INTAKE_EXPIRED],
  },

  [ConversationState.INTAKE_EXPIRED]: {
    [ActionType.CREATE_CONVERSATION]: [ConversationState.INTAKE_STARTED],
  },
};
