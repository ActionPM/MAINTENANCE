import { describe, it, expect, vi } from 'vitest';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import {
  createSession,
  updateSessionState,
  setSplitIssues,
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
} from '../../session/session.js';
import { ConversationState, ActorType, DEFAULT_FOLLOWUP_CAPS, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, FollowUpGeneratorOutput, FollowUpQuestion, CueDictionary } from '@wo-agent/schemas';
import type { IssueClassificationResult } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const HIGH_CONF_OUTPUT: IssueClassifierOutput = {
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
    Maintenance_Category: 0.95, Maintenance_Object: 0.95, Maintenance_Problem: 0.95,
    Management_Category: 0.0, Management_Object: 0.0, Priority: 0.95,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const PENDING_QUESTIONS: FollowUpQuestion[] = [
  {
    question_id: 'q1',
    field_target: 'Priority',
    prompt: 'How urgent?',
    options: ['low', 'normal', 'high'],
    answer_type: 'enum',
  },
];

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

/**
 * Full cue dictionary covering all fields.
 * Used for tests where re-classification should resolve all fields.
 */
const FULL_CUES: CueDictionary = {
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

function makeAnswerContext(overrides?: {
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  followUpFn?: (...args: unknown[]) => Promise<unknown>;
  cueDict?: CueDictionary;
}) {
  let counter = 0;
  const priorResults: IssueClassificationResult[] = [{
    issue_id: 'i1',
    classifierOutput: {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.3 },
    },
    computedConfidence: { Category: 0.9, Priority: 0.4 },
    fieldsNeedingInput: ['Priority'],
  }];

  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
  session = setSplitIssues(session, [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
  ]);
  session = setClassificationResults(session, priorResults);
  session = updateFollowUpTracking(session, PENDING_QUESTIONS);
  session = setPendingFollowUpQuestions(session, PENDING_QUESTIONS);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: 'ANSWER_FOLLOWUPS' as any,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [
          { question_id: 'q1', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' },
        ],
      },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: { insert: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-25T12:05:00.000Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(HIGH_CONF_OUTPUT),
      followUpGenerator: overrides?.followUpFn ?? vi.fn().mockResolvedValue({
        questions: [{
          question_id: 'q2', field_target: 'Priority',
          prompt: 'Priority again?', options: ['low', 'high'], answer_type: 'enum',
        }],
      }),
      cueDict: overrides?.cueDict ?? FULL_CUES,
      taxonomy,
      followUpCaps: DEFAULT_FOLLOWUP_CAPS,
    } as any,
  };
}

describe('handleAnswerFollowups', () => {
  it('records a followup_event with answers', async () => {
    const ctx = makeAnswerContext();
    await handleAnswerFollowups(ctx);

    expect(ctx.deps.eventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-1',
        issue_id: 'i1',
        turn_number: 1,
        answers_received: expect.arrayContaining([
          expect.objectContaining({ question_id: 'q1', answer: 'normal' }),
        ]),
      }),
    );
  });

  it('re-classifies and transitions to tenant_confirmation_pending when all fields resolved', async () => {
    const ctx = makeAnswerContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('generates new follow-up questions when fields still need input after re-classification', async () => {
    const stillLowConf: IssueClassifierOutput = {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.4 },
    };
    const ctx = makeAnswerContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowConf),
      cueDict: MINI_CUES,
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.pending_followup_questions).toBeDefined();
    expect(result.session.pending_followup_questions!.length).toBeGreaterThan(0);
  });

  it('triggers escape hatch when turn cap exceeded', async () => {
    const stillLowConf: IssueClassifierOutput = {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.4 },
    };
    const ctx = makeAnswerContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowConf),
      cueDict: MINI_CUES,
    });
    // Simulate being at turn 8 already
    ctx.session = {
      ...ctx.session,
      followup_turn_number: 8,
      total_questions_asked: 8,
    } as any;

    const result = await handleAnswerFollowups(ctx);
    // Should escape hatch → tenant_confirmation_pending with needs_human_triage
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
  });

  it('triggers escape hatch when re-ask limit reached for all fields', async () => {
    const stillLowConf: IssueClassifierOutput = {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.4 },
    };
    const ctx = makeAnswerContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowConf),
      cueDict: MINI_CUES,
    });
    // Simulate Priority already asked 2 times
    ctx.session = {
      ...ctx.session,
      previous_questions: [{ field_target: 'Priority', times_asked: 2 }],
    } as any;

    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
  });

  it('clears pending questions from session on completion', async () => {
    const ctx = makeAnswerContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.session.pending_followup_questions).toBeNull();
  });

  it('passes followup_answers to classifier re-classification input', async () => {
    const ctx = makeAnswerContext();
    await handleAnswerFollowups(ctx);

    // Verify the classifier was called with followup_answers
    expect(ctx.deps.issueClassifier).toHaveBeenCalledWith(
      expect.objectContaining({
        followup_answers: expect.arrayContaining([
          expect.objectContaining({ field_target: 'Priority', answer: 'normal' }),
        ]),
      }),
      undefined,
    );
  });
});
