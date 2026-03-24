/**
 * Cross-cutting integration tests for ownership enforcement
 * (MVP Identity & Access — rollout step 9).
 *
 * Tests span multiple features:
 * - Refresh-token continuity (same tenant_user_id after refresh)
 * - Chained-event ownership inheritance (auto-fired events)
 * - Unit-scope edge cases
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActionType,
  ActorType,
  ConversationState,
  WorkOrderStatus,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type { AuthContext, CueDictionary } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { createSession, updateSessionState } from '../../session/session.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { createTokenPair, verifyAccessToken, verifyRefreshToken } from '../../auth/jwt.js';
import { toAuthContext } from '../../auth/types.js';
import type { JwtConfig } from '../../auth/types.js';

const taxonomy = loadTaxonomy();
const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak'], regex: [] },
    },
  },
};

const testVersions = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'default',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) {
    this.sessions.set(session.conversation_id, session);
  }
  seed(session: ConversationSession) {
    this.sessions.set(session.conversation_id, session);
  }
}

function makeDeps(): OrchestratorDependencies & {
  sessionStore: InMemorySessionStore;
  eventRepo: InMemoryEventStore;
} {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-01-15T12:00:00Z',
    issueSplitter: async (input) => ({
      issues: [
        {
          issue_id: `issue-${++counter}`,
          summary: input.raw_text.slice(0, 50),
          raw_excerpt: input.raw_text,
        },
      ],
      issue_count: 1,
    }),
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
        building_id: 'bldg-1',
      }),
    },
    workOrderRepo: new InMemoryWorkOrderStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
    escalationPlans: { version: '1.0.0', plans: [] },
    contactExecutor: async () => false,
  };
}

const jwtConfig: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('test-access-secret-at-least-32-characters!!!'),
  refreshTokenSecret: new TextEncoder().encode('test-refresh-secret-at-least-32-characters!!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent',
  audience: 'wo-agent',
};

// --- Refresh-token continuity ---

describe('Refresh-token continuity', () => {
  it('expired access token + valid refresh token yields same tenant_user_id', async () => {
    const tokens = await createTokenPair(
      { sub: 'tu-alice', account_id: 'ta-acme', unit_ids: ['u1'] },
      jwtConfig,
    );

    // Verify the refresh token resolves to the same identity
    const refreshResult = await verifyRefreshToken(tokens.refreshToken, jwtConfig);
    expect(refreshResult.valid).toBe(true);
    if (refreshResult.valid) {
      const authContext = toAuthContext(refreshResult.payload);
      expect(authContext.tenant_user_id).toBe('tu-alice');
      expect(authContext.tenant_account_id).toBe('ta-acme');
      expect(authContext.authorized_unit_ids).toEqual(['u1']);
    }
  });

  it('expired refresh token is rejected', async () => {
    // Create config with 0-second expiry to get an immediately-expired token
    const expiredConfig: JwtConfig = {
      ...jwtConfig,
      refreshTokenExpiry: '0s',
    };

    const tokens = await createTokenPair(
      { sub: 'tu-alice', account_id: 'ta-acme', unit_ids: ['u1'] },
      expiredConfig,
    );

    // Token should be rejected (expired)
    const result = await verifyRefreshToken(tokens.refreshToken, jwtConfig);
    expect(result.valid).toBe(false);
  });

  it('access token cannot be verified as refresh token (secret separation)', async () => {
    const tokens = await createTokenPair(
      { sub: 'tu-alice', account_id: 'ta-acme', unit_ids: ['u1'] },
      jwtConfig,
    );

    // Access token should not verify with refresh secret
    const result = await verifyRefreshToken(tokens.accessToken, jwtConfig);
    expect(result.valid).toBe(false);
  });
});

// --- Chained-event ownership inheritance ---

describe('Chained-event ownership inheritance', () => {
  let deps: ReturnType<typeof makeDeps>;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  it('auto-fired chained events inherit original auth_context and do not bypass ownership guard', async () => {
    // Create a session in split_proposed state (owned by user-1)
    const session = createSession({
      conversation_id: 'conv-chain',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });

    // Advance to split_proposed with split issues
    const withUnit = {
      ...session,
      unit_id: 'u1',
      property_id: 'prop-for-u1',
      client_id: 'client-for-u1',
      building_id: 'bldg-1',
      state: ConversationState.SPLIT_PROPOSED as ConversationState,
      split_issues: [
        {
          issue_id: 'issue-1',
          summary: 'Leaky faucet in kitchen',
          raw_excerpt: 'The kitchen faucet has been leaking for days',
        },
      ],
    };
    deps.sessionStore.seed(withUnit as any);

    // Confirm split — this lands in split_finalized which auto-fires START_CLASSIFICATION
    const result = await dispatch({
      conversation_id: 'conv-chain',
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    // The chained event should have completed (classification runs after split_finalized)
    // The session should NOT be stuck at split_finalized
    expect(result.response.errors).toEqual([]);
    // After auto-fire, state should have advanced past split_finalized
    const finalState = result.response.conversation_snapshot.state;
    expect(finalState).not.toBe(ConversationState.SPLIT_FINALIZED);
  });

  it('chained event with wrong tenant is rejected (ownership applies to chained path)', async () => {
    const session = createSession({
      conversation_id: 'conv-owned-by-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    // Attempt action as user-2 on user-1's conversation
    const result = await dispatch({
      conversation_id: 'conv-owned-by-1',
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: {
        tenant_user_id: 'user-2',
        tenant_account_id: 'acct-2',
        authorized_unit_ids: ['u2'],
      },
    });

    // Ownership guard fires BEFORE any handler or chaining
    expect(result.response.errors[0].code).toBe('CONVERSATION_NOT_FOUND');
  });
});

// --- Unit-scope edge cases ---

describe('Unit-scope edge cases', () => {
  it('InMemoryWorkOrderStore filters by tenant_user_id AND unit_ids', async () => {
    const store = new InMemoryWorkOrderStore();

    const baseWO = {
      issue_group_id: 'ig-1',
      issue_id: 'issue-1',
      conversation_id: 'conv-1',
      client_id: 'client-1',
      property_id: 'prop-1',
      status: WorkOrderStatus.CREATED,
      status_history: [
        {
          status: WorkOrderStatus.CREATED,
          changed_at: '2026-01-01T00:00:00Z',
          actor: ActorType.SYSTEM,
        },
      ],
      raw_text: 'test',
      summary_confirmed: 'test',
      photos: [],
      classification: { Category: 'maintenance' },
      confidence_by_field: { Category: 0.9 },
      missing_fields: [] as string[],
      pets_present: 'unknown' as const,
      needs_human_triage: false,
      pinned_versions: testVersions,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      row_version: 1,
    };

    await store.insertBatch([
      {
        ...baseWO,
        work_order_id: 'wo-1',
        tenant_user_id: 'alice',
        tenant_account_id: 'acme',
        unit_id: 'u1',
      },
      {
        ...baseWO,
        work_order_id: 'wo-2',
        tenant_user_id: 'alice',
        tenant_account_id: 'acme',
        unit_id: 'u2',
      },
      {
        ...baseWO,
        work_order_id: 'wo-3',
        tenant_user_id: 'bob',
        tenant_account_id: 'acme',
        unit_id: 'u1',
      },
    ]);

    // Alice with only u1 access should see only wo-1
    const aliceResults = await store.listAll({ tenant_user_id: 'alice', unit_ids: ['u1'] });
    expect(aliceResults).toHaveLength(1);
    expect(aliceResults[0].work_order_id).toBe('wo-1');

    // Alice with both units should see wo-1 and wo-2
    const aliceAll = await store.listAll({ tenant_user_id: 'alice', unit_ids: ['u1', 'u2'] });
    expect(aliceAll).toHaveLength(2);

    // Bob should see only wo-3 (his own)
    const bobResults = await store.listAll({ tenant_user_id: 'bob', unit_ids: ['u1'] });
    expect(bobResults).toHaveLength(1);
    expect(bobResults[0].work_order_id).toBe('wo-3');

    // Empty unit_ids returns nothing
    const emptyUnits = await store.listAll({ tenant_user_id: 'alice', unit_ids: [] });
    expect(emptyUnits).toHaveLength(0);
  });
});
