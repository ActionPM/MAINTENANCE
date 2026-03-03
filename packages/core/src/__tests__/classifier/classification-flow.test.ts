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
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  },
  missing_fields: [],
  needs_human_triage: false,
};

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

function makeDeps() {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-02-24T12:00:00Z',
    issueSplitter: vi.fn().mockResolvedValue({
      issues: [{ issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' }],
      issue_count: 1,
    }),
    issueClassifier: vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
    followUpGenerator: vi.fn().mockResolvedValue({ questions: [] }),
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

const AUTH = {
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  authorized_unit_ids: ['u1'],
};

describe('Classification flow integration', () => {
  it('walks CREATE -> SELECT_UNIT -> SUBMIT_INITIAL_MESSAGE -> CONFIRM_SPLIT -> classification -> confirmation', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    // Create conversation
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Select unit
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });

    // Submit initial message -> split_proposed
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });

    // Confirm split -> should auto-trigger START_CLASSIFICATION -> classification result
    const r4 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // Should end in tenant_confirmation_pending or needs_tenant_input (NOT split_finalized)
    const finalState = r4.response.conversation_snapshot.state;
    expect([
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(finalState);

    // Should have classification results
    expect(r4.response.conversation_snapshot.classification_results).toBeDefined();
    expect(r4.response.conversation_snapshot.classification_results!.length).toBe(1);
  });

  it('produces matrix-compliant events for the full CONFIRM_SPLIT -> classification chain', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    // Reach split_proposed
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

    // Confirm split -> auto-classification
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // Check events:
    // 1. CREATE -> intake_started
    // 2. SELECT_UNIT -> unit_selected
    // 3. SUBMIT_INITIAL_MESSAGE -> split_in_progress (intermediate)
    // 4. LLM_SPLIT_SUCCESS -> split_proposed (final)
    // 5. CONFIRM_SPLIT -> split_finalized
    // 6. START_CLASSIFICATION -> classification_in_progress (intermediate)
    // 7. LLM_CLASSIFY_SUCCESS -> tenant_confirmation_pending or needs_tenant_input
    const events = await deps.eventRepo.query({ conversation_id: convId });
    expect(events.length).toBe(7);

    // Verify the CONFIRM_SPLIT event
    const confirmEvent = events[4];
    expect(confirmEvent.action_type).toBe(ActionType.CONFIRM_SPLIT);
    expect(confirmEvent.prior_state).toBe(ConversationState.SPLIT_PROPOSED);
    expect(confirmEvent.new_state).toBe(ConversationState.SPLIT_FINALIZED);

    // Verify START_CLASSIFICATION intermediate event
    const classStartEvent = events[5];
    expect(classStartEvent.action_type).toBe(SystemEvent.START_CLASSIFICATION);
    expect(classStartEvent.prior_state).toBe(ConversationState.SPLIT_FINALIZED);
    expect(classStartEvent.new_state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);

    // Verify LLM_CLASSIFY_SUCCESS final event
    const classSuccessEvent = events[6];
    expect(classSuccessEvent.action_type).toBe(SystemEvent.LLM_CLASSIFY_SUCCESS);
    expect(classSuccessEvent.prior_state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
    expect([
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(classSuccessEvent.new_state);
  });

  it('auto-triggers classification after REJECT_SPLIT as well', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

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

    // Reject split -> should also auto-trigger classification
    const r4 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.REJECT_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    const finalState = r4.response.conversation_snapshot.state;
    expect([
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(finalState);
  });

  it('handles classifier failure during auto-chain gracefully', async () => {
    const deps = makeDeps();
    deps.issueClassifier.mockRejectedValue(new Error('LLM down'));
    const dispatch = createDispatcher(deps as any);

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

    // Confirm split -> classification fails -> should land in llm_error_retryable
    const r4 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    expect(r4.response.conversation_snapshot.state).toBe(ConversationState.LLM_ERROR_RETRYABLE);
  });
});
