import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import {
  ActionType,
  ActorType,
  ConversationState,
  DEFAULT_FOLLOWUP_CAPS,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import type { SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const HIGH_CONF_CLASSIFICATION: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance', Location: 'suite', Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing', Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak', Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj', Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95, Location: 0.9, Sub_Location: 0.85,
    Maintenance_Category: 0.95, Maintenance_Object: 0.95,
    Maintenance_Problem: 0.95, Management_Category: 0.95,
    Management_Object: 0.95, Priority: 0.95,
  },
  missing_fields: [],
  needs_human_triage: false,
};

/**
 * Classification with Priority reported as missing — this forces follow-up
 * generation because missing_fields always flag as needing input (spec §14.3).
 */
const MISSING_PRIORITY_CLASSIFICATION: IssueClassifierOutput = {
  ...HIGH_CONF_CLASSIFICATION,
  missing_fields: ['Priority'],
};

/**
 * Classification with low Priority model confidence AND no cue support.
 * Used with CUES_EXCEPT_PRIORITY to keep Priority in the low confidence band.
 */
const LOW_PRIORITY_CLASSIFICATION: IssueClassifierOutput = {
  ...HIGH_CONF_CLASSIFICATION,
  model_confidence: {
    ...HIGH_CONF_CLASSIFICATION.model_confidence,
    Priority: 0.3,
  },
};

/**
 * Cues covering all fields EXCEPT Priority so:
 * - Well-classified fields (high model_confidence + cue support) → medium band → resolved
 * - Priority (low model_confidence + no cue support) → low band → needs follow-up
 */
const CUES_EXCEPT_PRIORITY: CueDictionary = {
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
    // Priority deliberately omitted — no cue support keeps it in low confidence band
  },
};

/**
 * Full cues covering ALL fields including Priority.
 * Used for the re-classification response (HIGH_CONF_CLASSIFICATION) where
 * Priority has high model confidence + full cue support → resolves.
 */
const FULL_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    ...CUES_EXCEPT_PRIORITY.fields,
    Priority: { normal: { keywords: ['leak'], regex: [] } },
  },
};

const AUTH = {
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  authorized_unit_ids: ['u1'],
};

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

