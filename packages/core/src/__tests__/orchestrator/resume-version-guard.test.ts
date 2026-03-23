import { describe, it, expect } from 'vitest';
import { ConversationState, resolveCurrentVersions } from '@wo-agent/schemas';
import { handleResume } from '../../orchestrator/action-handlers/resume.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    state: ConversationState.SPLIT_PROPOSED,
    pinned_versions: resolveCurrentVersions(),
    unit_id: 'u1',
    split_issues: null,
    classification_results: null,
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-01-15T12:00:00Z',
    last_activity_at: '2026-01-15T12:00:00Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: null,
    client_id: null,
    building_id: null,
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
    queued_messages: [],
    ...overrides,
  };
}

function makeCtx(session: ConversationSession): ActionHandlerContext {
  return {
    session,
    request: {
      conversation_id: session.conversation_id,
      action_type: 'RESUME',
      actor: 'tenant',
      tenant_input: {},
      auth_context: {
        tenant_user_id: session.tenant_user_id,
        tenant_account_id: session.tenant_account_id,
        authorized_unit_ids: session.authorized_unit_ids as string[],
      },
    },
    deps: {} as any,
    request_id: 'req-1',
  };
}

describe('handleResume — version integrity guard', () => {
  it('succeeds when pinned versions are intact', async () => {
    const session = makeSession();
    const result = await handleResume(makeCtx(session));

    expect(result.errors).toBeUndefined();
    expect(result.newState).toBe(session.state);
    expect(result.eventPayload).toMatchObject({ version_integrity: 'passed' });
  });

  it('retains original pinned versions on resume (not overwritten)', async () => {
    const customVersions = {
      taxonomy_version: '0.9.0',
      schema_version: '0.8.0',
      model_id: 'claude-haiku-4-5-20251001',
      prompt_version: '0.7.0',
      cue_version: '1.0.0',
    };
    const session = makeSession({ pinned_versions: customVersions });
    const result = await handleResume(makeCtx(session));

    expect(result.session.pinned_versions).toEqual(customVersions);
    expect(result.errors).toBeUndefined();
  });

  it('fails with VERSION_INTEGRITY_FAILURE when taxonomy_version is empty', async () => {
    const session = makeSession({
      pinned_versions: {
        taxonomy_version: '',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
      cue_version: '1.2.0',
      },
    });
    const result = await handleResume(makeCtx(session));

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].code).toBe('VERSION_INTEGRITY_FAILURE');
    expect(result.eventPayload).toMatchObject({ version_integrity: 'failed' });
  });

  it('fails with VERSION_INTEGRITY_FAILURE when model_id is empty', async () => {
    const session = makeSession({
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: '',
        prompt_version: '1.0.0',
      cue_version: '1.2.0',
      },
    });
    const result = await handleResume(makeCtx(session));

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].code).toBe('VERSION_INTEGRITY_FAILURE');
  });

  it('fails when all pinned versions are empty (corrupted session)', async () => {
    const session = makeSession({
      pinned_versions: {
        taxonomy_version: '',
        schema_version: '',
        model_id: '',
        prompt_version: '',
        cue_version: '',
      },
    });
    const result = await handleResume(makeCtx(session));

    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('VERSION_INTEGRITY_FAILURE');
  });
});
