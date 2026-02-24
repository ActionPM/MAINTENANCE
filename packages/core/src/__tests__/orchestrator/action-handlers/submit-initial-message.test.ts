import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSubmitInitialMessage } from '../../../orchestrator/action-handlers/submit-initial-message.js';
import { createSession, updateSessionState, setSessionUnit } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(unitResolved: boolean): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  if (unitResolved) {
    session = updateSessionState(session, ConversationState.UNIT_SELECTED);
    session = setSessionUnit(session, 'u1');
  }
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
    },
  };
}

describe('handleSubmitInitialMessage', () => {
  it('transitions to split_in_progress when unit is resolved', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });

  it('rejects when unit is not resolved', async () => {
    const ctx = makeContext(false);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('UNIT_NOT_RESOLVED');
  });
});
