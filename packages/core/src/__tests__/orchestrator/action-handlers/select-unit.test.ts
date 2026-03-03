import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { handleSelectUnit } from '../../../orchestrator/action-handlers/select-unit.js';
import { createSession } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
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

function makeContext(
  unitIds: string[],
  selectedUnitId: string,
  state: string = ConversationState.INTAKE_STARTED,
): ActionHandlerContext {
  let counter = 0;
  const session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: unitIds,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  return {
    session: { ...session, state: state as any },
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: selectedUnitId },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: unitIds },
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
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: `prop-for-${unitId}`,
          client_id: `client-for-${unitId}`,
        }),
      },
    },
  };
}

describe('handleSelectUnit', () => {
  it('selects an authorized unit and transitions to unit_selected', async () => {
    const ctx = makeContext(['u1', 'u2'], 'u1');
    const result = await handleSelectUnit(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTED);
    expect(result.session.unit_id).toBe('u1');
  });

  it('rejects an unauthorized unit with error', async () => {
    const ctx = makeContext(['u1', 'u2'], 'u_invalid');
    const result = await handleSelectUnit(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0].code).toBe('UNIT_NOT_AUTHORIZED');
  });

  it('auto-selects when tenant has single unit', async () => {
    const ctx = makeContext(['u1'], 'u1');
    const result = await handleSelectUnit(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTED);
    expect(result.session.unit_id).toBe('u1');
  });
});
