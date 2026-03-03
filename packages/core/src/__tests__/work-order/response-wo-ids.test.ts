import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { createSession } from '../../session/session.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';

describe('buildResponse — work_order_ids in snapshot', () => {
  const baseSession = createSession({
    conversation_id: 'conv-wo-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });

  it('includes work_order_ids in snapshot when transitioning to submitted', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.SUBMITTED,
      session: { ...baseSession, state: ConversationState.SUBMITTED },
      uiMessages: [{ role: 'agent', content: 'Work orders created.' }],
      eventPayload: {
        work_order_ids: ['wo-001', 'wo-002'],
      },
    };

    const response = buildResponse(result);

    expect(response.conversation_snapshot.work_order_ids).toEqual([
      'wo-001',
      'wo-002',
    ]);
  });

  it('does not include work_order_ids for non-submitted states', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.SPLIT_PROPOSED,
      session: { ...baseSession, state: ConversationState.SPLIT_PROPOSED },
      uiMessages: [{ role: 'agent', content: 'Issues found.' }],
      eventPayload: {
        work_order_ids: ['wo-001'],
      },
    };

    const response = buildResponse(result);

    expect(response.conversation_snapshot.work_order_ids).toBeUndefined();
  });
});
