import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSubmitInitialMessage, IssueSplitterInput } from '@wo-agent/schemas';
import { resolveSubmitInitialMessage } from '../../state-machine/guards.js';
import { setSplitIssues } from '../../session/session.js';
import { callIssueSplitter, SplitterError } from '../../splitter/issue-splitter.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handle SUBMIT_INITIAL_MESSAGE (spec §11.2, §13).
 *
 * Flow:
 * 1. Validate unit is resolved
 * 2. Call IssueSplitter via deps (schema-validated with one retry)
 * 3. On success: store issues on session, return SPLIT_PROPOSED
 * 4. On failure: return LLM_ERROR_RETRYABLE with error details
 */
export async function handleSubmitInitialMessage(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;
  const input = ctx.request.tenant_input as TenantInputSubmitInitialMessage;

  const targetState = resolveSubmitInitialMessage({ unit_resolved: session.unit_id !== null });
  if (targetState === null) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'Please select a unit before submitting your request.' }],
      errors: [{ code: 'UNIT_NOT_RESOLVED', message: 'A unit must be selected before submitting a message' }],
    };
  }

  // Build splitter input from session's pinned versions
  const splitterInput: IssueSplitterInput = {
    raw_text: input.message,
    conversation_id: session.conversation_id,
    taxonomy_version: session.pinned_versions.taxonomy_version,
    model_id: session.pinned_versions.model_id,
    prompt_version: session.pinned_versions.prompt_version,
  };

  try {
    const splitResult = await callIssueSplitter(splitterInput, deps.issueSplitter);
    const updatedSession = setSplitIssues(session, splitResult.issues);

    const issueList = splitResult.issues
      .map((issue, i) => `${i + 1}. ${issue.summary}`)
      .join('\n');

    return {
      newState: ConversationState.SPLIT_PROPOSED,
      session: updatedSession,
      uiMessages: [
        {
          role: 'agent',
          content: splitResult.issue_count === 1
            ? `I identified 1 issue:\n\n1. ${splitResult.issues[0].summary}\n\nPlease confirm or edit this issue.`
            : `I identified ${splitResult.issue_count} issues:\n\n${issueList}\n\nPlease confirm, edit, or merge these issues.`,
        },
      ],
      quickReplies: [
        { label: 'Confirm', value: 'confirm', action_type: 'CONFIRM_SPLIT' },
        { label: 'Reject (single issue)', value: 'reject', action_type: 'REJECT_SPLIT' },
      ],
      eventPayload: { message: input.message, split_result: splitResult },
      eventType: 'message_received',
    };
  } catch (err) {
    const errorMessage = err instanceof SplitterError ? err.message : 'Unexpected error analyzing your request';
    return {
      newState: ConversationState.LLM_ERROR_RETRYABLE,
      session,
      uiMessages: [{ role: 'agent', content: 'I had trouble analyzing your request. Please try again.' }],
      errors: [{ code: 'SPLITTER_FAILED', message: errorMessage }],
      transitionContext: { prior_state: session.state },
      eventPayload: { message: input.message, error: errorMessage },
      eventType: 'error_occurred',
    };
  }
}
