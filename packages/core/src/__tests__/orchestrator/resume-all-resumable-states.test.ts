import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationState,
  ActionType,
  ActorType,
  loadTaxonomy,
  resolveCurrentVersions,
} from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

const taxonomy = loadTaxonomy();
const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {},
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

  seed(session: ConversationSession) {
    this.sessions.set(session.conversation_id, session);
  }
}

function makeSession(state: ConversationState): ConversationSession {
  return {
    conversation_id: 'conv-resume-test',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    state,
    pinned_versions: resolveCurrentVersions(),
    unit_id: 'u1',
    split_issues: null,
    classification_results: null,
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-01-15T12:00:00Z',
    last_activity_at: '2026-01-15T12:00:00Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: null,
    client_id: null,
    building_id: null,
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
    queued_messages: [],
  };
}

function makeDeps(): OrchestratorDependencies & { sessionStore: InMemorySessionStore } {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-01-15T12:00:00Z',
    issueSplitter: async () => ({ issues: [], issue_count: 0 }),
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
        building_id: 'bldg-1',
      }),
    },
    workOrderRepo: new InMemoryWorkOrderStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
    escalationPlans: { version: '1.0.0', plans: [] },
    contactExecutor: async () => false,
  };
}

describe('RESUME from all previously-missing resumable states', () => {
  let deps: ReturnType<typeof makeDeps>;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  const resumableStates: ConversationState[] = [
    ConversationState.UNIT_SELECTION_REQUIRED,
    ConversationState.SPLIT_PROPOSED,
    ConversationState.CLASSIFICATION_IN_PROGRESS,
    ConversationState.NEEDS_TENANT_INPUT,
    ConversationState.TENANT_CONFIRMATION_PENDING,
  ];

  it.each(resumableStates)('RESUME from %s returns same state with no errors', async (state) => {
    const session = makeSession(state);
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: session.conversation_id,
      action_type: ActionType.RESUME,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: session.tenant_user_id,
        tenant_account_id: session.tenant_account_id,
        authorized_unit_ids: session.authorized_unit_ids as string[],
      },
    });

    expect(result.response.errors).toEqual([]);
    expect(result.response.conversation_snapshot.state).toBe(state);
  });
});
