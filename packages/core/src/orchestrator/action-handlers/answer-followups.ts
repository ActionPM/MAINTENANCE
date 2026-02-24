import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** ANSWER_FOLLOWUPS: loops back to classification_in_progress (spec §11.2). */
export async function handleAnswerFollowups(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  return {
    newState: ConversationState.CLASSIFICATION_IN_PROGRESS,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Thank you. Re-classifying with your answers...' }],
    eventPayload: { answers: (ctx.request.tenant_input as any).answers },
  };
}
