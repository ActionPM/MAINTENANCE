import { DEFAULT_RATE_LIMITS } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

const MAX_PHOTO_SIZE_BYTES = DEFAULT_RATE_LIMITS.max_photo_size_mb * 1024 * 1024;

/** Photo uploads: valid from any state, no state change (spec §11.2). */
export async function handlePhotoUpload(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // S08-03: enforce per-conversation photo upload limit
  if (
    ctx.session.draft_photo_ids.length >= DEFAULT_RATE_LIMITS.max_photo_uploads_per_conversation
  ) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [
        {
          role: 'system',
          content: `Maximum of ${DEFAULT_RATE_LIMITS.max_photo_uploads_per_conversation} photos per conversation reached.`,
        },
      ],
      errors: [
        {
          code: 'PHOTO_LIMIT_EXCEEDED',
          message: `Maximum ${DEFAULT_RATE_LIMITS.max_photo_uploads_per_conversation} photos per conversation`,
        },
      ],
    };
  }

  // S08-04: enforce declared photo size limit
  const input = ctx.request.tenant_input as { size_bytes?: number };
  if (input.size_bytes != null && input.size_bytes > MAX_PHOTO_SIZE_BYTES) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [
        {
          role: 'system',
          content: `Photo exceeds maximum size of ${DEFAULT_RATE_LIMITS.max_photo_size_mb} MB.`,
        },
      ],
      errors: [
        {
          code: 'PHOTO_SIZE_EXCEEDED',
          message: `Photo size ${input.size_bytes} bytes exceeds maximum ${MAX_PHOTO_SIZE_BYTES} bytes`,
        },
      ],
    };
  }

  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Photo received.' }],
    eventPayload: { photo: ctx.request.tenant_input },
    eventType: 'photo_attached',
  };
}
