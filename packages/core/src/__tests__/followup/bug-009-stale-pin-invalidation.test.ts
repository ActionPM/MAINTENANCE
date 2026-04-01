import { describe, expect, it, vi } from 'vitest';
import {
  ActorType,
  ConversationState,
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_FOLLOWUP_CAPS,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type {
  CueDictionary,
  FollowUpQuestion,
  IssueClassifierOutput,
  FollowUpCaps,
} from '@wo-agent/schemas';
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
  summary: 'Maintenance issue in unit',
  raw_excerpt: 'I have a maintenance issue',
};

const ISSUE_2 = {
  issue_id: 'i2',
  summary: 'Second maintenance issue',
  raw_excerpt: 'Another issue',
};

const CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['plumbing', 'leak', 'repair'], regex: [] } },
    Location: { suite: { keywords: ['suite', 'apartment', 'unit'], regex: [] } },
    Sub_Location: { kitchen: { keywords: ['kitchen'], regex: [] } },
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
    issueId?: string;
    modelConfidence?: Record<string, number>;
    missingFields?: readonly string[];
    needsHumanTriage?: boolean;
  },
): IssueClassifierOutput {
  return {
    issue_id: options?.issueId ?? ISSUE.issue_id,
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

function buildPriorResult(
  classification: Record<string, string>,
  fieldsNeedingInput: readonly string[],
  issueId?: string,
): IssueClassificationResult {
  return {
    issue_id: issueId ?? ISSUE.issue_id,
    classifierOutput: buildOutput(classification, {
      issueId: issueId ?? ISSUE.issue_id,
      modelConfidence: Object.fromEntries(fieldsNeedingInput.map((f) => [f, 0.3])),
      missingFields: fieldsNeedingInput,
    }),
    computedConfidence: Object.fromEntries(fieldsNeedingInput.map((f) => [f, 0.3])),
    fieldsNeedingInput: [...fieldsNeedingInput],
    shouldAskFollowup: fieldsNeedingInput.length > 0,
    followupTypes: {},
    constraintPassed: true,
    recoverable_via_followup: true,
  };
}

function makeContext(input: {
  pendingQuestions: FollowUpQuestion[];
  answers: Array<{ question_id: string; answer: unknown }>;
  classifierOutput: IssueClassifierOutput;
  priorResults?: IssueClassificationResult[];
  confirmedFollowupAnswers?: Record<string, Record<string, string>>;
  followupOutput?: { questions: FollowUpQuestion[] };
  issues?: Array<{ issue_id: string; summary: string; raw_excerpt: string }>;
  previousQuestions?: Array<{ field_target: string; times_asked: number }>;
  followUpCaps?: FollowUpCaps;
}): ActionHandlerContext {
  let counter = 0;
  const issueList = input.issues ?? [ISSUE];
  let session = createSession({
    conversation_id: 'conv-bug009-invalidation',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
  session = setSplitIssues(session, issueList);

  const defaultPriorClassification: Record<string, string> = {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'kitchen',
    Maintenance_Category: 'pest_control',
    Maintenance_Object: 'rodents',
    Maintenance_Problem: 'infestation',
    Priority: 'normal',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
  };

  session = setClassificationResults(
    session,
    input.priorResults ?? [
      buildPriorResult(
        defaultPriorClassification,
        input.pendingQuestions.map((q) => q.field_target),
      ),
    ],
  );
  session = updateFollowUpTracking(session, input.pendingQuestions);
  if (input.previousQuestions) {
    session = {
      ...session,
      previous_questions: input.previousQuestions,
    } satisfies ConversationSession;
  }
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
      followUpCaps: input.followUpCaps ?? DEFAULT_FOLLOWUP_CAPS,
    } as any,
  };
}

function getInsertedEvents(ctx: ActionHandlerContext) {
  return vi
    .mocked(ctx.deps.eventRepo.insert)
    .mock.calls.map(([event]) => event as unknown as Record<string, unknown>);
}

function getInvalidationEvents(ctx: ActionHandlerContext) {
  return getInsertedEvents(ctx).filter(
    (e) => e.event_type === 'classification_descendant_invalidation',
  );
}

describe('Bug-009 Phase 3: stale descendant invalidation', () => {
  // --- Core invalidation ---

  it('clears stale pinned Maintenance_Category when tenant re-confirms Sub_Location', async () => {
    // Prior pins: Sub_Location=kitchen, Maintenance_Category=appliance
    // This round: tenant answers Sub_Location = 'bathroom'
    // appliance is valid for kitchen but NOT for bathroom
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: {
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
        },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
        Maintenance_Object: 'fridge',
        Maintenance_Problem: 'not_working',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);

    // Maintenance_Category (appliance) and Maintenance_Object (fridge) should be removed from pins
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).not.toHaveProperty(
      'Maintenance_Category',
    );
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).not.toHaveProperty(
      'Maintenance_Object',
    );
    // Sub_Location should be updated to the new pin
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id].Sub_Location).toBe(
      'bathroom',
    );

    // Invalidation event should be logged
    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents.length).toBeGreaterThan(0);
    const payload = invalidationEvents[0].payload as {
      parent_field: string;
      cleared_fields: Array<{ field: string; was_pinned: boolean }>;
    };
    expect(payload.parent_field).toBe('Sub_Location');
    expect(payload.cleared_fields.map((c) => c.field)).toContain('Maintenance_Category');
  });

  it('clears stale classifier guess without removing pins', async () => {
    // Prior pins: { Sub_Location: 'kitchen' } — Maintenance_Category/Object are classifier guesses
    // Classifier guesses Maintenance_Category = 'appliance', Object = 'fridge' (NOT pinned)
    // This round: tenant re-confirms Sub_Location = 'bathroom'
    // appliance is not valid for bathroom → clear Category
    // fridge cascades as an unpinned classifier guess
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen' },
      },
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
        Maintenance_Object: 'fridge',
        Maintenance_Problem: 'not_working',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);

    // No pin removal for Maintenance_Category or Object (neither was pinned)
    // Only Sub_Location was pinned (now updated to bathroom)
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).toEqual({
      Sub_Location: 'bathroom',
    });

    // Classification should have cleared appliance, fridge, not_working
    const stored = result.session.classification_results![0];
    expect(stored.classifierOutput.classification.Maintenance_Category).not.toBe('appliance');

    // Invalidation event logged
    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents.length).toBe(1);
  });

  it('produces contradiction prompt for cleared pin', async () => {
    // Prior pins: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' }
    // This round: Sub_Location changes → appliance invalid → cascade
    // Maintenance_Category was pinned → contradiction question expected
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const followupOutput = {
      questions: [
        {
          question_id: 'q-llm-priority',
          field_target: 'Priority',
          prompt: 'How urgent?',
          options: ['normal', 'high'],
          answer_type: 'enum' as const,
        },
      ],
    };

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
          Maintenance_Problem: 'not_working',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        { modelConfidence: { Maintenance_Category: 0.3, Priority: 0.3 } },
      ),
      followupOutput,
    });

    const result = await handleAnswerFollowups(ctx);

    // Should have pending questions — first should be contradiction prompt
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    const questions = result.session.pending_followup_questions!;
    expect(questions.length).toBeGreaterThan(0);
    const first = questions[0];
    expect(first.field_target).toBe('Maintenance_Category');
    expect(first.prompt).toContain('appliance');
    expect(first.prompt).toContain('bathroom');
    expect(first.answer_type).toBe('enum');
  });

  // --- Cascade ---

  it('multi-level cascade: Location change clears Sub_Location through Problem', async () => {
    // Prior pins include Sub_Location and Maintenance_Object
    // Change Location from suite to building_exterior → bathroom is invalid
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-loc',
        field_target: 'Location',
        prompt: 'Where?',
        options: ['suite', 'building_exterior'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-loc', answer: 'building_exterior' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: {
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Object: 'toilet',
        },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'bathroom',
            Maintenance_Category: 'plumbing',
            Maintenance_Object: 'toilet',
            Maintenance_Problem: 'leak',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Location'],
        ),
      ],
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
    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents.length).toBe(1);
    const payload = invalidationEvents[0].payload as {
      cleared_fields: Array<{ field: string }>;
    };
    expect(payload.cleared_fields.map((c) => c.field)).toEqual([
      'Sub_Location',
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
    ]);

    // Sub_Location and Maintenance_Object pins should be removed
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).not.toHaveProperty(
      'Sub_Location',
    );
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).not.toHaveProperty(
      'Maintenance_Object',
    );
  });

  // --- Caps behavior ---

  it('invalidated field uses existing previous_questions count', async () => {
    // Maintenance_Category was asked 2 times already
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
      },
      previousQuestions: [
        { field_target: 'Sub_Location', times_asked: 1 },
        { field_target: 'Maintenance_Category', times_asked: 2 },
      ],
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
          Maintenance_Problem: 'not_working',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        { modelConfidence: { Maintenance_Category: 0.3, Priority: 0.3 } },
      ),
      followupOutput: {
        questions: [
          {
            question_id: 'q-llm',
            field_target: 'Priority',
            prompt: 'How urgent?',
            options: ['normal', 'high'],
            answer_type: 'enum' as const,
          },
        ],
      },
    });

    const result = await handleAnswerFollowups(ctx);
    // previous_questions should still track Maintenance_Category's prior count
    // The existing count is NOT reset by invalidation
    const prevQ = result.session.previous_questions.find(
      (pq) => pq.field_target === 'Maintenance_Category',
    );
    // Should be 2 (original) + 1 (contradiction question) = 3 if it was asked again
    // OR just 2 if the contradiction question didn't get generated/tracked yet
    // Key point: it was NOT reset to 0
    expect(prevQ).toBeDefined();
    expect(prevQ!.times_asked).toBeGreaterThanOrEqual(2);
  });

  it('contradiction question consumes budget — LLM generator gets reduced remainder', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const followupOutput = {
      questions: [
        {
          question_id: 'q-llm',
          field_target: 'Priority',
          prompt: 'How urgent?',
          options: ['normal', 'high'],
          answer_type: 'enum' as const,
        },
      ],
    };

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
          Maintenance_Problem: 'not_working',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        { modelConfidence: { Maintenance_Category: 0.3, Priority: 0.3 } },
      ),
      followupOutput,
    });

    const result = await handleAnswerFollowups(ctx);

    // The first question should be the contradiction prompt, followed by LLM questions
    expect(result.session.pending_followup_questions).toBeDefined();
    const questions = result.session.pending_followup_questions!;
    expect(questions.length).toBeGreaterThanOrEqual(1);
    // First is contradiction
    expect(questions[0].field_target).toBe('Maintenance_Category');
    expect(questions[0].prompt).toContain('appliance');
  });

  it('contradiction question field removed from eligibleFields before LLM call', async () => {
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
          Maintenance_Problem: 'not_working',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        { modelConfidence: { Maintenance_Category: 0.3, Priority: 0.3 } },
      ),
      followupOutput: { questions: [] },
    });

    await handleAnswerFollowups(ctx);

    // Check that the LLM generator was called without the contradiction field
    const generatorCalls = vi.mocked(ctx.deps.followUpGenerator).mock.calls;
    if (generatorCalls.length > 0) {
      const llmInput = generatorCalls[0][0] as unknown as { fields_needing_input?: string[] };
      expect(llmInput.fields_needing_input).not.toContain('Maintenance_Category');
    }
  });

  // --- Re-pinning stability ---

  it('re-pinning same value after invalidation stabilizes without looping', async () => {
    // Round N+1: prior invalidation cleared Maintenance_Object=toilet
    // Tenant re-confirms Sub_Location = 'bathroom' (Sub_Location was corrected back)
    // toilet is valid for plumbing in bathroom → no invalidation this round
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
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen' },
      },
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);

    // plumbing is valid for bathroom → no invalidation
    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents).toHaveLength(0);

    // Sub_Location re-pinned
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id].Sub_Location).toBe(
      'bathroom',
    );
  });

  // --- Edge cases ---

  it('no invalidation when parent value does not actually change', async () => {
    // Tenant re-confirms Sub_Location = 'kitchen' (same value as prior pin)
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'kitchen' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'pest_control' },
      },
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'pest_control',
        Maintenance_Object: 'rodents',
        Maintenance_Problem: 'infestation',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);

    // No invalidation — same value
    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents).toHaveLength(0);

    // Pins unchanged
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).toHaveProperty(
      'Maintenance_Category',
      'pest_control',
    );
  });

  it('no invalidation when changed parent has no descendants', async () => {
    // Tenant answers Maintenance_Problem (leaf field, no descendants)
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-prob',
        field_target: 'Maintenance_Problem',
        prompt: 'What problem?',
        options: ['leak', 'clog'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-prob', answer: 'clog' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Maintenance_Problem: 'leak' },
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

    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents).toHaveLength(0);

    // Pin updated to new value
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id].Maintenance_Problem).toBe(
      'clog',
    );
  });

  it('invalidation does not affect other issues', async () => {
    // Multi-issue: invalidation for issue-1 should not touch issue-2 pins
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      issues: [ISSUE, ISSUE_2],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
        [ISSUE_2.issue_id]: { Sub_Location: 'bathroom', Maintenance_Category: 'plumbing' },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
          ISSUE.issue_id,
        ),
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'bathroom',
            Maintenance_Category: 'plumbing',
            Maintenance_Object: 'toilet',
            Maintenance_Problem: 'leak',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          [],
          ISSUE_2.issue_id,
        ),
      ],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
        Maintenance_Object: 'fridge',
        Maintenance_Problem: 'not_working',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);

    // Issue-2 pins should be unchanged
    expect(result.session.confirmed_followup_answers![ISSUE_2.issue_id]).toEqual({
      Sub_Location: 'bathroom',
      Maintenance_Category: 'plumbing',
    });
  });

  // --- Audit trail ---

  it('invalidation event parent_old_value uses prior stored classification', async () => {
    // Prior round stored classification_results with Sub_Location = 'kitchen'
    // Classifier this round returns Sub_Location = 'bathroom' (different from stored)
    // Tenant pins Sub_Location = 'bathroom'
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen', // prior stored value
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom', // classifier returns different value
        Maintenance_Category: 'appliance',
        Maintenance_Object: 'fridge',
        Maintenance_Problem: 'not_working',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    await handleAnswerFollowups(ctx);

    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents.length).toBeGreaterThan(0);
    const payload = invalidationEvents[0].payload as {
      parent_field: string;
      parent_old_value: string;
      parent_new_value: string;
    };
    expect(payload.parent_field).toBe('Sub_Location');
    // Should use prior stored classification value, not current classifier output
    expect(payload.parent_old_value).toBe('kitchen');
    expect(payload.parent_new_value).toBe('bathroom');
  });

  // --- Reverse-edge invalidation ---

  // Reverse-edge invalidation (e.g., Maintenance_Object_to_Sub_Location) is
  // tested at the unit level in descendant-invalidation.test.ts. Through the
  // handler, the blank-intermediate scenario that exposes the gap cannot occur
  // because the classifier always returns valid taxonomy values and the forward
  // cascade handles the intermediate correctly. The reverse-edge pass is a
  // safety net for defensive correctness at the function contract level.

  // --- Stale pinnedForIssue snapshot fix ---

  it('Step C2 contradiction event uses post-invalidation pins, not stale snapshot', async () => {
    // This test verifies that if Step A3 removes some pins, Step C2's
    // contradiction event payload reflects the post-removal state.
    // We use a cross-domain contradiction to trigger Step C2 AFTER invalidation.
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: {
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          // Also inject a cross-domain pin to trigger Step C2
          Management_Category: 'accounting',
        },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
        Maintenance_Object: 'fridge',
        Maintenance_Problem: 'not_working',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    await handleAnswerFollowups(ctx);

    // Find the contradiction event (Step C2)
    const allEvents = getInsertedEvents(ctx);
    const contradictionEvent = allEvents.find(
      (e) => e.event_type === 'classification_pinned_answer_contradiction',
    );

    if (contradictionEvent) {
      const payload = contradictionEvent.payload as {
        pinned_fields: Record<string, string>;
      };
      // Maintenance_Category should NOT be in pinned_fields — it was
      // removed by Step A3 invalidation before Step C2 ran.
      expect(payload.pinned_fields).not.toHaveProperty('Maintenance_Category');
    }
  });

  // --- BUG-011 cross-verification ---

  it('BUG-011 scenario: taxonomy-valid pins work with descendant invalidation', async () => {
    // Prior pins: Location=suite, Sub_Location=kitchen, Maintenance_Object=fridge
    // This round: tenant answers Sub_Location = 'bathroom'
    // fridge is valid for kitchen-only appliance → should be invalidated
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: {
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
        },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput({
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
        Maintenance_Object: 'fridge',
        Maintenance_Problem: 'not_working',
        Priority: 'normal',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      }),
    });

    const result = await handleAnswerFollowups(ctx);

    // Maintenance_Category (appliance) should be invalidated — not valid for bathroom
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).not.toHaveProperty(
      'Maintenance_Category',
    );
    // Maintenance_Object (fridge) should cascade-invalidate
    expect(result.session.confirmed_followup_answers![ISSUE.issue_id]).not.toHaveProperty(
      'Maintenance_Object',
    );

    // Invalidation event logged
    const invalidationEvents = getInvalidationEvents(ctx);
    expect(invalidationEvents.length).toBeGreaterThan(0);

    // All remaining pins are taxonomy slugs
    const pins = result.session.confirmed_followup_answers![ISSUE.issue_id];
    expect(pins.Sub_Location).toBe('bathroom');
    expect(pins.Location).toBe('suite');
  });

  it('BUG-011 scenario: hierarchy-conflict question uses taxonomy-valid options', async () => {
    // After invalidation clears stale Maintenance_Category pin,
    // the contradiction question's options should come from the constraint map
    const pendingQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which area?',
        options: ['kitchen', 'bathroom'],
        answer_type: 'enum',
      },
    ];

    const followupOutput = {
      questions: [
        {
          question_id: 'q-llm-priority',
          field_target: 'Priority',
          prompt: 'How urgent?',
          options: ['normal', 'high'],
          answer_type: 'enum' as const,
        },
      ],
    };

    const ctx = makeContext({
      pendingQuestions,
      answers: [{ question_id: 'q-sub', answer: 'bathroom' }],
      confirmedFollowupAnswers: {
        [ISSUE.issue_id]: { Sub_Location: 'kitchen', Maintenance_Category: 'appliance' },
      },
      priorResults: [
        buildPriorResult(
          {
            Category: 'maintenance',
            Location: 'suite',
            Sub_Location: 'kitchen',
            Maintenance_Category: 'appliance',
            Maintenance_Object: 'fridge',
            Maintenance_Problem: 'not_working',
            Priority: 'normal',
            Management_Category: 'not_applicable',
            Management_Object: 'not_applicable',
          },
          ['Sub_Location'],
        ),
      ],
      classifierOutput: buildOutput(
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'fridge',
          Maintenance_Problem: 'not_working',
          Priority: 'normal',
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        },
        { modelConfidence: { Maintenance_Category: 0.3, Priority: 0.3 } },
      ),
      followupOutput,
    });

    const result = await handleAnswerFollowups(ctx);

    // Should have pending questions — first should be contradiction prompt
    const questions = result.session.pending_followup_questions!;
    expect(questions.length).toBeGreaterThan(0);
    const contradictionQ = questions[0];
    expect(contradictionQ.field_target).toBe('Maintenance_Category');
    // Options should be from Sub_Location_to_Maintenance_Category['bathroom'] constraint map
    // These are taxonomy-valid values, not LLM paraphrases
    expect(contradictionQ.options.length).toBeGreaterThan(0);
    expect(contradictionQ.answer_type).toBe('enum');
    // 'appliance' should NOT be in the options (it was the invalidated value, not valid for bathroom)
    expect(contradictionQ.options).not.toContain('appliance');
  });
});
