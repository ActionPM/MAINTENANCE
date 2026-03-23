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

function makeContext(unitIds: string[], resolver?: UnitResolver): ActionHandlerContext {
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
      cue_version: '1.2.0',
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
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
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
      unitResolver: resolver ?? ({ resolve: async () => null } satisfies UnitResolver),
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: async () => false,
    },
  };
}

const VALID_RESOLVER: UnitResolver = {
  resolve: async (unitId: string) => ({
    unit_id: unitId,
    property_id: `prop-${unitId}`,
    client_id: `client-${unitId}`,
    building_id: `building-${unitId}`,
  }),
};

const NULL_RESOLVER: UnitResolver = {
  resolve: async () => null,
};

describe('handleCreateConversation', () => {
  it('returns unit_selection_required for multi-unit tenant', async () => {
    const ctx = makeContext(['u1', 'u2'], VALID_RESOLVER);
    const result = await handleCreateConversation(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTION_REQUIRED);
    expect(result.uiMessages.length).toBeGreaterThan(0);
    expect(result.session.unit_id).toBeNull();
  });

  it('returns quick replies with SELECT_UNIT for multi-unit tenant', async () => {
    const ctx = makeContext(['u1', 'u2', 'u3'], VALID_RESOLVER);
    const result = await handleCreateConversation(ctx);
    expect(result.quickReplies).toHaveLength(3);
    for (const qr of result.quickReplies!) {
      expect(qr.action_type).toBe(ActionType.SELECT_UNIT);
    }
  });

  it('returns unit_selected with resolved scope for single-unit tenant', async () => {
    const ctx = makeContext(['u1'], VALID_RESOLVER);
    const result = await handleCreateConversation(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTED);
    expect(result.session.unit_id).toBe('u1');
    expect(result.session.property_id).toBe('prop-u1');
    expect(result.session.client_id).toBe('client-u1');
    expect(result.session.building_id).toBe('building-u1');
  });

  it('returns no quick replies for single-unit tenant', async () => {
    const ctx = makeContext(['u1'], VALID_RESOLVER);
    const result = await handleCreateConversation(ctx);
    expect(result.quickReplies).toBeUndefined();
  });

  it('falls to unit_selection_required when resolver returns null for single-unit', async () => {
    const ctx = makeContext(['u1'], NULL_RESOLVER);
    const result = await handleCreateConversation(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTION_REQUIRED);
    expect(result.session.unit_id).toBeNull();
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('UNIT_RESOLVE_FAILED');
    expect(result.quickReplies).toHaveLength(1);
  });
});
