import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** Photo uploads: valid from any state, no state change (spec §11.2). */
export async function handlePhotoUpload(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Photo received.' }],
    eventPayload: { photo: ctx.request.tenant_input },
    eventType: 'photo_attached',
  };
}
