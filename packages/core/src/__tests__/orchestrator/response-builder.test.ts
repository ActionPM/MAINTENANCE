import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { createSession, setSplitIssues } from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';

const mockSession: ConversationSession = {
  conversation_id: 'conv-1',
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  state: ConversationState.UNIT_SELECTED,
  unit_id: 'u1',
  split_issues: null,
  classification_results: null,
  authorized_unit_ids: ['u1'],
  pinned_versions: {
    taxonomy_version: '1.0.0',
    schema_version: '1.0.0',
    model_id: 'gpt-4',
    prompt_version: '1.0.0',
    cue_version: '1.2.0',
  },
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

  it('includes split_issues in snapshot when present', () => {
    const issues = [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
    ];
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    session = setSplitIssues(session, issues);

    const response = buildResponse({
      newState: ConversationState.SPLIT_PROPOSED,
      session,
      uiMessages: [{ role: 'agent', content: 'Issues found' }],
    });

    expect(response.conversation_snapshot.issues).toEqual(issues);
  });

  it('omits issues from snapshot when null', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    const response = buildResponse({
      newState: ConversationState.INTAKE_STARTED,
      session,
      uiMessages: [],
    });

    expect(response.conversation_snapshot.issues).toBeUndefined();
  });

  it('includes queued_messages in snapshot when non-empty', () => {
    const session: ConversationSession = {
      ...mockSession,
      queued_messages: ['parking garage door broken', 'hallway light out'],
    };
    const response = buildResponse({
      newState: ConversationState.NEEDS_TENANT_INPUT,
      session,
      uiMessages: [{ role: 'agent', content: 'Noted.' }],
    });

    expect(response.conversation_snapshot.queued_messages).toEqual([
      'parking garage door broken',
      'hallway light out',
    ]);
  });

  it('omits queued_messages from snapshot when empty', () => {
    const response = buildResponse({
      newState: ConversationState.NEEDS_TENANT_INPUT,
      session: mockSession,
      uiMessages: [{ role: 'agent', content: 'Noted.' }],
    });

    expect(response.conversation_snapshot.queued_messages).toBeUndefined();
  });
});
