import { describe, it, expect } from 'vitest';
import { ConversationState, resolveCurrentVersions } from '@wo-agent/schemas';
import type { FollowUpQuestion } from '@wo-agent/schemas';
import { handleSubmitAdditionalMessage } from '../../orchestrator/action-handlers/submit-additional-message.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    state: ConversationState.NEEDS_TENANT_INPUT,
    unit_id: 'u1',
    authorized_unit_ids: ['u1'],
    pinned_versions: resolveCurrentVersions(),
    split_issues: null,
    classification_results: null,
    prior_state_before_error: null,
    draft_photo_ids: [],
    followup_turn_number: 1,
    total_questions_asked: 2,
    previous_questions: [],
    pending_followup_questions: [
      {
        question_id: 'q1',
        question_text: 'Where in the kitchen is the leak?',
        field_target: 'Sub_Location',
        answer_type: 'free_text',
        issue_id: 'iss-1',
      } as unknown as FollowUpQuestion,
    ],
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

function makeCtx(session: ConversationSession, message: string): ActionHandlerContext {
  return {
    session,
    request: {
      conversation_id: session.conversation_id,
      action_type: 'SUBMIT_ADDITIONAL_MESSAGE',
      actor: 'tenant',
      tenant_input: { message },
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

describe('handleSubmitAdditionalMessage — new issue detection (S12-03)', () => {
  it('treats short messages referencing pending fields as clarifications', async () => {
    const session = makeSession();
    const result = await handleSubmitAdditionalMessage(
      makeCtx(session, 'The sub location is the bathroom'),
    );

    // Not queued as new issue
    expect(result.eventPayload?.queued_as_new_issue).toBeUndefined();
    expect(result.session.queued_messages).toEqual([]);
  });

  it('queues long messages not referencing pending fields as new issues', async () => {
    const session = makeSession();
    const longNewIssue =
      'Also, I wanted to mention that the parking garage door has been broken for three days now. ' +
      'Every time I try to use my remote it does not respond and I have to wait for another resident to open it.';
    const result = await handleSubmitAdditionalMessage(makeCtx(session, longNewIssue));

    expect(result.eventPayload?.queued_as_new_issue).toBe(true);
    expect(result.session.queued_messages).toHaveLength(1);
    expect(result.session.queued_messages[0]).toBe(longNewIssue);
  });

  it('does not queue in non-followup states', async () => {
    const session = makeSession({ state: ConversationState.SPLIT_PROPOSED });
    const longMsg =
      'Something completely different that has nothing to do with anything. ' +
      'This is a long message that should not be detected as a new issue in this state because detection only applies during follow-ups.';
    const result = await handleSubmitAdditionalMessage(makeCtx(session, longMsg));

    expect(result.eventPayload?.queued_as_new_issue).toBeUndefined();
  });

  it('does not queue when no pending follow-up questions', async () => {
    const session = makeSession({ pending_followup_questions: null });
    const longMsg =
      'Something completely different that is a long message but there are no pending questions ' +
      'so the new-issue detection heuristic should not fire in this situation.';
    const result = await handleSubmitAdditionalMessage(makeCtx(session, longMsg));

    expect(result.eventPayload?.queued_as_new_issue).toBeUndefined();
  });

  // --- tenant_confirmation_pending detection (S12-03 gap A+B) ---

  it('queues long message (>100 chars) in tenant_confirmation_pending as new issue', async () => {
    const session = makeSession({
      state: ConversationState.TENANT_CONFIRMATION_PENDING,
      pending_followup_questions: null,
    });
    const longMsg =
      'Also, there is no heat in the bedroom. It has been freezing for three days and the thermostat ' +
      'is broken. Please send someone to check as soon as possible.';
    const result = await handleSubmitAdditionalMessage(makeCtx(session, longMsg));

    expect(result.eventPayload?.queued_as_new_issue).toBe(true);
    expect(result.session.queued_messages).toHaveLength(1);
    expect(result.session.queued_messages[0]).toBe(longMsg);
  });

  it('does NOT queue short message in tenant_confirmation_pending (<=100 chars)', async () => {
    const session = makeSession({
      state: ConversationState.TENANT_CONFIRMATION_PENDING,
      pending_followup_questions: null,
    });
    const result = await handleSubmitAdditionalMessage(makeCtx(session, 'yes, looks good'));

    expect(result.eventPayload?.queued_as_new_issue).toBeUndefined();
  });

  it('queues long message with confirmation-like words in tenant_confirmation_pending', async () => {
    const session = makeSession({
      state: ConversationState.TENANT_CONFIRMATION_PENDING,
      pending_followup_questions: null,
    });
    const longMsg =
      'no heat in the bedroom, it has been freezing for three days and the thermostat is broken, ' +
      'please send someone to check as soon as possible';
    const result = await handleSubmitAdditionalMessage(makeCtx(session, longMsg));

    // >100 chars overrides any keyword content
    expect(result.eventPayload?.queued_as_new_issue).toBe(true);
    expect(result.session.queued_messages).toHaveLength(1);
  });
});
