import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { handleCreateConversation } from '../../../orchestrator/action-handlers/create-conversation.js';
import { createSession } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../../idempotency/in-memory-idempotency-store.js';
import type { UnitResolver } from '../../../unit-resolver/types.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

const taxonomy = loadTaxonomy();
const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

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
      unitResolver: { resolve: async () => null } satisfies UnitResolver,
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
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
