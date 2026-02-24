import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** CONFIRM_SUBMISSION: the only gate to side effects (spec §10, non-negotiable #4). */
export async function handleConfirmSubmission(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // Actual WO creation, notifications, etc. happen here in Phase 8.
  // For now, transition to submitted and return confirmation.
  return {
    newState: ConversationState.SUBMITTED,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Your request has been submitted. We\'ll be in touch.' }],
    sideEffects: [{ effect_type: 'create_work_orders', status: 'pending' }],
    eventPayload: { confirmed: true },
  };
}
