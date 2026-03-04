import { describe, it, expect } from 'vitest';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import { ConversationState } from '@wo-agent/schemas';
import type { ConversationSession } from '../../session/types.js';

describe('createWorkOrders — conversation_id', () => {
  it('sets conversation_id from session', () => {
    const session = makeSession();
    const workOrders = createWorkOrders({
      session,
      idGenerator: makeIdGenerator(),
      clock: () => '2026-03-04T00:00:00.000Z',
    });

    expect(workOrders).toHaveLength(1);
    expect(workOrders[0].conversation_id).toBe('conv-1');
  });
});

function makeIdGenerator() {
  let counter = 0;
  return () => `id-${++counter}`;
}

function makeSession(): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tenant-1',
    tenant_account_id: 'account-1',
    state: ConversationState.TENANT_CONFIRMATION_PENDING,
    unit_id: 'unit-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    split_issues: [{ issue_id: 'issue-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet leaks' }],
    classification_results: [{
      issue_id: 'issue-1',
      classifierOutput: {
        issue_id: 'issue-1',
        classification: { Category: 'maintenance', Priority: 'normal' },
        model_confidence: { Category: 0.9, Priority: 0.8 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { Category: 0.85, Priority: 0.75 },
      fieldsNeedingInput: [],
    }],
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-03-04T00:00:00.000Z',
    last_activity_at: '2026-03-04T00:00:00.000Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: 'prop-1',
    client_id: 'client-1',
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
  };
}
