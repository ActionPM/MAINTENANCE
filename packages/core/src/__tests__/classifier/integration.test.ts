import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import type { SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

const taxonomy = loadTaxonomy();

const VALID_CLASSIFICATION: IssueClassifierOutput = {
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
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.85,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.88,
    Management_Category: 0.95,
    Management_Object: 0.95,
    Priority: 0.9,
  },
  missing_fields: [],
  needs_human_triage: false,
};

/**
 * Cue dictionary covering all fields in VALID_CLASSIFICATION so that
 * cue_strength = 1.0 for every field (2+ keyword hits each), pushing
 * confidence into the high band (>= 0.85) where no follow-up is needed.
 * Spec §14.3: medium-confidence required/risk-relevant fields now
 * trigger prompts, so we need cue_strength high enough to clear the threshold.
 */
const FULL_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['leak', 'leaking'], regex: [] } },
    Location: { suite: { keywords: ['toilet', 'my'], regex: [] } },
    Sub_Location: { bathroom: { keywords: ['toilet', 'leaking'], regex: [] } },
    Maintenance_Category: { plumbing: { keywords: ['leak', 'toilet'], regex: [] } },
    Maintenance_Object: { toilet: { keywords: ['toilet', 'leaking'], regex: [] } },
    Maintenance_Problem: { leak: { keywords: ['leak', 'leaking'], regex: [] } },
    Management_Category: { other_mgmt_cat: { keywords: ['toilet', 'my'], regex: [] } },
    Management_Object: { other_mgmt_obj: { keywords: ['toilet', 'my'], regex: [] } },
    Priority: { normal: { keywords: ['leak', 'toilet'], regex: [] } },
  },
};

const AUTH = {
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  authorized_unit_ids: ['u1'],
};

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) {
    this.sessions.set(session.conversation_id, session);
  }
}

function makeDeps(overrides?: {
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  splitterFn?: (...args: unknown[]) => Promise<unknown>;
  cueDict?: CueDictionary;
}) {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-02-24T12:00:00Z',
    issueSplitter:
      overrides?.splitterFn ??
      vi.fn().mockResolvedValue({
        issues: [
          { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
        ],
        issue_count: 1,
      }),
    issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
    followUpGenerator: vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Priority',
          prompt: 'How urgent?',
          options: ['low', 'high'],
          answer_type: 'enum',
        },
      ],
    }),
    cueDict: overrides?.cueDict ?? FULL_CUES,
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
    riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
    escalationPlans: { version: '1.0.0', plans: [] },
    contactExecutor: vi.fn().mockResolvedValue(false),
  };
}

/**
 * Walk the conversation from creation through to split confirmed (which auto-chains
 * to classification via the dispatcher's AUTO_FIRE_MAP).
 */
async function walkToClassified(dispatch: ReturnType<typeof createDispatcher>, auth = AUTH) {
  const r1 = await dispatch({
    conversation_id: null,
    action_type: ActionType.CREATE_CONVERSATION,
    actor: ActorType.TENANT,
    tenant_input: {},
    auth_context: auth,
  });
  const convId = r1.response.conversation_snapshot.conversation_id;

  await dispatch({
    conversation_id: convId,
    action_type: ActionType.SELECT_UNIT,
    actor: ActorType.TENANT,
    tenant_input: { unit_id: 'u1' },
    auth_context: auth,
  });

  await dispatch({
    conversation_id: convId,
    action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
    actor: ActorType.TENANT,
    tenant_input: { message: 'My toilet is leaking' },
    auth_context: auth,
  });

  const r4 = await dispatch({
    conversation_id: convId,
    action_type: ActionType.CONFIRM_SPLIT,
    actor: ActorType.TENANT,
    tenant_input: {},
    auth_context: auth,
  });

  return { convId, result: r4 };
}

