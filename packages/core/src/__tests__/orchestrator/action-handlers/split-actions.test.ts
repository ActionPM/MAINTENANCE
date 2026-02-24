import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSplitAction } from '../../../orchestrator/action-handlers/split-actions.js';
import { createSession, updateSessionState } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(actionType: string, tenantInput: Record<string, unknown> = {}): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  session = updateSessionState(session, ConversationState.SPLIT_PROPOSED);
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: actionType as any,
      actor: ActorType.TENANT,
      tenant_input: tenantInput as any,
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
    },
  };
}

describe('handleSplitAction', () => {
  it('CONFIRM_SPLIT transitions to split_finalized', async () => {
    const ctx = makeContext(ActionType.CONFIRM_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
  });

  it('REJECT_SPLIT transitions to split_finalized', async () => {
    const ctx = makeContext(ActionType.REJECT_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
  });

  it('MERGE_ISSUES stays in split_proposed', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1', 'i2'] });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });

  it('EDIT_ISSUE stays in split_proposed', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'Updated' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });

  it('ADD_ISSUE stays in split_proposed', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: 'New issue' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });
});
