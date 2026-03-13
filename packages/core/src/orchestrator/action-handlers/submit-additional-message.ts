import { ConversationState } from '@wo-agent/schemas';
import { queueMessage } from '../../session/session.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

const NEW_ISSUE_DETECTION_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.NEEDS_TENANT_INPUT,
  ConversationState.TENANT_CONFIRMATION_PENDING,
]);

/**
 * Heuristic: if the session is in needs_tenant_input or tenant_confirmation_pending
 * and the message doesn't reference any pending follow-up question fields,
 * treat it as a potential new issue (spec §12.2).
 *
 * In tenant_confirmation_pending there are no pending_followup_questions, so
 * we rely on a length-only heuristic (>100 chars). Short new issues like
 * "kitchen sink leaking too" (25 chars) will NOT be detected — reliable
 * short-message disambiguation would require an LLM call.
 */
function isLikelyNewIssue(message: string, ctx: ActionHandlerContext): boolean {
  if (!NEW_ISSUE_DETECTION_STATES.has(ctx.session.state)) return false;

  // In confirmation state: no pending questions to compare against.
  // Use length-only heuristic.
  if (ctx.session.state === ConversationState.TENANT_CONFIRMATION_PENDING) {
    return message.length > 100;
  }

  // In needs_tenant_input: compare against pending follow-up question fields.
  if (!ctx.session.pending_followup_questions?.length) return false;

  const lower = message.toLowerCase();
  // If the message references any pending question's field target, it's a clarification.
  for (const q of ctx.session.pending_followup_questions) {
    const field = q.field_target.toLowerCase().replace(/_/g, ' ');
    if (lower.includes(field)) return false;
  }

  // Heuristic: longer messages (> 100 chars) that don't reference pending fields
  // are more likely new issues.
  return message.length > 100;
}

/** SUBMIT_ADDITIONAL_MESSAGE: stays in current state, queues message (spec §12.2). */
export async function handleSubmitAdditionalMessage(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const message = (ctx.request.tenant_input as { message?: string }).message ?? '';

  // S12-03: Detect new issue during follow-ups
  if (isLikelyNewIssue(message, ctx)) {
    const updatedSession = queueMessage(ctx.session, message);
    return {
      newState: ctx.session.state,
      session: updatedSession,
      uiMessages: [
        {
          role: 'agent',
          content:
            "It looks like you may have a new issue. I've noted it — let's finish the current one first, and then we'll address it.",
        },
      ],
      eventPayload: { message, queued_as_new_issue: true },
      eventType: 'message_received',
    };
  }

  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: "Message received. We'll address it shortly." }],
    eventPayload: { message },
    eventType: 'message_received',
  };
}
