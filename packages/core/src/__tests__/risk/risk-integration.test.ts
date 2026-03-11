import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import {
  ActionType,
  ActorType,
  ConversationState,
  loadTaxonomy,
  loadRiskProtocols,
} from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import type { SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const FULL_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['fire', 'kitchen'], regex: [] } },
    Location: { suite: { keywords: ['kitchen', 'my'], regex: [] } },
    Sub_Location: { kitchen: { keywords: ['kitchen', 'fire'], regex: [] } },
    Maintenance_Category: { plumbing: { keywords: ['fire', 'kitchen'], regex: [] } },
    Maintenance_Object: { toilet: { keywords: ['kitchen', 'my'], regex: [] } },
    Maintenance_Problem: { leak: { keywords: ['fire', 'smoke'], regex: [] } },
    Management_Category: { other_mgmt_cat: { keywords: ['fire', 'kitchen'], regex: [] } },
    Management_Object: { other_mgmt_obj: { keywords: ['fire', 'my'], regex: [] } },
    Priority: { normal: { keywords: ['fire', 'kitchen'], regex: [] } },
  },
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

const AUTH = { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] };

function makeDeps() {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-03-03T12:00:00Z',
    issueSplitter: vi.fn().mockResolvedValue({
      issue_count: 1,
      issues: [
        {
          issue_id: 'iss-1',
          summary: 'Fire in kitchen',
          raw_excerpt: 'There is fire in my kitchen',
        },
      ],
    }),
    issueClassifier: vi.fn().mockResolvedValue({
      issue_id: 'iss-1',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
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
    }),
    followUpGenerator: vi.fn().mockResolvedValue({ questions: [] }),
    cueDict: FULL_CUES,
    taxonomy,
    unitResolver: {
      resolve: vi.fn().mockResolvedValue({
        unit_id: 'unit-1',
        property_id: 'prop-1',
        client_id: 'client-1',
        building_id: 'bldg-001',
      }),
    },
    workOrderRepo: new InMemoryWorkOrderStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    riskProtocols: loadRiskProtocols(),
    escalationPlans: { version: '1.0.0', plans: [] },
    contactExecutor: vi.fn().mockResolvedValue(true),
  };
}

describe('Risk + Emergency integration', () => {
  it('emergency keyword triggers mitigation in response', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    // 1. Create conversation
    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    // 2. Select unit
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: AUTH,
    });

    // 3. Submit message with emergency keyword
    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'There is fire in my kitchen and smoke everywhere' },
      auth_context: AUTH,
    });

    // Risk mitigation should be in UI messages
    const messages = submitResult.response.ui_directive.messages ?? [];
    const allContent = messages.map((m) => m.content).join(' ');
    expect(allContent).toContain('Fire Safety');
    expect(allContent).toContain('911');

    // Risk summary in snapshot
    expect(submitResult.response.conversation_snapshot.risk_summary).toBeDefined();
    expect(submitResult.response.conversation_snapshot.risk_summary!.has_emergency).toBe(true);
  });

  it('benign message has no risk data', async () => {
    const deps = makeDeps();
    deps.issueSplitter.mockResolvedValue({
      issue_count: 1,
      issues: [
        { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet is dripping' },
      ],
    });
    const dispatch = createDispatcher(deps);

    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: AUTH,
    });

    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My faucet is dripping' },
      auth_context: AUTH,
    });

    expect(submitResult.response.conversation_snapshot.risk_summary).toBeUndefined();
  });

  it('risk flags propagate to created WorkOrders', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    // Create → select unit → submit fire message → confirm split → classify → confirm submission
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
      tenant_input: { unit_id: 'unit-1' },
      auth_context: AUTH,
    });

    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'There is fire in my kitchen and smoke everywhere' },
      auth_context: AUTH,
    });
    expect(submitResult.response.conversation_snapshot.state).toBe(
      ConversationState.SPLIT_PROPOSED,
    );

    const splitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    // Classification should succeed and reach tenant_confirmation_pending
    expect(splitResult.response.conversation_snapshot.state).toBe(
      ConversationState.TENANT_CONFIRMATION_PENDING,
    );

    // After classification + confirmation, submit
    const confirmResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idem-1',
      auth_context: AUTH,
    });
    expect(confirmResult.session.state).toBe(ConversationState.SUBMITTED);

    // Check WOs in store have risk_flags
    const woIds = confirmResult.response.conversation_snapshot.work_order_ids ?? [];
    expect(woIds.length).toBeGreaterThan(0);

    for (const woId of woIds) {
      const wo = await deps.workOrderRepo.getById(woId);
      expect(wo).not.toBeNull();
      expect(wo!.risk_flags).toBeDefined();
      expect(wo!.risk_flags!.has_emergency).toBe(true);
    }
  });
});
