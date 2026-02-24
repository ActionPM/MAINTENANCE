/**
 * Orchestrator action types (spec §10.3).
 * Every API endpoint maps to exactly one action type.
 */
export const ActionType = {
  CREATE_CONVERSATION: 'CREATE_CONVERSATION',
  SELECT_UNIT: 'SELECT_UNIT',
  SUBMIT_INITIAL_MESSAGE: 'SUBMIT_INITIAL_MESSAGE',
  SUBMIT_ADDITIONAL_MESSAGE: 'SUBMIT_ADDITIONAL_MESSAGE',
  CONFIRM_SPLIT: 'CONFIRM_SPLIT',
  MERGE_ISSUES: 'MERGE_ISSUES',
  EDIT_ISSUE: 'EDIT_ISSUE',
  ADD_ISSUE: 'ADD_ISSUE',
  REJECT_SPLIT: 'REJECT_SPLIT',
  ANSWER_FOLLOWUPS: 'ANSWER_FOLLOWUPS',
  CONFIRM_SUBMISSION: 'CONFIRM_SUBMISSION',
  UPLOAD_PHOTO_INIT: 'UPLOAD_PHOTO_INIT',
  UPLOAD_PHOTO_COMPLETE: 'UPLOAD_PHOTO_COMPLETE',
  RESUME: 'RESUME',
  ABANDON: 'ABANDON',
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export const ALL_ACTION_TYPES: readonly ActionType[] = Object.values(ActionType);

/**
 * Actor types for orchestrator actions (spec §10.2).
 */
export const ActorType = {
  TENANT: 'tenant',
  SYSTEM: 'system',
  AGENT: 'agent',
  PM_USER: 'pm_user',
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const ALL_ACTOR_TYPES: readonly ActorType[] = Object.values(ActorType);
