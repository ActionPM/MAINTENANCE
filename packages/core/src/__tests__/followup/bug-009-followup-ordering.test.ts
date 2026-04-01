import { describe, expect, it, vi } from 'vitest';
import {
  ActorType,
  ConversationState,
  DEFAULT_FOLLOWUP_CAPS,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type {
  ConfidenceConfig,
  CueDictionary,
  FollowUpQuestion,
  IssueClassifierOutput,
  PreviousQuestion,
} from '@wo-agent/schemas';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
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

const BUG009_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: {
      maintenance: { keywords: ['plumbing', 'issue', 'leak'], regex: [] },
    },
    Location: {
      suite: { keywords: ['suite', 'apartment', 'unit'], regex: [] },
    },
    Sub_Location: {
      bathroom: { keywords: ['bathroom', 'washroom'], regex: [] },
    },
    Maintenance_Category: {
      plumbing: { keywords: ['plumbing', 'pipe'], regex: [] },
    },
    Maintenance_Object: {
      toilet: { keywords: ['toilet'], regex: [] },
    },
    Maintenance_Problem: {
      leak: { keywords: ['leak'], regex: [] },
    },
    Priority: {
      high: { keywords: ['high', 'urgent'], regex: [] },
    },
  },
};

const BUG009_CONFIDENCE: ConfidenceConfig = {
  high_threshold: 0.85,
  medium_threshold: 0.3,
  model_hint_min: 0.2,
  model_hint_max: 0.95,
  resolved_medium_threshold: 0.4,
  resolved_medium_max_ambiguity: 0.2,
  category_gating_threshold: 0.7,
  weights: {
    cue_strength: 0.4,
    completeness: 0.25,
    model_hint: 0.2,
    constraint_implied: 0.25,
    disagreement: 0.1,
    ambiguity_penalty: 0.05,
  },
};

const ISSUE = {
  issue_id: 'i1',
  summary: 'Plumbing issue',
  raw_excerpt: 'I have a plumbing issue',
};

function makeClassificationOutput(
  classification: Record<string, string>,
  missingFields: readonly string[],
): IssueClassifierOutput {
  const modelConfidence: Record<string, number> = {
    Category: 0.95,
    Location: classification.Location ? 0.95 : 0.2,
    Sub_Location: classification.Sub_Location ? 0.95 : 0.2,
    Maintenance_Category: classification.Maintenance_Category ? 0.95 : 0.2,
    Maintenance_Object: classification.Maintenance_Object ? 0.95 : 0.2,
    Maintenance_Problem: classification.Maintenance_Problem ? 0.95 : 0.2,
    Priority: classification.Priority ? 0.95 : 0.2,
  };

  return {
    issue_id: ISSUE.issue_id,
    classification,
    model_confidence: modelConfidence,
    missing_fields: [...missingFields],
    needs_human_triage: false,
  };
}

function makeStartContext(overrides?: {
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  followUpFn?: (...args: unknown[]) => Promise<unknown>;
}) {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-bug009',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
  session = setSplitIssues(session, [ISSUE]);

  return {
    session,
    request: {
      conversation_id: 'conv-bug009',
      action_type: 'START_CLASSIFICATION' as const,
      actor: ActorType.SYSTEM,
      tenant_input: {},
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
      clock: () => '2026-03-30T12:00:00.000Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn(),
      followUpGenerator: overrides?.followUpFn ?? vi.fn(),
      cueDict: BUG009_CUES,
      taxonomy,
      confidenceConfig: BUG009_CONFIDENCE,
      followUpCaps: DEFAULT_FOLLOWUP_CAPS,
    } as any,
  } satisfies ActionHandlerContext;
}

function buildEchoFollowUpGenerator() {
  return vi.fn(async (input: unknown) => ({
    questions: (
      (input as { fields_needing_input: readonly string[] }).fields_needing_input ?? []
    ).map(
      (field, index): FollowUpQuestion => ({
        question_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        field_target: field,
        prompt: `Question for ${field}?`,
        options: [],
        answer_type: 'enum',
      }),
    ),
  }));
}

