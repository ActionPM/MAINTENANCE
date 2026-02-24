export { SystemEvent, ALL_SYSTEM_EVENTS } from './system-events.js';
export type { SystemEvent as SystemEventType } from './system-events.js';

export {
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  type TransitionTrigger,
} from './transition-matrix.js';

export { isValidTransition, getPossibleTargets } from './transition.js';

export {
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
  type TransitionContext,
} from './guards.js';
