import { assertPinnedVersionsIntact } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** RESUME: returns to current or prior state (spec §11.2, §12). */
export async function handleResume(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // Defense-in-depth: assert that the restored session's pinned versions
  // have not been corrupted or silently overwritten between save and restore.
  // If they're invalid, the session is compromised — fail safe (spec §5.2).
  if (!assertPinnedVersionsIntact(ctx.session.pinned_versions)) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [
        {
          role: 'system',
          content: 'Session version integrity check failed. Please start a new conversation.',
        },
      ],
      errors: [
        {
          code: 'VERSION_INTEGRITY_FAILURE',
          message: 'Resumed session has missing or corrupted pinned versions',
        },
      ],
      eventPayload: {
        resumed_from: ctx.session.state,
        version_integrity: 'failed',
      },
    };
  }

  // For abandoned sessions, the dispatcher + guard resolves the target.
  // For non-abandoned, RESUME is a no-op that returns current state.
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Welcome back. Resuming where you left off.' }],
    eventPayload: {
      resumed_from: ctx.session.state,
      version_integrity: 'passed',
      pinned_versions: ctx.session.pinned_versions,
    },
  };
}
