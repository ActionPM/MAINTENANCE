import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { createDispatcher } from '../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../events/in-memory-event-store.js';
import type { OrchestratorDependencies, SessionStore } from '../orchestrator/types.js';
import type { ConversationSession } from '../session/types.js';

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
    issueSplitter: async () => ({ issues: [], issue_count: 0 }),
  };
}

describe('Orchestrator integration: happy path', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  it('walks CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE', async () => {
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
    expect(r3.response.conversation_snapshot.state).toBe('split_in_progress');

    // Verify events were written
    const events = await deps.eventRepo.query({ conversation_id: convId });
    expect(events.length).toBe(3);
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