function makeDeps(overrides?: {
  classifierResponses?: IssueClassifierOutput[];
  cueDict?: CueDictionary;
}) {
  let counter = 0;
  let classifierCallCount = 0;
  const classifierResponses = overrides?.classifierResponses ?? [
    MISSING_PRIORITY_CLASSIFICATION,  // First classification: missing Priority → follow-up
    HIGH_CONF_CLASSIFICATION,         // Re-classification after follow-up: complete
  ];

  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-02-25T12:00:00.000Z',
    issueSplitter: vi.fn().mockResolvedValue({
      issues: [{ issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' }],
      issue_count: 1,
    }),
    issueClassifier: vi.fn().mockImplementation(async () => {
      return classifierResponses[classifierCallCount++] ?? HIGH_CONF_CLASSIFICATION;
    }),
    followUpGenerator: vi.fn().mockResolvedValue({
      questions: [{
        question_id: 'q1',
        field_target: 'Priority',
        prompt: 'How urgent is this?',
        options: ['low', 'normal', 'high', 'emergency'],
        answer_type: 'enum',
      }],
    }),
    cueDict: overrides?.cueDict ?? FULL_CUES,
    taxonomy,
    followUpCaps: DEFAULT_FOLLOWUP_CAPS,
  };
}

/**
 * Walk the conversation to the point where classification has run
 * and the system is waiting for follow-ups (needs_tenant_input).
 */
async function walkToFollowUp(dispatch: ReturnType<typeof createDispatcher>) {
  const r1 = await dispatch({
    conversation_id: null, action_type: ActionType.CREATE_CONVERSATION,
    actor: ActorType.TENANT, tenant_input: {}, auth_context: AUTH,
  });
  const convId = r1.response.conversation_snapshot.conversation_id;

  await dispatch({
    conversation_id: convId, action_type: ActionType.SELECT_UNIT,
    actor: ActorType.TENANT, tenant_input: { unit_id: 'u1' }, auth_context: AUTH,
  });
  await dispatch({
    conversation_id: convId, action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
    actor: ActorType.TENANT, tenant_input: { message: 'My toilet is leaking' }, auth_context: AUTH,
  });

  const r4 = await dispatch({
    conversation_id: convId, action_type: ActionType.CONFIRM_SPLIT,
    actor: ActorType.TENANT, tenant_input: {}, auth_context: AUTH,
  });

  return { convId, result: r4 };
}

describe('Follow-up loop integration', () => {
  it('happy path: classify → follow-up → answer → re-classify → confirm', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    const { convId, result: classResult } = await walkToFollowUp(dispatch);

    // Should be in needs_tenant_input with follow-up questions pending
    expect(classResult.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(classResult.response.conversation_snapshot.pending_followup_questions).toBeDefined();
    expect(classResult.response.conversation_snapshot.pending_followup_questions!.length).toBeGreaterThan(0);

    // Answer follow-up → re-classify → tenant_confirmation_pending
    const r5 = await dispatch({
      conversation_id: convId, action_type: ActionType.ANSWER_FOLLOWUPS,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [{ question_id: 'q1', answer: 'normal' }],
      },
      auth_context: AUTH,
    });

    expect(r5.response.conversation_snapshot.state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);

    // Classification results should be present and fully resolved
    const results = r5.response.conversation_snapshot.classification_results!;
    expect(results.length).toBe(1);
    expect(results[0].fieldsNeedingInput).toEqual([]);
  });

  it('escape hatch: caps exhausted after multiple turns', async () => {
    // Classifier always returns missing Priority — never resolves.
    // Using FULL_CUES so other fields are fine, only Priority triggers follow-up.
    const deps = makeDeps({
      classifierResponses: Array(20).fill(MISSING_PRIORITY_CLASSIFICATION),
    });
    const dispatch = createDispatcher(deps as any);

    const { convId, result: classResult } = await walkToFollowUp(dispatch);
    expect(classResult.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);

    // Keep answering follow-ups until escape hatch triggers
    let state: string = ConversationState.NEEDS_TENANT_INPUT;
    let rounds = 0;
    const maxRounds = 15; // Safety: should escape well before this

    while (state === ConversationState.NEEDS_TENANT_INPUT && rounds < maxRounds) {
      const r = await dispatch({
        conversation_id: convId, action_type: ActionType.ANSWER_FOLLOWUPS,
        actor: ActorType.TENANT,
        tenant_input: {
          // Always answer with q1 (matching the pending question)
          answers: [{ question_id: 'q1', answer: 'normal' }],
        },
        auth_context: AUTH,
      });
      state = r.response.conversation_snapshot.state;
      rounds++;
    }

    // Should have escaped to confirmation (not stuck in infinite loop)
    expect(state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    // Should not exceed max_turns (the re-ask limit for Priority will fire at turn 2-3)
    expect(rounds).toBeLessThanOrEqual(DEFAULT_FOLLOWUP_CAPS.max_turns);
  });

  it('records followup_events in the event store', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    const { convId, result: classResult } = await walkToFollowUp(dispatch);
    expect(classResult.response.conversation_snapshot.state).toBe(ConversationState.NEEDS_TENANT_INPUT);

    // Answer follow-up
    await dispatch({
      conversation_id: convId, action_type: ActionType.ANSWER_FOLLOWUPS,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [{ question_id: 'q1', answer: 'normal' }],
      },
      auth_context: AUTH,
    });

    // The event store should contain followup_events
    // (questions-asked event from initial classification + answers event from ANSWER_FOLLOWUPS)
    const allEvents = await deps.eventRepo.queryAll(convId);
    const followupEvents = allEvents.filter(
      (e) => 'questions_asked' in e,
    );
    expect(followupEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('session tracks follow-up turn progression', async () => {
    const deps = makeDeps({
      // Always missing Priority to force multiple follow-up rounds
      classifierResponses: Array(10).fill(MISSING_PRIORITY_CLASSIFICATION),
    });
    const dispatch = createDispatcher(deps as any);

    const { convId } = await walkToFollowUp(dispatch);

    // Answer first round
    await dispatch({
      conversation_id: convId, action_type: ActionType.ANSWER_FOLLOWUPS,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [{ question_id: 'q1', answer: 'normal' }],
      },
      auth_context: AUTH,
    });

    // Read internal session from the session store to verify tracking fields
    const session = await deps.sessionStore.get(convId);
    expect(session).not.toBeNull();
    // After initial classification (turn 1) + answer round (turn 2):
    expect(session!.followup_turn_number).toBeGreaterThanOrEqual(2);
    expect(session!.total_questions_asked).toBeGreaterThanOrEqual(2);
    // previous_questions tracks unique fields — Priority was asked 2+ times
    expect(session!.previous_questions.length).toBeGreaterThanOrEqual(1);
    const priorityEntry = session!.previous_questions.find(p => p.field_target === 'Priority');
    expect(priorityEntry).toBeDefined();
    expect(priorityEntry!.times_asked).toBeGreaterThanOrEqual(2);
  });
});
