import { ConversationState, ActionType } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handler for split-related actions (spec §13):
 * CONFIRM_SPLIT, MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE, REJECT_SPLIT
 *
 * CONFIRM_SPLIT/REJECT_SPLIT → split_finalized
 * MERGE/EDIT/ADD → split_proposed (same state, updated data)
 */
export async function handleSplitAction(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, request } = ctx;
  const actionType = request.action_type;

  if (actionType === ActionType.CONFIRM_SPLIT) {
    return {
      newState: ConversationState.SPLIT_FINALIZED,
      session,
      uiMessages: [{ role: 'agent', content: 'Split confirmed. Classifying your issues...' }],
      eventPayload: { split_action: 'confirm' },
    };
  }

  if (actionType === ActionType.REJECT_SPLIT) {
    return {
      newState: ConversationState.SPLIT_FINALIZED,
      session,
      uiMessages: [{ role: 'agent', content: 'Treating as a single issue. Classifying...' }],
      eventPayload: { split_action: 'reject' },
    };
  }

  // MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE — stay in split_proposed
  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session,
    uiMessages: [{ role: 'agent', content: 'Updated. Review the issues and confirm when ready.' }],
    eventPayload: { split_action: actionType, tenant_input: request.tenant_input },
  };
}