async function answerSinglePendingQuestion(
  session: ConversationSession,
  answer: string,
  deps: ActionHandlerContext['deps'],
): Promise<ReturnType<typeof handleAnswerFollowups>> {
  const pending = session.pending_followup_questions ?? [];
  expect(pending).toHaveLength(1);

  return handleAnswerFollowups({
    session: {
      ...session,
      state: ConversationState.NEEDS_TENANT_INPUT,
    },
    request: {
      conversation_id: session.conversation_id,
      action_type: 'ANSWER_FOLLOWUPS',
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [
          {
            question_id: pending[0].question_id,
            answer,
            received_at: '2026-03-30T12:05:00.000Z',
          },
        ],
      },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    } as any,
    deps,
  });
}

describe('BUG-009 maintenance follow-up ordering', () => {
  it('asks only the active maintenance frontier field at each step, then releases Priority', async () => {
    const classifierFn = vi
      .fn()
      .mockResolvedValueOnce(
        makeClassificationOutput({ Category: 'maintenance' }, [
          'Location',
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ]),
      )
      .mockResolvedValueOnce(
        makeClassificationOutput({ Category: 'maintenance', Location: 'suite' }, [
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ]),
      )
      .mockResolvedValueOnce(
        makeClassificationOutput(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'bathroom',
          },
          ['Maintenance_Category', 'Maintenance_Object', 'Maintenance_Problem', 'Priority'],
        ),
      )
      .mockResolvedValueOnce(
        makeClassificationOutput(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'bathroom',
            Maintenance_Category: 'plumbing',
          },
          ['Maintenance_Object', 'Maintenance_Problem', 'Priority'],
        ),
      )
      .mockResolvedValueOnce(
        makeClassificationOutput(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'bathroom',
            Maintenance_Category: 'plumbing',
            Maintenance_Object: 'toilet',
          },
          ['Maintenance_Problem', 'Priority'],
        ),
      )
      .mockResolvedValueOnce(
        makeClassificationOutput(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'bathroom',
            Maintenance_Category: 'plumbing',
            Maintenance_Object: 'toilet',
            Maintenance_Problem: 'leak',
          },
          ['Priority'],
        ),
      );

    const followUpFn = buildEchoFollowUpGenerator();
    const startCtx = makeStartContext({ classifierFn, followUpFn });

    const result1 = await handleStartClassification(startCtx);
    expect(result1.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result1.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Location',
    ]);

    const result2 = await answerSinglePendingQuestion(result1.session, 'suite', startCtx.deps);
    expect(result2.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result2.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Sub_Location',
    ]);

    const result3 = await answerSinglePendingQuestion(result2.session, 'bathroom', startCtx.deps);
    expect(result3.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result3.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Maintenance_Category',
    ]);

    const result4 = await answerSinglePendingQuestion(result3.session, 'plumbing', startCtx.deps);
    expect(result4.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result4.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Maintenance_Object',
    ]);

    const result5 = await answerSinglePendingQuestion(result4.session, 'toilet', startCtx.deps);
    expect(result5.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result5.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Maintenance_Problem',
    ]);

    const result6 = await answerSinglePendingQuestion(result5.session, 'leak', startCtx.deps);
    expect(result6.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result6.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Priority',
    ]);
  });

  it('routes to review when the active parent field is capped instead of skipping ahead to descendants', async () => {
    const classifierFn = vi
      .fn()
      .mockResolvedValue(
        makeClassificationOutput({ Category: 'maintenance', Location: 'suite' }, [
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ]),
      );
    const followUpFn = buildEchoFollowUpGenerator();

    const startCtx = makeStartContext({ classifierFn, followUpFn });
    const priorResults: IssueClassificationResult[] = [
      {
        issue_id: ISSUE.issue_id,
        classifierOutput: makeClassificationOutput({ Category: 'maintenance' }, [
          'Location',
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ]),
        computedConfidence: {
          Category: 0.95,
          Location: 0.2,
          Sub_Location: 0.2,
          Maintenance_Category: 0.2,
          Maintenance_Object: 0.2,
          Maintenance_Problem: 0.2,
          Priority: 0.2,
        },
        fieldsNeedingInput: [
          'Location',
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ],
        shouldAskFollowup: true,
        followupTypes: {},
        constraintPassed: true,
        recoverable_via_followup: true,
      },
    ];

    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-location',
        field_target: 'Location',
        prompt: 'Where is the issue located?',
        options: ['suite', 'building_interior'],
        answer_type: 'enum',
      },
    ];

    let session = createSession({
      conversation_id: 'conv-bug009-capped',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });
    session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
    session = setSplitIssues(session, [ISSUE]);
    session = setClassificationResults(session, priorResults);
    session = updateFollowUpTracking(session, pendingQuestions);
    session = setPendingFollowUpQuestions(session, pendingQuestions);
    session = {
      ...session,
      previous_questions: [
        ...(session.previous_questions as PreviousQuestion[]),
        { field_target: 'Sub_Location', times_asked: 3 },
      ],
    };

    const result = await handleAnswerFollowups({
      session,
      request: {
        conversation_id: session.conversation_id,
        action_type: 'ANSWER_FOLLOWUPS',
        actor: ActorType.TENANT,
        tenant_input: {
          answers: [{ question_id: 'q-location', answer: 'suite' }],
        },
        auth_context: {
          tenant_user_id: 'user-1',
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['u1'],
        },
      } as any,
      deps: startCtx.deps,
    });

    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.pending_followup_questions).toBeNull();
    expect(result.session.classification_results?.[0].classifierOutput.needs_human_triage).toBe(
      true,
    );
    expect(followUpFn).not.toHaveBeenCalled();
  });

  it('asks only Location first when the classifier guesses downstream plumbing values with low confidence', async () => {
    const classifierFn = vi.fn().mockResolvedValue({
      issue_id: ISSUE.issue_id,
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.3,
        Sub_Location: 0.95,
        Maintenance_Category: 0.95,
        Maintenance_Object: 0.3,
        Maintenance_Problem: 0.3,
        Priority: 0.95,
      },
      missing_fields: [],
      needs_human_triage: false,
    } satisfies IssueClassifierOutput);

    const followUpFn = buildEchoFollowUpGenerator();
    const startCtx = makeStartContext({ classifierFn, followUpFn });

    const result = await handleStartClassification(startCtx);

    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Location',
    ]);
  });

  it('asks Sub_Location after Location even if re-classification guesses a downstream object', async () => {
    const classifierFn = vi
      .fn()
      .mockResolvedValueOnce(
        makeClassificationOutput({ Category: 'maintenance' }, [
          'Location',
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ]),
      )
      .mockResolvedValueOnce({
        issue_id: ISSUE.issue_id,
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'general',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
        },
        model_confidence: {
          Category: 0.95,
          Location: 0.95,
          Sub_Location: 0.2,
          Maintenance_Category: 0.95,
          Maintenance_Object: 0.95,
          Maintenance_Problem: 0.95,
          Priority: 0.2,
        },
        missing_fields: ['Sub_Location', 'Priority'],
        needs_human_triage: false,
      } satisfies IssueClassifierOutput);

    const followUpFn = buildEchoFollowUpGenerator();
    const startCtx = makeStartContext({ classifierFn, followUpFn });

    const first = await handleStartClassification(startCtx);
    expect(first.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Location',
    ]);

    const second = await answerSinglePendingQuestion(first.session, 'suite', startCtx.deps);
    expect(second.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(second.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Sub_Location',
    ]);
  });
});
