import { describe, it, expect } from 'vitest';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { createSession, updateSessionState, setSplitIssues } from '../../session/session.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';

const taxonomy = loadTaxonomy();

/**
 * Full cues covering all fields so classification reaches high confidence
 * and the "all fields resolved" path (→ tenant_confirmation_pending) is hit.
 */
const FULL_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['leak'], regex: [] } },
    Location: { suite: { keywords: ['toilet'], regex: [] } },
    Sub_Location: { bathroom: { keywords: ['toilet'], regex: [] } },
    Maintenance_Category: { plumbing: { keywords: ['leak', 'toilet'], regex: [] } },
    Maintenance_Object: { toilet: { keywords: ['toilet'], regex: [] } },
    Maintenance_Problem: { leak: { keywords: ['leak'], regex: [] } },
    Management_Category: { other_mgmt_cat: { keywords: ['toilet'], regex: [] } },
    Management_Object: { other_mgmt_obj: { keywords: ['toilet'], regex: [] } },
    Priority: { normal: { keywords: ['leak'], regex: [] } },
  },
};

function makeCtx(): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'default',
      prompt_version: '1.0.0',
    },
  });
  session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
  session = setSplitIssues(session, [
    { issue_id: 'issue-1', summary: 'Leaking toilet', raw_excerpt: 'My toilet leaks' },
  ]);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.SYSTEM,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['unit-1'],
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
      clock: () => '2026-01-01T10:05:00.000Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({
        issue_id: 'issue-1',
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
          Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj',
          Priority: 'normal',
        },
        model_confidence: {
          Category: 0.95, Location: 0.9, Sub_Location: 0.85,
          Maintenance_Category: 0.92, Maintenance_Object: 0.95,
          Maintenance_Problem: 0.88, Management_Category: 0.95,
          Management_Object: 0.95, Priority: 0.9,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: FULL_CUES,
      taxonomy,
    },
  };
}

describe('handleStartClassification — confirmation tracking', () => {
  it('sets confirmation_entered_at when transitioning to tenant_confirmation_pending', async () => {
    const ctx = makeCtx();
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.confirmation_entered_at).toBeTruthy();
  });

  it('sets source_text_hash and split_hash on the session', async () => {
    const ctx = makeCtx();
    const result = await handleStartClassification(ctx);
    expect(result.session.source_text_hash).toBeTruthy();
    expect(result.session.split_hash).toBeTruthy();
  });
});
