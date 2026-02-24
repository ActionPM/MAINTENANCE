import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { buildResponse } from '../../orchestrator/response-builder.js';
import type { ConversationSession } from '../../session/types.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';

const mockSession: ConversationSession = {
  conversation_id: 'conv-1',
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  state: ConversationState.UNIT_SELECTED,
  unit_id: 'u1',
  authorized_unit_ids: ['u1'],
  pinned_versions: {
    taxonomy_version: '1.0.0',
    schema_version: '1.0.0',
    model_id: 'gpt-4',
    prompt_version: '1.0.0',
  },
  prior_state_before_error: null,
  draft_photo_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  last_activity_at: '2026-01-01T01:00:00Z',
};

describe('buildResponse', () => {
  it('builds a response with conversation snapshot', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.UNIT_SELECTED,
      session: mockSession,
      uiMessages: [{ role: 'agent', content: 'Unit selected.' }],
    };
    const response = buildResponse(result);
    expect(response.conversation_snapshot.conversation_id).toBe('conv-1');
    expect(response.conversation_snapshot.state).toBe('unit_selected');
    expect(response.conversation_snapshot.unit_id).toBe('u1');
    expect(response.ui_directive.messages).toHaveLength(1);
    expect(response.errors).toEqual([]);
  });

  it('includes quick replies when provided', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.UNIT_SELECTION_REQUIRED,
      session: { ...mockSession, state: ConversationState.UNIT_SELECTION_REQUIRED },
      uiMessages: [{ role: 'agent', content: 'Select a unit:' }],
      quickReplies: [
        { label: 'Unit 1', value: 'u1', action_type: 'SELECT_UNIT' },
        { label: 'Unit 2', value: 'u2', action_type: 'SELECT_UNIT' },
      ],
    };
    const response = buildResponse(result);
    expect(response.ui_directive.quick_replies).toHaveLength(2);
  });

  it('includes errors when provided', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.INTAKE_STARTED,
      session: mockSession,
      uiMessages: [],
      errors: [{ code: 'INVALID_UNIT', message: 'Unit not authorized' }],
    };
    const response = buildResponse(result);
    expect(response.errors).toHaveLength(1);
    expect(response.errors[0].code).toBe('INVALID_UNIT');
  });
});
