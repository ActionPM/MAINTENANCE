import type { OrchestratorActionResponse, ConversationSnapshot, UIDirective } from '@wo-agent/schemas';
import type { ActionHandlerResult } from './types.js';

/**
 * Build an OrchestratorActionResponse from an action handler result.
 */
export function buildResponse(result: ActionHandlerResult): OrchestratorActionResponse {
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
    pinned_versions: result.session.pinned_versions,
    created_at: result.session.created_at,
    last_activity_at: result.session.last_activity_at,
  };

  const directive: UIDirective = {
    messages: result.uiMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: result.session.last_activity_at,
    })),
    quick_replies: result.quickReplies?.map((qr) => ({
      label: qr.label,
      value: qr.value,
      action_type: qr.action_type as any,
    })),
  };

  return {
    conversation_snapshot: snapshot,
    ui_directive: directive,
    artifacts: [],
    pending_side_effects: result.sideEffects ?? [],
    errors: result.errors ?? [],
  };
}
