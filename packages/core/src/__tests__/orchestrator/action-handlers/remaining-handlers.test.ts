import { describe, it, expect, vi } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { handleSubmitAdditionalMessage } from '../../../orchestrator/action-handlers/submit-additional-message.js';
import { handleAnswerFollowups } from '../../../orchestrator/action-handlers/answer-followups.js';
import { handleConfirmSubmission } from '../../../orchestrator/action-handlers/confirm-submission.js';
import { handlePhotoUpload } from '../../../orchestrator/action-handlers/photo-upload.js';
import { handleResume } from '../../../orchestrator/action-handlers/resume.js';
import { handleAbandon } from '../../../orchestrator/action-handlers/abandon.js';
import { createSession, updateSessionState, setSplitIssues, setClassificationResults, setPendingFollowUpQuestions } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../../idempotency/in-memory-idempotency-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

const taxonomy = loadTaxonomy();
const FULL_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['leak'], regex: [] } },
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

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
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: FULL_CUES,
      taxonomy,
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: `prop-for-${unitId}`,
          client_id: `client-for-${unitId}`,
        }),
      },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
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
  it('returns error when session has no pending follow-up questions', async () => {
    const ctx = makeContext(ConversationState.NEEDS_TENANT_INPUT, ActionType.ANSWER_FOLLOWUPS, {
      answers: [{ question_id: 'q1', answer: 'yes' }],
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('NO_PENDING_QUESTIONS');
  });

  it('re-classifies and reaches tenant_confirmation_pending with split_issues', async () => {
    const ctx = makeContext(ConversationState.NEEDS_TENANT_INPUT, ActionType.ANSWER_FOLLOWUPS, {
      answers: [{ question_id: 'q-priority', answer: 'normal' }],
    });

    // The re-classification mock returns a fully-resolved classification
    const fullClassification = {
      issue_id: 'i1',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'other_mgmt_obj',
        Priority: 'normal',
      },
      model_confidence: {
        Category: 0.95, Location: 0.9, Sub_Location: 0.85,
        Maintenance_Category: 0.92, Maintenance_Object: 0.95,
        Maintenance_Problem: 0.88, Management_Category: 0.95,
        Management_Object: 0.95, Priority: 0.9,
      },
      missing_fields: [],
      needs_human_triage: false,
    };
    (ctx.deps as any).issueClassifier = vi.fn().mockResolvedValue(fullClassification);
    (ctx.deps as any).followUpGenerator = vi.fn().mockResolvedValue({ questions: [] });

    // Full cues covering all fields so confidence is high
    const fullCues: CueDictionary = {
      version: '1.0.0',
      fields: {
        Category: { maintenance: { keywords: ['leak'], regex: [] } },
        Location: { suite: { keywords: ['toilet'], regex: [] } },
        Sub_Location: { bathroom: { keywords: ['toilet'], regex: [] } },
        Maintenance_Category: { plumbing: { keywords: ['leak', 'toilet'], regex: [] } },
        Maintenance_Object: { toilet: { keywords: ['toilet'], regex: [] } },
        Maintenance_Problem: { leak: { keywords: ['leak'], regex: [] } },
        Management_Category: { other_mgmt_cat: { keywords: ['toilet'], regex: [] } },
        Management_Object: { other_mgmt_obj: { keywords: ['toilet'], regex: [] } },
        Priority: { normal: { keywords: ['leak'], regex: [] } },
      },
    };
    (ctx.deps as any).cueDict = fullCues;

    // Set up split_issues, classification_results, and pending questions
    let session = setSplitIssues(ctx.session, [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
    ]);
    session = setClassificationResults(session, [{
      issue_id: 'i1',
      classifierOutput: {
        issue_id: 'i1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { Category: 0.9 },
      fieldsNeedingInput: ['Priority'],
    }]);
    session = setPendingFollowUpQuestions(session, [
      { question_id: 'q-priority', field_target: 'Priority', prompt: 'How urgent?', options: ['low', 'normal', 'high'], answer_type: 'enum' },
    ]);
    (ctx as any).session = session;

    const result = await handleAnswerFollowups(ctx);
    expect(result.intermediateSteps).toBeDefined();
    expect(result.intermediateSteps![0].state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});

describe('handleConfirmSubmission', () => {
  it('transitions to submitted when session has issues and classification', async () => {
    const ctx = makeContext(ConversationState.TENANT_CONFIRMATION_PENDING, ActionType.CONFIRM_SUBMISSION);
    // Set up required session data for confirmation
    let session = setSplitIssues(ctx.session, [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
    ]);
    session = setClassificationResults(session, [{
      issue_id: 'i1',
      classifierOutput: {
        issue_id: 'i1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { Category: 0.9 },
      fieldsNeedingInput: [],
    }]);
    session = { ...session, unit_id: 'u1', property_id: 'prop-1', client_id: 'client-1' };
    (ctx as any).session = session;
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
