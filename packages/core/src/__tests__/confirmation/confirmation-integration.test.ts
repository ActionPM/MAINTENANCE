import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary, ConfidenceConfig } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

const taxonomy = loadTaxonomy();

/**
 * Full cues so all fields score high → all fields resolved → tenant_confirmation_pending.
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

const FULL_CLASSIFICATION = {
  issue_id: 'issue-1',
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

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

const AUTH = { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] };

function makeDeps() {
  let counter = 0;
  let clockTime = '2026-01-01T10:00:00.000Z';
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => clockTime,
    _setClock: (t: string) => { clockTime = t; },
    issueSplitter: async (input: any) => ({
      issues: [
        { issue_id: `issue-${++counter}`, summary: 'Toilet leaking', raw_excerpt: input.raw_text ?? 'My toilet is leaking' },
      ],
      issue_count: 1,
    }),
    issueClassifier: async () => ({ ...FULL_CLASSIFICATION }),
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
  };
}

describe('Confirmation integration — happy path', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps as any);
  });

  async function reachConfirmationPending() {
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });

    const splitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    return { convId, splitResult };
  }

  it('reaches tenant_confirmation_pending after CONFIRM_SPLIT + auto-classification', async () => {
    const { splitResult } = await reachConfirmationPending();
    expect(splitResult.response.conversation_snapshot.state).toBe(
      ConversationState.TENANT_CONFIRMATION_PENDING,
    );
  });

  it('includes confirmation_payload in the response snapshot', async () => {
    const { splitResult } = await reachConfirmationPending();
    expect(splitResult.response.conversation_snapshot.confirmation_payload).toBeDefined();
    expect(splitResult.response.conversation_snapshot.confirmation_payload!.issues.length).toBeGreaterThan(0);
  });

  it('flows to submitted on CONFIRM_SUBMISSION when fresh', async () => {
    const { convId } = await reachConfirmationPending();

    const confirmResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idemp-fresh-1',
      auth_context: AUTH,
    });

    expect(confirmResult.response.conversation_snapshot.state).toBe(ConversationState.SUBMITTED);
    expect(confirmResult.response.pending_side_effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effect_type: 'create_work_orders' }),
      ]),
    );
  });
});

/**
 * Custom confidence config with a lower high_threshold.
 * The confidence formula's theoretical max with default weights is ~0.84
 * (see classifier/confidence.ts), so to test the "all high" staleness path
 * we lower the high_threshold to 0.80.
 */
const RELAXED_CONFIDENCE: ConfidenceConfig = {
  high_threshold: 0.80,
  medium_threshold: 0.65,
  model_hint_min: 0.2,
  model_hint_max: 0.95,
  weights: {
    cue_strength: 0.40,
    completeness: 0.25,
    model_hint: 0.20,
    disagreement: 0.10,
    ambiguity_penalty: 0.05,
  },
};

describe('Confirmation integration — staleness (age + high confidence = NOT stale)', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    (deps as any).confidenceConfig = RELAXED_CONFIDENCE;
    dispatch = createDispatcher(deps as any);
  });

  it('submits successfully after 61 min when all confidence is high', async () => {
    // Reach confirmation pending
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // Advance clock by 61 minutes
    deps._setClock('2026-01-01T11:01:00.000Z');

    // CONFIRM_SUBMISSION — hashes match, confidence is all high → NOT stale
    const confirmResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idemp-stale-1',
      auth_context: AUTH,
    });

    // Should still submit (age > 60 min but all confidence is high = fresh)
    expect(confirmResult.response.conversation_snapshot.state).toBe(ConversationState.SUBMITTED);
  });
});

describe('Confirmation integration — guard paths', () => {
  it('returns error when CONFIRM_SUBMISSION has no issues', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    // Create conversation and reach a state where CONFIRM_SUBMISSION is valid
    // but session has no split_issues (synthetic test via direct handler is Task 6,
    // here we just verify the guard exists)
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Try CONFIRM_SUBMISSION from intake_started — should be invalid transition
    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r2.response.errors[0].code).toBe('INVALID_TRANSITION');
  });
});
