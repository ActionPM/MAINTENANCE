import { ConversationState } from '@wo-agent/schemas';
import type {
  OrchestratorActionResponse,
  ConversationSnapshot,
  UIDirective,
} from '@wo-agent/schemas';
import type { ActionHandlerResult } from './types.js';
import { buildConfirmationPayload } from '../confirmation/payload-builder.js';

/**
 * Build an OrchestratorActionResponse from an action handler result.
 */
export function buildResponse(result: ActionHandlerResult): OrchestratorActionResponse {
  const confirmationPayload =
    result.newState === ConversationState.TENANT_CONFIRMATION_PENDING &&
    result.session.split_issues &&
    result.session.classification_results
      ? buildConfirmationPayload(result.session.split_issues, result.session.classification_results)
      : undefined;

  const workOrderIds =
    result.newState === ConversationState.SUBMITTED && result.eventPayload?.work_order_ids
      ? (result.eventPayload.work_order_ids as readonly string[])
      : undefined;

  const riskSummary =
    result.session.risk_triggers && result.session.risk_triggers.length > 0
      ? {
          has_emergency: result.session.risk_triggers.some(
            (t) => t.trigger.severity === 'emergency',
          ),
          highest_severity: result.session.risk_triggers.reduce((worst: string, t) => {
            const rank: Record<string, number> = { emergency: 3, high: 2, medium: 1 };
            return (rank[t.trigger.severity] ?? 0) > (rank[worst] ?? 0)
              ? t.trigger.severity
              : worst;
          }, ''),
          trigger_ids: result.session.risk_triggers.map((t) => t.trigger.trigger_id),
          escalation_state: result.session.escalation_state,
        }
      : undefined;

  const snapshot: ConversationSnapshot = {
    conversation_id: result.session.conversation_id,
    state: result.session.state,
    unit_id: result.session.unit_id,
    ...(result.session.split_issues ? { issues: result.session.split_issues as any } : {}),
    ...(result.session.classification_results
      ? { classification_results: result.session.classification_results as any }
      : {}),
    ...(result.session.pending_followup_questions
      ? { pending_followup_questions: result.session.pending_followup_questions as any }
      : {}),
    ...(confirmationPayload ? { confirmation_payload: confirmationPayload } : {}),
    ...(workOrderIds ? { work_order_ids: workOrderIds } : {}),
    ...(riskSummary ? { risk_summary: riskSummary } : {}),
    pinned_versions: result.session.pinned_versions,
    created_at: result.session.created_at,
    last_activity_at: result.session.last_activity_at,
  };

  // Rehydrate emergency confirmation quick replies from session state (plan §5.7a).
  // When escalation_state === 'pending_confirmation', always include confirm/decline
  // quick replies regardless of which handler produced the response.
  let quickReplies = result.quickReplies?.map((qr) => ({
    label: qr.label,
    value: qr.value,
    action_type: qr.action_type as any,
  }));

  if (
    result.session.escalation_state === 'pending_confirmation' &&
    !quickReplies?.some((qr) => qr.action_type === 'CONFIRM_EMERGENCY')
  ) {
    const emergencyReplies = [
      {
        label: 'Yes, this is an emergency',
        value: 'confirm_emergency',
        action_type: 'CONFIRM_EMERGENCY' as any,
      },
      {
        label: 'No, not an emergency',
        value: 'decline_emergency',
        action_type: 'DECLINE_EMERGENCY' as any,
      },
    ];
    quickReplies = [...emergencyReplies, ...(quickReplies ?? [])];
  }

  const directive: UIDirective = {
    messages: result.uiMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: result.session.last_activity_at,
    })),
    quick_replies: quickReplies,
  };

  return {
    conversation_snapshot: snapshot,
    ui_directive: directive,
    artifacts: [],
    pending_side_effects: result.sideEffects ?? [],
    errors: result.errors ?? [],
  };
}
