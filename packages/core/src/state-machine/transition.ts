import type { ConversationState } from '@wo-agent/schemas';
import { TRANSITION_MATRIX, isPhotoAction, type TransitionTrigger } from './transition-matrix.js';

/**
 * Check if a transition is valid from the given state.
 * Photo actions (UPLOAD_PHOTO_INIT/COMPLETE) are always valid.
 */
export function isValidTransition(
  currentState: ConversationState,
  trigger: TransitionTrigger,
): boolean {
  if (isPhotoAction(trigger)) return true;

  const stateTransitions = TRANSITION_MATRIX[currentState];
  return trigger in (stateTransitions ?? {});
}

/**
 * Get the possible target states for a transition.
 * Returns empty array if the transition is invalid.
 * Photo actions return [currentState] (no state change).
 */
export function getPossibleTargets(
  currentState: ConversationState,
  trigger: TransitionTrigger,
): readonly ConversationState[] {
  if (isPhotoAction(trigger)) return [currentState];

  const stateTransitions = TRANSITION_MATRIX[currentState];
  return stateTransitions?.[trigger] ?? [];
}
