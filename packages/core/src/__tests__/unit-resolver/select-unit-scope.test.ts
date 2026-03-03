import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

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

const AUTH = { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-A', 'unit-B'] };

describe('SELECT_UNIT resolves scope via UnitResolver', () => {
  it('sets property_id and client_id on session after unit selection', async () => {
    let counter = 0;
    const deps: OrchestratorDependencies = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
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
        }),
      },
    };
    const dispatch = createDispatcher(deps);

    // Create conversation with multiple units
    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // Select unit
    const selectResult = await dispatch({
      conversation_id: createResult.session.conversation_id,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-A' },
      auth_context: AUTH,
    });

    expect(selectResult.session.property_id).toBe('prop-for-unit-A');
    expect(selectResult.session.client_id).toBe('client-for-unit-A');
  });

  it('returns error if UnitResolver returns null', async () => {
    let counter = 0;
    const deps: OrchestratorDependencies = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
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
      unitResolver: { resolve: async () => null },
    };
    const dispatch = createDispatcher(deps);

    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    const selectResult = await dispatch({
      conversation_id: createResult.session.conversation_id,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-A' },
      auth_context: AUTH,
    });

    expect(selectResult.response.errors.length).toBeGreaterThan(0);
    expect(selectResult.response.errors[0].code).toBe('UNIT_NOT_FOUND');
  });
});
