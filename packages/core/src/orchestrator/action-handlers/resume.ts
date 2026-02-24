import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** RESUME: returns to current or prior state (spec §11.2, §12). */
export async function handleResume(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // For abandoned sessions, the dispatcher + guard resolves the target.
  // For non-abandoned, RESUME is a no-op that returns current state.
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Welcome back. Resuming where you left off.' }],
    eventPayload: { resumed_from: ctx.session.state },
  };
}
