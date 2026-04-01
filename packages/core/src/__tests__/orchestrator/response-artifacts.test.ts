import { describe, it, expect } from 'vitest';
import { ConversationState, resolveCurrentVersions } from '@wo-agent/schemas';
import { buildResponse } from '../../orchestrator/response-builder.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

const mockSession: ConversationSession = {
  conversation_id: 'conv-1',
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  state: ConversationState.TENANT_CONFIRMATION_PENDING,
  unit_id: 'u1',
  authorized_unit_ids: ['u1'],
  pinned_versions: resolveCurrentVersions(),
  split_issues: null,
  classification_results: null,
  prior_state_before_error: null,
  draft_photo_ids: [],
  followup_turn_number: 0,
  total_questions_asked: 0,
  previous_questions: [],
  pending_followup_questions: null,
  created_at: '2026-01-01T00:00:00Z',
  last_activity_at: '2026-01-01T01:00:00Z',
  confirmation_entered_at: null,
  source_text_hash: null,
  split_hash: null,
  confirmation_presented: false,
  property_id: null,
  client_id: null,
  building_id: null,
  risk_triggers: [],
  escalation_state: 'none' as const,
  escalation_plan_id: null,
  queued_messages: [],
  confirmed_followup_answers: {},
};

describe('buildResponse — artifacts (S10-03)', () => {
  it('returns empty artifacts when handler provides none', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.UNIT_SELECTED,
      session: mockSession,
      uiMessages: [{ role: 'agent', content: 'Done.' }],
    };
    const response = buildResponse(result);
    expect(response.artifacts).toEqual([]);
  });

  it('populates artifacts from handler result', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session: mockSession,
      uiMessages: [{ role: 'agent', content: 'Confirmation ready.' }],
      artifacts: [
        {
          artifact_type: 'confirmation_payload',
          hash: 'sha256-abc123',
          presented_to_tenant: true,
        },
      ],
    };
    const response = buildResponse(result);

    expect(response.artifacts).toHaveLength(1);
    expect(response.artifacts[0]).toMatchObject({
      artifact_id: 'conv-1-artifact-0',
      artifact_type: 'confirmation_payload',
      hash: 'sha256-abc123',
      presented_to_tenant: true,
      created_at: mockSession.last_activity_at,
    });
  });

  it('populates multiple artifacts with sequential IDs', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.SUBMITTED,
      session: mockSession,
      uiMessages: [{ role: 'agent', content: 'Submitted.' }],
      artifacts: [
        { artifact_type: 'split_result', hash: 'sha256-split', presented_to_tenant: true },
        {
          artifact_type: 'classification_result',
          hash: 'sha256-class',
          presented_to_tenant: true,
        },
      ],
    };
    const response = buildResponse(result);

    expect(response.artifacts).toHaveLength(2);
    expect(response.artifacts[0].artifact_id).toBe('conv-1-artifact-0');
    expect(response.artifacts[1].artifact_id).toBe('conv-1-artifact-1');
  });
});