describe('Classification integration', () => {
  // ---------------------------------------------------------------
  // 1. Happy path: single issue, medium-confidence required fields trigger follow-up
  // ---------------------------------------------------------------
  it('happy path: single issue with medium-confidence required fields reaches needs_tenant_input', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    const { result } = await walkToClassified(dispatch);

    // Confidence formula max WITHOUT constraint_implied is 0.84 (< high_threshold 0.85),
    // so required/risk-relevant fields are medium-confidence and trigger needs_tenant_input (spec §14.3).
    expect(result.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.response.conversation_snapshot.classification_results).toBeDefined();
    expect(result.response.conversation_snapshot.classification_results!.length).toBe(1);

    const cr = result.response.conversation_snapshot.classification_results![0] as any;
    expect(cr.issue_id).toBe('i1');
    expect(cr.classifierOutput.classification.Category).toBe('maintenance');
    expect(cr.fieldsNeedingInput.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // 2. Multi-issue: two issues classified independently, both stored
  // ---------------------------------------------------------------
  it('multi-issue: two issues are classified independently and both stored', async () => {
    let classifyCallCount = 0;
    const multiIssueSplitter = vi.fn().mockResolvedValue({
      issues: [
        { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
        {
          issue_id: 'i2',
          summary: 'Toilet clogged',
          raw_excerpt: 'My toilet is clogged and leaking',
        },
      ],
      issue_count: 2,
    });

    const multiIssueClassifier = vi.fn().mockImplementation(async () => {
      classifyCallCount++;
      return {
        ...VALID_CLASSIFICATION,
        issue_id: `i${classifyCallCount}`,
      };
    });

    const deps = makeDeps({
      splitterFn: multiIssueSplitter,
      classifierFn: multiIssueClassifier,
    });
    const dispatch = createDispatcher(deps as any);

    const { result } = await walkToClassified(dispatch);

    // Medium-confidence required fields trigger needs_tenant_input (spec §14.3)
    expect(result.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);

    const classResults = result.response.conversation_snapshot.classification_results!;
    expect(classResults.length).toBe(2);
    expect(classResults[0].issue_id).toBe('i1');
    expect(classResults[1].issue_id).toBe('i2');

    // Classifier should have been called once per issue
    expect(multiIssueClassifier).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------
  // 3. Low confidence fields trigger needs_tenant_input
  // ---------------------------------------------------------------
  it('low confidence fields trigger needs_tenant_input when cue dictionary has no entries', async () => {
    // Without cue dictionary support, even high model confidence only reaches
    // conf = 0 + 0.25 + 0.19 = 0.44 (low band), triggering follow-up.
    const emptyCues: CueDictionary = { version: '1.0.0', fields: {} };
    const deps = makeDeps({
      classifierFn: vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
      cueDict: emptyCues,
    });
    const dispatch = createDispatcher(deps as any);

    const { result } = await walkToClassified(dispatch);

    expect(result.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);

    const classResults = result.response.conversation_snapshot.classification_results! as any[];
    expect(classResults.length).toBe(1);
    expect(classResults[0].fieldsNeedingInput.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // 4. Category gating retry resolves contradiction
  // ---------------------------------------------------------------
  it('category gating retry resolves contradiction on second call', async () => {
    // First call returns a contradictory classification: maintenance category
    // with populated management fields (accounting, rent_charges) that are valid
    // taxonomy values but violate category gating (spec §5.3).
    // The callIssueClassifier pipeline passes schema + taxonomy value validation
    // in Phase 1, then detects the cross-domain contradiction in Phase 2
    // and retries with a domain_constraint hint. The second call returns clean output.
    const contradictoryOutput: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      classification: {
        ...VALID_CLASSIFICATION.classification,
        Category: 'maintenance',
        Management_Category: 'accounting', // valid value but contradicts maintenance category
        Management_Object: 'rent_charges', // valid value but contradicts maintenance category
      },
    };

    const cleanOutput: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
    };

    let callCount = 0;
    const classifierFn = vi
      .fn()
      .mockImplementation(async (_input: unknown, _retryCtx?: unknown) => {
        callCount++;
        // First call: contradictory; gating retry: clean
        if (callCount === 1) return contradictoryOutput;
        return cleanOutput;
      });

    const deps = makeDeps({ classifierFn });
    const dispatch = createDispatcher(deps as any);

    const { result } = await walkToClassified(dispatch);

    // After retry, fields are still medium-confidence (no constraint_implied),
    // so required/risk-relevant fields trigger needs_tenant_input (spec §14.3).
    expect(result.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);

    // The classifier should have been called twice: original + gating retry
    expect(classifierFn).toHaveBeenCalledTimes(2);

    // Verify the retry was called with the domain_constraint context
    const secondCall = classifierFn.mock.calls[1];
    expect(secondCall[1]).toBeDefined();
    expect(secondCall[1].retryHint).toBe('domain_constraint');
  });

  // ---------------------------------------------------------------
  // 5. LLM failure transitions to llm_error_retryable
  // ---------------------------------------------------------------
  it('LLM failure transitions to llm_error_retryable', async () => {
    const deps = makeDeps({
      classifierFn: vi.fn().mockRejectedValue(new Error('LLM service unavailable')),
    });
    const dispatch = createDispatcher(deps as any);

    const { result } = await walkToClassified(dispatch);

    expect(result.response.conversation_snapshot.state).toBe(ConversationState.LLM_ERROR_RETRYABLE);
    expect(result.response.errors.length).toBeGreaterThan(0);
    expect(result.response.errors[0].code).toBe('CLASSIFIER_FAILED');
  });

  // ---------------------------------------------------------------
  // 6. Re-classification after ANSWER_FOLLOWUPS
  // ---------------------------------------------------------------
  it('re-classification after ANSWER_FOLLOWUPS walks from needs_tenant_input to tenant_confirmation_pending', async () => {
    // Step 1: Initial classification reports missing_fields -> needs_tenant_input
    // Step 2: Re-classification after followup has no missing_fields -> tenant_confirmation_pending
    const classificationWithMissing: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      missing_fields: ['Priority', 'Location'],
    };

    let callCount = 0;
    const classifierFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) {
        // First classification: missing fields trigger needs_tenant_input
        return classificationWithMissing;
      }
      // Re-classification after followup: complete, no missing fields
      return VALID_CLASSIFICATION;
    });

    const deps = makeDeps({ classifierFn });
    // Override followUpGenerator to return questions matching the missing fields
    deps.followUpGenerator = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q-priority',
          field_target: 'Priority',
          prompt: 'How urgent?',
          options: ['low', 'normal', 'high'],
          answer_type: 'enum',
        },
        {
          question_id: 'q-location',
          field_target: 'Location',
          prompt: 'Where?',
          options: ['suite', 'common_area'],
          answer_type: 'enum',
        },
      ],
    });
    const dispatch = createDispatcher(deps as any);

    // Walk to classified (should land in needs_tenant_input due to missing_fields)
    const { convId, result: classResult } = await walkToClassified(dispatch);

    expect(classResult.response.conversation_snapshot.state).toBe(
      ConversationState.NEEDS_TENANT_INPUT,
    );

    // Step 2: Dispatch ANSWER_FOLLOWUPS with tenant answers (question_ids must match pending questions)
    const followupResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.ANSWER_FOLLOWUPS,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [
          { question_id: 'q-priority', answer: 'normal' },
          { question_id: 'q-location', answer: 'suite' },
        ],
      },
      auth_context: AUTH,
    });

    // Should now be in tenant_confirmation_pending
    expect(followupResult.response.conversation_snapshot.state).toBe(
      ConversationState.TENANT_CONFIRMATION_PENDING,
    );

    // Classification results should be updated
    const newResults = followupResult.response.conversation_snapshot.classification_results!;
    expect(newResults.length).toBe(1);
    expect(newResults[0].fieldsNeedingInput).toEqual([]);
  });

  // ---------------------------------------------------------------
  // 7. Event recording verification
  // ---------------------------------------------------------------
  it('records classification events with proper data through the full flow', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    const { convId } = await walkToClassified(dispatch);

    const events = await deps.eventRepo.query({ conversation_id: convId });

    // Expected event sequence:
    // 0. CREATE_CONVERSATION -> intake_started
    // 1. SELECT_UNIT -> unit_selected
    // 2. SUBMIT_INITIAL_MESSAGE -> split_in_progress (intermediate)
    // 3. LLM_SPLIT_SUCCESS -> split_proposed
    // 4. CONFIRM_SPLIT -> split_finalized
    // 5. START_CLASSIFICATION -> classification_in_progress (intermediate)
    // 6. LLM_CLASSIFY_SUCCESS -> needs_tenant_input (medium-confidence required fields)
    expect(events.length).toBe(7);

    // Verify CREATE_CONVERSATION event
    expect(events[0].action_type).toBe(ActionType.CREATE_CONVERSATION);
    expect(events[0].prior_state).toBeNull();
    expect(events[0].new_state).toBe(ConversationState.INTAKE_STARTED);

    // Verify SELECT_UNIT event
    expect(events[1].action_type).toBe(ActionType.SELECT_UNIT);
    expect(events[1].prior_state).toBe(ConversationState.INTAKE_STARTED);
    expect(events[1].new_state).toBe(ConversationState.UNIT_SELECTED);

    // Verify SUBMIT_INITIAL_MESSAGE -> split_in_progress (intermediate)
    expect(events[2].action_type).toBe(ActionType.SUBMIT_INITIAL_MESSAGE);
    expect(events[2].prior_state).toBe(ConversationState.UNIT_SELECTED);
    expect(events[2].new_state).toBe(ConversationState.SPLIT_IN_PROGRESS);

    // Verify LLM_SPLIT_SUCCESS -> split_proposed
    expect(events[3].action_type).toBe(SystemEvent.LLM_SPLIT_SUCCESS);
    expect(events[3].prior_state).toBe(ConversationState.SPLIT_IN_PROGRESS);
    expect(events[3].new_state).toBe(ConversationState.SPLIT_PROPOSED);

    // Verify CONFIRM_SPLIT -> split_finalized
    expect(events[4].action_type).toBe(ActionType.CONFIRM_SPLIT);
    expect(events[4].prior_state).toBe(ConversationState.SPLIT_PROPOSED);
    expect(events[4].new_state).toBe(ConversationState.SPLIT_FINALIZED);

    // Verify START_CLASSIFICATION -> classification_in_progress (intermediate)
    expect(events[5].action_type).toBe(SystemEvent.START_CLASSIFICATION);
    expect(events[5].prior_state).toBe(ConversationState.SPLIT_FINALIZED);
    expect(events[5].new_state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
    expect(events[5].payload).toBeDefined();
    expect((events[5].payload as any).issue_count).toBe(1);

    // Verify LLM_CLASSIFY_SUCCESS -> needs_tenant_input (medium-confidence required fields)
    expect(events[6].action_type).toBe(SystemEvent.LLM_CLASSIFY_SUCCESS);
    expect(events[6].prior_state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
    expect(events[6].new_state).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(events[6].payload).toBeDefined();

    // Verify the classification results payload contains expected data
    const classPayload = events[6].payload as any;
    expect(classPayload.classification_results).toBeDefined();
    expect(classPayload.classification_results.length).toBe(1);
    expect(classPayload.classification_results[0].issue_id).toBe('i1');
    expect(classPayload.classification_results[0].classification.Category).toBe('maintenance');
    expect(classPayload.classification_results[0].computed_confidence).toBeDefined();

    // All events should have the same conversation_id
    for (const event of events) {
      expect(event.conversation_id).toBe(convId);
    }

    // All events should have unique event_ids
    const eventIds = events.map((e) => e.event_id);
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });
});
