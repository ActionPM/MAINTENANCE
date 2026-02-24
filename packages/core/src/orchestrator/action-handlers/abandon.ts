import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** ABANDON: system-generated when tenant leaves (spec §12.3). */
export async function handleAbandon(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  return {
    newState: ConversationState.INTAKE_ABANDONED,
    session: ctx.session,
    uiMessages: [],
    eventPayload: { prior_state: ctx.session.state },
  };
}
