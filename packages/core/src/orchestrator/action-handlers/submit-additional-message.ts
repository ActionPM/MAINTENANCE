import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** SUBMIT_ADDITIONAL_MESSAGE: stays in current state, queues message (spec §12.2). */
export async function handleSubmitAdditionalMessage(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Message received. We\'ll address it shortly.' }],
    eventPayload: { message: (ctx.request.tenant_input as any).message },
    eventType: 'message_received',
  };
}
