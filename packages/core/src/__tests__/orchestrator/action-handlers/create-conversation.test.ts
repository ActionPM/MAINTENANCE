import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleCreateConversation } from '../../../orchestrator/action-handlers/create-conversation.js';
import { createSession } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(unitIds: string[]): ActionHandlerContext {
  let counter = 0;
  const session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: unitIds,
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: unitIds,
      },
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

describe('handleCreateConversation', () => {
  it('returns intake_started for multi-unit tenant', async () => {
    const ctx = makeContext(['u1', 'u2']);
    const result = await handleCreateConversation(ctx);
    expect(result.newState).toBe(ConversationState.INTAKE_STARTED);
    expect(result.uiMessages.length).toBeGreaterThan(0);
  });

  it('auto-selects unit for single-unit tenant', async () => {
    const ctx = makeContext(['u1']);
    const result = await handleCreateConversation(ctx);
    // Still intake_started — unit auto-resolve happens on SELECT_UNIT
    expect(result.newState).toBe(ConversationState.INTAKE_STARTED);
    expect(result.uiMessages.length).toBeGreaterThan(0);
  });
});
