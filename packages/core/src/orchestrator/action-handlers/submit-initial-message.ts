import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSubmitInitialMessage, IssueSplitterInput } from '@wo-agent/schemas';
import { SystemEvent } from '../../state-machine/system-events.js';
import { resolveSubmitInitialMessage } from '../../state-machine/guards.js';
import { setSplitIssues, setRiskTriggers, setEscalationState } from '../../session/session.js';
import { callIssueSplitter, SplitterError } from '../../splitter/issue-splitter.js';
import { scanTextForTriggers } from '../../risk/trigger-scanner.js';
import { renderMitigationMessages } from '../../risk/mitigation.js';
import { buildRiskDetectedEvent } from '../../risk/event-builder.js';
import type { ActionHandlerContext, ActionHandlerResult, UIMessageInput, QuickReplyInput } from '../types.js';

/**
 * Handle SUBMIT_INITIAL_MESSAGE (spec §11.2, §13, §17).
 *
 * Matrix-compliant flow:
 * 1. Validate unit is resolved (guard)
 * 2. Enter split_in_progress (intermediate — recorded as event)
 * 3. Call IssueSplitter via deps (schema-validated with one retry)
 * 4. Risk scan tenant text against risk_protocols triggers
 * 5. On success: LLM_SPLIT_SUCCESS → split_proposed (final event)
 * 6. On failure: LLM_FAIL → llm_error_retryable (final event)
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

  // The intermediate step: SUBMIT_INITIAL_MESSAGE enters split_in_progress per matrix
  const intermediateStep = {
    state: ConversationState.SPLIT_IN_PROGRESS,
    eventType: 'message_received' as const,
    eventPayload: { message: input.message },
  };

  // --- Risk scanning FIRST (spec §17, non-negotiable #7) ---
  // Risk scan is deterministic and must run before the splitter so that
  // emergency mitigation messaging survives splitter failures.
  const riskScan = scanTextForTriggers(input.message, deps.riskProtocols);
  let sessionAfterRisk = session;
  const riskMessages: UIMessageInput[] = [];
  const riskQuickReplies: QuickReplyInput[] = [];

  if (riskScan.triggers_matched.length > 0) {
    sessionAfterRisk = setRiskTriggers(session, riskScan.triggers_matched);

    // Record risk_detected event
    const riskEvent = buildRiskDetectedEvent({
      eventId: deps.idGenerator(),
      conversationId: session.conversation_id,
      triggersMatched: riskScan.triggers_matched,
      hasEmergency: riskScan.has_emergency,
      highestSeverity: riskScan.highest_severity,
      createdAt: deps.clock(),
    });
    await deps.eventRepo.insert(riskEvent);

    // Render mitigation messages
    const mitigationMessages = renderMitigationMessages(
      riskScan.triggers_matched,
      deps.riskProtocols,
    );
    for (const msg of mitigationMessages) {
      riskMessages.push({ role: 'system', content: msg });
    }

    // If emergency requires confirmation, add quick replies
    const needsConfirmation = riskScan.triggers_matched.some(
      m => m.trigger.requires_confirmation && m.trigger.severity === 'emergency',
    );
    if (needsConfirmation) {
      sessionAfterRisk = setEscalationState(sessionAfterRisk, 'pending_confirmation');
      riskQuickReplies.push(
        { label: 'Yes, this is an emergency', value: 'confirm_emergency' },
        { label: 'No, not an emergency', value: 'decline_emergency' },
      );
    }
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
    const updatedSession = setSplitIssues(sessionAfterRisk, splitResult.issues);

    const issueList = splitResult.issues
      .map((issue, i) => `${i + 1}. ${issue.summary}`)
      .join('\n');

    return {
      newState: ConversationState.SPLIT_PROPOSED,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_SPLIT_SUCCESS,
      uiMessages: [
        ...riskMessages,
        {
          role: 'agent',
          content: splitResult.issue_count === 1
            ? `I identified 1 issue:\n\n1. ${splitResult.issues[0].summary}\n\nPlease confirm or edit this issue.`
            : `I identified ${splitResult.issue_count} issues:\n\n${issueList}\n\nPlease confirm, edit, or merge these issues.`,
        },
      ],
      quickReplies: [
        ...riskQuickReplies,
        { label: 'Confirm', value: 'confirm', action_type: 'CONFIRM_SPLIT' },
        { label: 'Reject (single issue)', value: 'reject', action_type: 'REJECT_SPLIT' },
      ],
      eventPayload: {
        split_result: splitResult,
        ...(riskScan.triggers_matched.length > 0 ? {
          risk_detected: true,
          risk_trigger_ids: riskScan.triggers_matched.map(t => t.trigger.trigger_id),
        } : {}),
      },
      eventType: 'state_transition',
    };
  } catch (err) {
    const errorMessage = err instanceof SplitterError ? err.message : 'Unexpected error analyzing your request';
    return {
      newState: ConversationState.LLM_ERROR_RETRYABLE,
      session: sessionAfterRisk,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_FAIL,
      uiMessages: [
        ...riskMessages,
        { role: 'agent', content: 'I had trouble analyzing your request. Please try again.' },
      ],
      errors: [{ code: 'SPLITTER_FAILED', message: errorMessage }],
      transitionContext: { prior_state: ConversationState.SPLIT_IN_PROGRESS },
      eventPayload: {
        error: errorMessage,
        ...(riskScan.triggers_matched.length > 0 ? {
          risk_detected: true,
          risk_trigger_ids: riskScan.triggers_matched.map(t => t.trigger.trigger_id),
        } : {}),
      },
      eventType: 'error_occurred',
    };
  }
}
