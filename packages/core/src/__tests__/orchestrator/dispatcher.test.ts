import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { createSession } from '../../session/session.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();

  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }

  // Test helper
  seed(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

function makeDeps(): OrchestratorDependencies & { sessionStore: InMemorySessionStore; eventRepo: InMemoryEventStore } {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-01-15T12:00:00Z',
  };
}

const testVersions = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'gpt-4',
  prompt_version: '1.0.0',
};

describe('createDispatcher', () => {
  let deps: ReturnType<typeof makeDeps>;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  it('dispatches CREATE_CONVERSATION and returns new session', async () => {
    const result = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.conversation_snapshot.state).toBe('intake_started');
    expect(result.response.errors).toEqual([]);
  });

  it('rejects invalid transitions with typed error', async () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: 'conv-1',
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.errors).toHaveLength(1);
    expect(result.response.errors[0].code).toBe('INVALID_TRANSITION');
  });

  it('rejects system events from client actions', async () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: 'conv-1',
      action_type: 'LLM_SPLIT_SUCCESS' as any,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.errors).toHaveLength(1);
    expect(result.response.errors[0].code).toBe('SYSTEM_EVENT_REJECTED');
  });

  it('writes a conversation event on successful dispatch', async () => {
    await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    const events = await deps.eventRepo.query({ conversation_id: 'id-1' });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event_type).toBe('state_transition');
  });

  it('handles photo upload without state change', async () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: 'conv-1',
      action_type: ActionType.UPLOAD_PHOTO_INIT,
      actor: ActorType.TENANT,
      tenant_input: { filename: 'leak.jpg', content_type: 'image/jpeg', size_bytes: 1024 },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.conversation_snapshot.state).toBe('intake_started');
    expect(result.response.errors).toEqual([]);
  });
});
