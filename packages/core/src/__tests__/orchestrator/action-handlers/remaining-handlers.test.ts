import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSubmitAdditionalMessage } from '../../../orchestrator/action-handlers/submit-additional-message.js';
import { handleAnswerFollowups } from '../../../orchestrator/action-handlers/answer-followups.js';
import { handleConfirmSubmission } from '../../../orchestrator/action-handlers/confirm-submission.js';
import { handlePhotoUpload } from '../../../orchestrator/action-handlers/photo-upload.js';
import { handleResume } from '../../../orchestrator/action-handlers/resume.js';
import { handleAbandon } from '../../../orchestrator/action-handlers/abandon.js';
import { createSession, updateSessionState } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(state: string, actionType: string, tenantInput: Record<string, unknown> = {}): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  if (state !== ConversationState.INTAKE_STARTED) {
    session = updateSessionState(session, state as any);
  }
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: actionType as any,
      actor: ActorType.TENANT,
      tenant_input: tenantInput as any,
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({
        issue_id: 'issue-1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      }),
    },
  };
}

describe('handleSubmitAdditionalMessage', () => {
  it('stays in needs_tenant_input', async () => {
    const ctx = makeContext(ConversationState.NEEDS_TENANT_INPUT, ActionType.SUBMIT_ADDITIONAL_MESSAGE, { message: 'Also...' });
    const result = await handleSubmitAdditionalMessage(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
  });

  it('stays in tenant_confirmation_pending', async () => {
    const ctx = makeContext(ConversationState.TENANT_CONFIRMATION_PENDING, ActionType.SUBMIT_ADDITIONAL_MESSAGE, { message: 'Wait...' });
    const result = await handleSubmitAdditionalMessage(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});

describe('handleAnswerFollowups', () => {
  it('transitions to classification_in_progress', async () => {
    const ctx = makeContext(ConversationState.NEEDS_TENANT_INPUT, ActionType.ANSWER_FOLLOWUPS, {
      answers: [{ question_id: 'q1', answer: 'yes' }],
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
  });
});

describe('handleConfirmSubmission', () => {
  it('transitions to submitted', async () => {
    const ctx = makeContext(ConversationState.TENANT_CONFIRMATION_PENDING, ActionType.CONFIRM_SUBMISSION);
    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);
  });
});

describe('handlePhotoUpload', () => {
  it('returns same state for UPLOAD_PHOTO_INIT', async () => {
    const ctx = makeContext(ConversationState.SPLIT_PROPOSED, ActionType.UPLOAD_PHOTO_INIT, {
      filename: 'leak.jpg', content_type: 'image/jpeg', size_bytes: 1024,
    });
    const result = await handlePhotoUpload(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });

  it('returns same state for UPLOAD_PHOTO_COMPLETE', async () => {
    const ctx = makeContext(ConversationState.INTAKE_STARTED, ActionType.UPLOAD_PHOTO_COMPLETE, {
      photo_id: 'p1', storage_key: 'key', sha256: 'abc',
    });
    const result = await handlePhotoUpload(ctx);
    expect(result.newState).toBe(ConversationState.INTAKE_STARTED);
  });
});

describe('handleResume', () => {
  it('returns current state for non-abandoned session', async () => {
    const ctx = makeContext(ConversationState.SUBMITTED, ActionType.RESUME);
    const result = await handleResume(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);
  });
});

describe('handleAbandon', () => {
  it('transitions to intake_abandoned', async () => {
    const ctx = makeContext(ConversationState.UNIT_SELECTED, ActionType.ABANDON);
    const result = await handleAbandon(ctx);
    expect(result.newState).toBe(ConversationState.INTAKE_ABANDONED);
  });
});
