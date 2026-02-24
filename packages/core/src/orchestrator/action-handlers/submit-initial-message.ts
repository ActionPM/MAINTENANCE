import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSubmitInitialMessage } from '@wo-agent/schemas';
import { resolveSubmitInitialMessage } from '../../state-machine/guards.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleSubmitInitialMessage(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session } = ctx;
  const input = ctx.request.tenant_input as TenantInputSubmitInitialMessage;

  const targetState = resolveSubmitInitialMessage({ unit_resolved: session.unit_id !== null });

  if (targetState === null) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'Please select a unit before submitting your request.' }],
      errors: [{ code: 'UNIT_NOT_RESOLVED', message: 'A unit must be selected before submitting a message' }],
    };
  }

  // The actual IssueSplitter LLM call is stubbed — Phase 4 implements it.
  // For now, transition to split_in_progress and return a "processing" message.
  return {
    newState: ConversationState.SPLIT_IN_PROGRESS,
    session,
    uiMessages: [{ role: 'agent', content: 'Thank you. Analyzing your request...' }],
    eventPayload: { message: input.message },
    eventType: 'message_received',
  };
}
