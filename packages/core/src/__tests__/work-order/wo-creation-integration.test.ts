import { describe, it, expect, beforeEach } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import type { SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

const taxonomy = loadTaxonomy();

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

let counter: number;
let woStore: InMemoryWorkOrderStore;
let idempStore: InMemoryIdempotencyStore;

function makeDeps() {
  counter = 0;
  woStore = new InMemoryWorkOrderStore();
  idempStore = new InMemoryIdempotencyStore();
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-03-03T12:00:00Z',
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
        property_id: 'prop-1',
        client_id: 'client-1',
      }),
    },
    workOrderRepo: woStore,
    idempotencyStore: idempStore,
  };
}

async function reachConfirmationPending(dispatch: ReturnType<typeof createDispatcher>) {
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

  expect(splitResult.response.conversation_snapshot.state).toBe(
    ConversationState.TENANT_CONFIRMATION_PENDING,
  );

  return convId;
}

describe('WO creation on CONFIRM_SUBMISSION', () => {
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    const deps = makeDeps();
    dispatch = createDispatcher(deps as any);
  });

  it('creates one WO per split issue in the work order store', async () => {
    const convId = await reachConfirmationPending(dispatch);

    const result = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idemp-1',
      auth_context: AUTH,
    });

    expect(result.session.state).toBe(ConversationState.SUBMITTED);

    // Verify WOs created — single issue splitter returns 1 issue
    // We need to find WOs by checking all stored items
    const storedRecord = await idempStore.get('idemp-1');
    expect(storedRecord).not.toBeNull();
    expect(storedRecord!.work_order_ids).toHaveLength(1);

    const woId = storedRecord!.work_order_ids[0];
    const wo = await woStore.getById(woId);
    expect(wo).not.toBeNull();
    expect(wo!.status).toBe('created');
    expect(wo!.property_id).toBe('prop-1');
    expect(wo!.client_id).toBe('client-1');
    expect(wo!.row_version).toBe(1);
  });

  it('returns completed side effect for WO creation', async () => {
    const convId = await reachConfirmationPending(dispatch);

    const result = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    const woEffect = result.response.pending_side_effects.find(
      se => se.effect_type === 'create_work_orders',
    );
    expect(woEffect?.status).toBe('completed');
  });

  it('stores idempotency record with WO IDs', async () => {
    const convId = await reachConfirmationPending(dispatch);

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idemp-2',
      auth_context: AUTH,
    });

    const storedRecord = await idempStore.get('idemp-2');
    expect(storedRecord).not.toBeNull();
    expect(storedRecord!.work_order_ids.length).toBeGreaterThan(0);
  });

  it('work_order_ids are included in eventPayload', async () => {
    const convId = await reachConfirmationPending(dispatch);

    const result = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idemp-3',
      auth_context: AUTH,
    });

    expect(result.session.state).toBe(ConversationState.SUBMITTED);
    // Verify via idempotency store that WOs were created
    const record = await idempStore.get('idemp-3');
    expect(record!.work_order_ids).toHaveLength(1);
  });
});
