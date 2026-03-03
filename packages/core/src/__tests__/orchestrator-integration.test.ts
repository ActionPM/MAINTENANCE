import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { createDispatcher } from '../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../events/in-memory-event-store.js';
import { SystemEvent } from '../state-machine/system-events.js';
import type { OrchestratorDependencies, SessionStore } from '../orchestrator/types.js';
import type { ConversationSession } from '../session/types.js';
import { InMemoryWorkOrderStore } from '../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../idempotency/in-memory-idempotency-store.js';

const taxonomy = loadTaxonomy();
const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
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
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => new Date().toISOString(),
    issueSplitter: async (input: any) => ({
      issues: [
        { issue_id: `issue-${++counter}`, summary: 'Issue from input', raw_excerpt: input.raw_text },
      ],
      issue_count: 1,
    }),
    issueClassifier: async () => ({
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      model_confidence: { Category: 0.9 },
      missing_fields: [],
      needs_human_triage: false,
    }),
    followUpGenerator: async () => ({ questions: [] }),
    cueDict: MINI_CUES,
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

describe('Orchestrator integration: happy path', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  it('walks CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE → split_proposed', async () => {
    // Step 1: Create
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r1.response.conversation_snapshot.state).toBe('intake_started');
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Step 2: Select unit
    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });
    expect(r2.response.conversation_snapshot.state).toBe('unit_selected');

    // Step 3: Submit initial message
    const r3 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });
    expect(r3.response.conversation_snapshot.state).toBe('split_proposed');

    // Verify events: CREATE, SELECT_UNIT, SUBMIT→split_in_progress, LLM_SPLIT_SUCCESS→split_proposed
    const events = await deps.eventRepo.query({ conversation_id: convId });
    expect(events.length).toBe(4);

    // Verify intermediate event is matrix-compliant
    const submitEvent = events[2];
    expect(submitEvent.action_type).toBe(ActionType.SUBMIT_INITIAL_MESSAGE);
    expect(submitEvent.prior_state).toBe('unit_selected');
    expect(submitEvent.new_state).toBe('split_in_progress');

    // Verify final system event
    const splitSuccessEvent = events[3];
    expect(splitSuccessEvent.action_type).toBe(SystemEvent.LLM_SPLIT_SUCCESS);
    expect(splitSuccessEvent.prior_state).toBe('split_in_progress');
    expect(splitSuccessEvent.new_state).toBe('split_proposed');
  });

  it('rejects invalid transition and leaves state unchanged', async () => {
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Try to CONFIRM_SPLIT from intake_started — invalid
    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r2.response.errors[0].code).toBe('INVALID_TRANSITION');
    expect(r2.response.conversation_snapshot.state).toBe('intake_started');
  });

  it('handles photo upload without state change', async () => {
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.UPLOAD_PHOTO_INIT,
      actor: ActorType.TENANT,
      tenant_input: { filename: 'leak.jpg', content_type: 'image/jpeg', size_bytes: 1024 },
      auth_context: AUTH,
    });
    expect(r2.response.conversation_snapshot.state).toBe('intake_started');
    expect(r2.response.errors).toEqual([]);
  });
});

describe('Orchestrator integration: split confirmation flow', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  async function reachSplitProposed() {
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
      tenant_input: { message: 'Toilet leaking and light broken' },
      auth_context: AUTH,
    });

    return convId;
  }

  it('walks split_proposed → CONFIRM_SPLIT → auto-classification', async () => {
    const convId = await reachSplitProposed();

    const r = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    // Auto-chaining: CONFIRM_SPLIT -> split_finalized -> START_CLASSIFICATION -> classification result
    expect([
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(r.response.conversation_snapshot.state);
  });

  it('walks split_proposed → ADD_ISSUE → CONFIRM_SPLIT → auto-classification', async () => {
    const convId = await reachSplitProposed();

    const r1 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.ADD_ISSUE,
      actor: ActorType.TENANT,
      tenant_input: { summary: 'Door is stuck' },
      auth_context: AUTH,
    });
    expect(r1.response.conversation_snapshot.state).toBe('split_proposed');
    expect(r1.response.conversation_snapshot.issues!.length).toBe(2);

    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    // Auto-chaining: CONFIRM_SPLIT -> split_finalized -> START_CLASSIFICATION -> classification result
    expect([
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(r2.response.conversation_snapshot.state);
  });

  it('walks split_proposed → REJECT_SPLIT → auto-classification (single issue)', async () => {
    const convId = await reachSplitProposed();

    const r = await dispatch({
      conversation_id: convId,
      action_type: ActionType.REJECT_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    // Auto-chaining: REJECT_SPLIT -> split_finalized -> START_CLASSIFICATION -> classification result
    expect([
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(r.response.conversation_snapshot.state);
    expect(r.response.conversation_snapshot.issues!.length).toBe(1);
  });

  it('handles splitter failure gracefully with matrix-compliant events', async () => {
    // Override splitter to fail
    (deps as any).issueSplitter = async () => { throw new Error('LLM down'); };
    dispatch = createDispatcher(deps as any);

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

    const r3 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });
    expect(r3.response.conversation_snapshot.state).toBe('llm_error_retryable');
    expect(r3.response.errors.length).toBeGreaterThan(0);

    // Verify events: CREATE, SELECT_UNIT, SUBMIT→split_in_progress, LLM_FAIL→llm_error_retryable
    const events = await deps.eventRepo.query({ conversation_id: convId });
    expect(events.length).toBe(4);

    const submitEvent = events[2];
    expect(submitEvent.action_type).toBe(ActionType.SUBMIT_INITIAL_MESSAGE);
    expect(submitEvent.new_state).toBe('split_in_progress');

    const failEvent = events[3];
    expect(failEvent.action_type).toBe(SystemEvent.LLM_FAIL);
    expect(failEvent.prior_state).toBe('split_in_progress');
    expect(failEvent.new_state).toBe('llm_error_retryable');
  });
});
