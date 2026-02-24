import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleCreateConversation(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request } = ctx;
  const unitCount = request.auth_context.authorized_unit_ids.length;

  const messages = unitCount > 1
    ? [{ role: 'agent' as const, content: 'Welcome! Please select which unit this request is for.' }]
    : [{ role: 'agent' as const, content: 'Welcome! How can we help you today?' }];

  const quickReplies = unitCount > 1
    ? request.auth_context.authorized_unit_ids.map((id) => ({
        label: `Unit ${id}`,
        value: id,
        action_type: 'SELECT_UNIT',
      }))
    : undefined;

  return {
    newState: ConversationState.INTAKE_STARTED,
    session,
    uiMessages: messages,
    quickReplies,
    eventPayload: { authorized_unit_ids: request.auth_context.authorized_unit_ids },
  };
}
