import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** ABANDON: system-generated when tenant leaves (spec §12.3). */
export async function handleAbandon(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  await ctx.deps.metricsRecorder?.record({
    metric_name: 'conversation_abandoned_total',
    metric_value: 1,
    component: 'dispatcher',
    conversation_id: ctx.session.conversation_id,
    request_id: ctx.request_id,
    timestamp: ctx.deps.clock(),
  });

  return {
    newState: ConversationState.INTAKE_ABANDONED,
    session: ctx.session,
    uiMessages: [],
    eventPayload: { prior_state: ctx.session.state },
  };
}
