import { describe, it, expect } from 'vitest';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerResult } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

const PINNED = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'default',
  prompt_version: '1.0.0',
};

function makeSession(state: ConversationState): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    state,
    unit_id: 'unit-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: PINNED,
    split_issues: [{ issue_id: 'issue-1', summary: 'Leaking toilet', raw_excerpt: 'My toilet leaks' }],
    classification_results: [{
      issue_id: 'issue-1',
      classifierOutput: {
        issue_id: 'issue-1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.95 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { Category: 0.92 },
      fieldsNeedingInput: [],
    }],
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-01-01T10:00:00.000Z',
    last_activity_at: '2026-01-01T10:30:00.000Z',
    confirmation_entered_at: '2026-01-01T10:25:00.000Z',
    source_text_hash: 'abc',
    split_hash: 'def',
    confirmation_presented: true,
    property_id: 'prop-1',
    client_id: 'client-1',
    risk_triggers: [],
    escalation_state: 'none' as const,
    escalation_plan_id: null,
  };
}

describe('buildResponse — confirmation payload', () => {
  it('includes confirmation_payload in snapshot when state is tenant_confirmation_pending', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session: makeSession(ConversationState.TENANT_CONFIRMATION_PENDING),
      uiMessages: [{ role: 'agent', content: 'Please review and confirm.' }],
    };
    const response = buildResponse(result);
    expect(response.conversation_snapshot.confirmation_payload).toBeDefined();
    expect(response.conversation_snapshot.confirmation_payload!.issues).toHaveLength(1);
  });

  it('does not include confirmation_payload for other states', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.NEEDS_TENANT_INPUT,
      session: makeSession(ConversationState.NEEDS_TENANT_INPUT),
      uiMessages: [],
    };
    const response = buildResponse(result);
    expect(response.conversation_snapshot.confirmation_payload).toBeUndefined();
  });
});
