import { describe, expect, it, vi } from 'vitest';
import {
  ActorType,
  ConversationState,
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_FOLLOWUP_CAPS,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type { CueDictionary, FollowUpQuestion, IssueClassifierOutput } from '@wo-agent/schemas';
import { buildConfirmationPayload } from '../../confirmation/payload-builder.js';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import {
  createSession,
  setClassificationResults,
  setPendingFollowUpQuestions,
  setSplitIssues,
  updateFollowUpTracking,
  updateSessionState,
} from '../../session/session.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession, IssueClassificationResult } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

const ISSUE = {
  issue_id: 'i1',
  summary: 'Plumbing issue',
  raw_excerpt: 'I have a plumbing issue',
};

const CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['plumbing', 'leak', 'repair'], regex: [] } },
    Location: { suite: { keywords: ['suite', 'apartment', 'unit'], regex: [] } },
    Sub_Location: { bathroom: { keywords: ['bathroom', 'washroom'], regex: [] } },
    Maintenance_Category: { plumbing: { keywords: ['plumbing', 'pipe'], regex: [] } },
    Maintenance_Object: {
      toilet: { keywords: ['toilet'], regex: [] },
      faucet: { keywords: ['faucet'], regex: [] },
    },
    Maintenance_Problem: { leak: { keywords: ['leak', 'drip'], regex: [] } },
    Priority: {
      normal: { keywords: ['standard'], regex: [] },
      high: { keywords: ['urgent'], regex: [] },
    },
    Management_Category: { accounting: { keywords: ['rent'], regex: [] } },
    Management_Object: { rent_charges: { keywords: ['charge'], regex: [] } },
  },
};

function buildOutput(
  classification: Record<string, string>,
  options?: {
    modelConfidence?: Record<string, number>;
    missingFields?: readonly string[];
    needsHumanTriage?: boolean;
  },
): IssueClassifierOutput {
  return {
    issue_id: ISSUE.issue_id,
    classification,
    model_confidence: {
      Category: 0.95,
      Location: 0.95,
      Sub_Location: 0.95,
      Maintenance_Category: 0.95,
      Maintenance_Object: 0.95,
      Maintenance_Problem: 0.95,
      Priority: 0.95,
      Management_Category: 0.95,
      Management_Object: 0.95,
      ...(options?.modelConfidence ?? {}),
    },
    missing_fields: [...(options?.missingFields ?? [])],
    needs_human_triage: options?.needsHumanTriage ?? false,
  };
}

function buildPriorResult(fieldsNeedingInput: readonly string[]): IssueClassificationResult {
  return {
    issue_id: ISSUE.issue_id,
    classifierOutput: buildOutput(
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'general',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'other_object',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      },
      {
        modelConfidence: Object.fromEntries(fieldsNeedingInput.map((field) => [field, 0.3])),
        missingFields: fieldsNeedingInput,
      },
    ),
    computedConfidence: Object.fromEntries(fieldsNeedingInput.map((field) => [field, 0.3])),
    fieldsNeedingInput: [...fieldsNeedingInput],
    shouldAskFollowup: fieldsNeedingInput.length > 0,
    followupTypes: {},
    constraintPassed: true,
    recoverable_via_followup: true,
  };
}

function makeContext(input: {
  pendingQuestions: FollowUpQuestion[];
  answers: Array<{ question_id: string; answer: unknown; received_at?: string }>;
  classifierOutput: IssueClassifierOutput;
  priorResults?: IssueClassificationResult[];
  confirmedFollowupAnswers?: Record<string, Record<string, string>>;
  followupOutput?: { questions: FollowUpQuestion[] };
}): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-bug009-pin',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
  session = setSplitIssues(session, [ISSUE]);
  session = setClassificationResults(
    session,
    input.priorResults ?? [buildPriorResult(input.pendingQuestions.map((q) => q.field_target))],
  );
  session = updateFollowUpTracking(session, input.pendingQuestions);
  session = setPendingFollowUpQuestions(session, input.pendingQuestions);
  if (input.confirmedFollowupAnswers) {
    session = {
      ...session,
      confirmed_followup_answers: input.confirmedFollowupAnswers,
    } satisfies ConversationSession;
  }

  return {
    session,
    request: {
      conversation_id: session.conversation_id,
      action_type: 'ANSWER_FOLLOWUPS',
      actor: ActorType.TENANT,
      tenant_input: { answers: input.answers },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    } as any,
    deps: {
      eventRepo: { insert: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `evt-${++counter}`,
      clock: () => '2026-03-30T12:05:00.000Z',
      issueSplitter: vi.fn(),
      issueClassifier: vi.fn().mockResolvedValue(input.classifierOutput),
      followUpGenerator: vi.fn().mockResolvedValue(input.followupOutput ?? { questions: [] }),
      cueDict: CUES,
      taxonomy,
      confidenceConfig: DEFAULT_CONFIDENCE_CONFIG,
      followUpCaps: DEFAULT_FOLLOWUP_CAPS,
    } as any,
  };
}

