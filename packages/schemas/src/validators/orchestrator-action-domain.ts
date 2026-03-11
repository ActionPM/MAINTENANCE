import type { OrchestratorActionRequest } from '../types/orchestrator-action.js';

/**
 * Actions that produce durable side effects requiring idempotency keys.
 * Per spec §10.2 ("required for side-effect actions") and §18 ("idempotency keys for WO creation and notifications").
 *
 * CREATE_CONVERSATION — creates conversation record + event
 * CONFIRM_SUBMISSION — creates work orders, sends notifications
 * UPLOAD_PHOTO_COMPLETE — finalizes storage record
 *
 * If future actions gain non-idempotent side effects, add them here.
 */
export const SIDE_EFFECT_ACTIONS: ReadonlySet<string> = new Set([
  'CREATE_CONVERSATION',
  'CONFIRM_SUBMISSION',
  'UPLOAD_PHOTO_COMPLETE',
]);

export interface ActionDomainValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateOrchestratorActionDomain(
  request: OrchestratorActionRequest,
): ActionDomainValidationResult {
  const errors: string[] = [];

  // idempotency_key required for side-effect actions
  if (SIDE_EFFECT_ACTIONS.has(request.action_type) && !request.idempotency_key) {
    errors.push(`idempotency_key is required for side-effect action "${request.action_type}"`);
  }

  // conversation_id required for all actions except CREATE_CONVERSATION
  if (request.action_type !== 'CREATE_CONVERSATION' && !request.conversation_id) {
    errors.push(`conversation_id is required for action "${request.action_type}"`);
  }

  return { valid: errors.length === 0, errors };
}
