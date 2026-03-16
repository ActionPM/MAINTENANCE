import { ConversationState } from '@wo-agent/schemas';
import type { DisambiguatorInput } from '@wo-agent/schemas';
import { queueMessage } from '../../session/session.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

const NEW_ISSUE_DETECTION_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.NEEDS_TENANT_INPUT,
  ConversationState.TENANT_CONFIRMATION_PENDING,
]);

/**
 * Heuristic fallback: used when the LLM disambiguator is not available
 * (no ANTHROPIC_API_KEY) or when the disambiguator returns a fail-safe result.
 *
 * In tenant_confirmation_pending there are no pending_followup_questions, so
 * we rely on a length-only heuristic (>100 chars). Short new issues like
 * "kitchen sink leaking too" (25 chars) will NOT be detected — reliable
 * short-message disambiguation requires the LLM disambiguator.
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

/**
 * Determine whether the message is a new issue using the LLM disambiguator
 * if available, with heuristic fallback.
 *
 * If the disambiguator returns isFailSafe=true (LLM failed), we fall back
 * to the heuristic so that currently-detected long new issues are never
 * suppressed by a failing LLM.
 */
async function isNewIssue(message: string, ctx: ActionHandlerContext): Promise<boolean> {
  if (!NEW_ISSUE_DETECTION_STATES.has(ctx.session.state)) return false;

  // If no disambiguator wired, fall back to heuristic
  if (!ctx.deps.messageDisambiguator) {
    return isLikelyNewIssue(message, ctx);
  }

  const versions = ctx.session.pinned_versions;
  const input: DisambiguatorInput = {
    message,
    current_issues: ctx.session.split_issues ?? [],
    pending_questions: ctx.session.pending_followup_questions ?? null,
    conversation_state: ctx.session.state,
    model_id: versions.model_id,
    prompt_version: versions.prompt_version,
    conversation_id: ctx.session.conversation_id,
  };

  const result = await ctx.deps.messageDisambiguator(input);

  // If the LLM failed (isFailSafe), fall back to heuristic —
  // never suppress currently-detected issues due to LLM failure.
  if (result.isFailSafe) {
    return isLikelyNewIssue(message, ctx);
  }

  return result.classification === 'new_issue';
}

function makeQueuedResult(ctx: ActionHandlerContext, message: string): ActionHandlerResult {
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

/** SUBMIT_ADDITIONAL_MESSAGE: stays in current state, queues message (spec §12.2). */
export async function handleSubmitAdditionalMessage(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const message = (ctx.request.tenant_input as { message?: string }).message ?? '';

  // S12-03: Detect new issue during follow-ups or confirmation
  if (await isNewIssue(message, ctx)) {
    return makeQueuedResult(ctx, message);
  }

  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: "Message received. We'll address it shortly." }],
    eventPayload: { message },
    eventType: 'message_received',
  };
}