describe('Bug-009 Phase 2: follow-up answer pinning', () => {
  it('pins enum answers across rounds and does not re-ask previously answered fields', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which room?',
        options: ['bathroom', 'kitchen'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: { [ISSUE.issue_id]: { Location: 'suite' } },
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        {
          modelConfidence: { Location: 0.2, Sub_Location: 0.2 },
          missingFields: ['Location', 'Sub_Location'],
        },
      ),
    });

    const result = await handleAnswerFollowups(ctx);
    const stored = result.session.classification_results![0];

    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.confirmed_followup_answers).toEqual({
      [ISSUE.issue_id]: {
        Location: 'suite',
        Sub_Location: 'bathroom',
      },
    });
    expect(stored.fieldsNeedingInput).not.toContain('Location');
    expect(stored.fieldsNeedingInput).not.toContain('Sub_Location');
    expect(stored.classifierOutput.missing_fields).not.toContain('Location');
    expect(stored.classifierOutput.missing_fields).not.toContain('Sub_Location');
  });

  it('overwrites classifier values with pinned tenant answers and confirmation payload reflects them', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-priority',
        field_target: 'Priority',
        prompt: 'How urgent?',
        options: ['normal', 'high'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-priority', answer: 'high' }],
      confirmedFollowupAnswers: { [ISSUE.issue_id]: { Maintenance_Object: 'toilet' } },
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'faucet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);
    const stored = result.session.classification_results![0];
    const payload = buildConfirmationPayload(
      result.session.split_issues!,
      result.session.classification_results!,
    );

    expect(stored.classifierOutput.classification.Maintenance_Object).toBe('toilet');
    expect(stored.classifierOutput.classification.Priority).toBe('high');
    expect(payload.issues[0].classification.Maintenance_Object).toBe('toilet');
    expect(payload.issues[0].classification.Priority).toBe('high');
  });

  it('sets confidence to 1.0 for pinned fields in stored classification results', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-priority',
        field_target: 'Priority',
        prompt: 'How urgent?',
        options: ['normal', 'high'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-priority', answer: 'normal' }],
      confirmedFollowupAnswers: { [ISSUE.issue_id]: { Location: 'suite' } },
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        {
          modelConfidence: { Location: 0.1, Priority: 0.1 },
          missingFields: ['Location'],
        },
      ),
    });

    const result = await handleAnswerFollowups(ctx);
    const stored = result.session.classification_results![0];

    expect(stored.computedConfidence.Location).toBe(1);
    expect(stored.computedConfidence.Priority).toBe(1);
  });

  it('does not pin yes_no answers as taxonomy field values', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-urgent',
        field_target: 'Priority',
        prompt: 'Is this urgent?',
        options: ['yes', 'no'],
        answer_type: 'yes_no',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-urgent', answer: true }],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);
    expect(result.session.confirmed_followup_answers).toEqual({});
  });

  it('does not pin text answers as taxonomy field values', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-text',
        field_target: 'Maintenance_Problem',
        prompt: 'Describe the problem.',
        options: [],
        answer_type: 'text',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-text', answer: 'It drips constantly.' }],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);
    expect(result.session.confirmed_followup_answers).toEqual({});
  });

  it('does not auto-resolve earlier hierarchy fields from pinned downstream values', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-priority',
        field_target: 'Priority',
        prompt: 'How urgent?',
        options: ['normal', 'high'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-priority', answer: 'normal' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Location: 'suite', Maintenance_Object: 'toilet' },
      },
      followupOutput: {
        questions: [
          {
            question_id: 'q-sub-next',
            field_target: 'Sub_Location',
            prompt: 'Which room?',
            options: ['bathroom', 'kitchen'],
            answer_type: 'enum',
          },
        ],
      },
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'general',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'faucet',
          Maintenance_Problem: 'leak',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        {
          modelConfidence: { Sub_Location: 0.2 },
          missingFields: ['Sub_Location'],
        },
      ),
    });

    const result = await handleAnswerFollowups(ctx);
    const stored = result.session.classification_results![0];
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(stored.classifierOutput.classification.Maintenance_Object).toBe('toilet');
    expect(stored.classifierOutput.classification.Sub_Location).toBe('general');
    expect(result.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Sub_Location',
    ]);
  });

  it('routes to triage when pinned answers contradict the resolved category and logs the contradiction event', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-priority',
        field_target: 'Priority',
        prompt: 'How urgent?',
        options: ['normal', 'high'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-priority', answer: 'normal' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Management_Category: 'accounting', Management_Object: 'rent_charges' },
      },
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);
    const stored = result.session.classification_results![0];
    const contradictionEvent = vi
      .mocked(ctx.deps.eventRepo.insert)
      .mock.calls.map(([event]) => event)
      .find(
        (event) =>
          (event as { event_type?: string }).event_type ===
          'classification_pinned_answer_contradiction',
      ) as
      | {
          payload: { violations: string[]; pinned_fields: Record<string, string> };
        }
      | undefined;

    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(stored.classifierOutput.needs_human_triage).toBe(true);
    expect(contradictionEvent?.payload.pinned_fields).toMatchObject({
      Management_Category: 'accounting',
      Management_Object: 'rent_charges',
    });
    expect(contradictionEvent?.payload.violations.length).toBeGreaterThan(0);
  });

  it('stores post-overlay values on the session so downstream consumers do not need to re-derive them', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-priority',
        field_target: 'Priority',
        prompt: 'How urgent?',
        options: ['normal', 'high'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-priority', answer: 'high' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Maintenance_Object: 'toilet', Location: 'suite' },
      },
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Sub_Location: 'general',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'faucet',
          Maintenance_Problem: 'leak',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        {
          modelConfidence: {
            Maintenance_Object: 0.2,
            Location: 0.2,
            Priority: 0.2,
            Sub_Location: 0.2,
          },
          missingFields: ['Location', 'Sub_Location'],
        },
      ),
    });

    const result = await handleAnswerFollowups(ctx);
    const stored = result.session.classification_results![0];

    expect(stored.classifierOutput.classification.Location).toBe('suite');
    expect(stored.classifierOutput.classification.Maintenance_Object).toBe('toilet');
    expect(stored.classifierOutput.classification.Sub_Location).toBe('general');
    expect(stored.classifierOutput.classification.Priority).toBe('high');
    expect(stored.computedConfidence.Location).toBe(1);
    expect(stored.computedConfidence.Maintenance_Object).toBe(1);
    expect(stored.computedConfidence.Priority).toBe(1);
  });
});
