import { describe, it, expect } from 'vitest';
import { handleConfirmSubmission } from '../../orchestrator/action-handlers/confirm-submission.js';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession, IssueClassificationResult } from '../../session/types.js';
import { computeContentHash } from '../../confirmation/payload-builder.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';

const PINNED = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'default',
  prompt_version: '1.0.0',
};

const SPLIT_ISSUES = [
  { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'Faucet leaks' },
];

// Pre-compute hashes that match what the handler computes internally
const MATCHING_SOURCE_HASH = computeContentHash(
  SPLIT_ISSUES.map(i => i.raw_excerpt).join('|'),
);
const MATCHING_SPLIT_HASH = computeContentHash(
  JSON.stringify(SPLIT_ISSUES.map(i => ({ id: i.issue_id, summary: i.summary }))),
);

const CLASSIFICATION_RESULTS: IssueClassificationResult[] = [
  {
    issue_id: 'iss-1',
    classifierOutput: {
      issue_id: 'iss-1',
      classification: { Category: 'maintenance' },
      model_confidence: { Category: 0.9 },
      missing_fields: [],
      needs_human_triage: false,
    },
    computedConfidence: { Category: 0.92 },
    fieldsNeedingInput: [],
  },
];

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    state: ConversationState.TENANT_CONFIRMATION_PENDING,
    unit_id: 'unit-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: PINNED,
    split_issues: SPLIT_ISSUES,
    classification_results: CLASSIFICATION_RESULTS,
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-01-01T10:00:00.000Z',
    last_activity_at: '2026-01-01T10:30:00.000Z',
    confirmation_entered_at: '2026-01-01T10:25:00.000Z',
    source_text_hash: MATCHING_SOURCE_HASH,
    split_hash: MATCHING_SPLIT_HASH,
    confirmation_presented: true,
    property_id: 'prop-1',
    client_id: 'client-1',
    risk_triggers: [],
    escalation_state: 'none' as const,
    escalation_plan_id: null,
    ...overrides,
  };
}

/**
 * Build an ActionHandlerContext with shared stores so both calls
 * hit the same work-order and idempotency state.
 */
function makeCtx(shared: {
  workOrderRepo: InMemoryWorkOrderStore;
  idempotencyStore: InMemoryIdempotencyStore;
  eventRepo: InMemoryEventStore;
}): ActionHandlerContext {
  let counter = 0;
  return {
    session: makeSession(),
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'retry-key-1',
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['unit-1'],
      },
    },
    deps: {
      eventRepo: shared.eventRepo,
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-01T10:30:00.000Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({}),
      followUpGenerator: async () => ({}),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: {} as any,
      unitResolver: { resolve: async () => null },
      workOrderRepo: shared.workOrderRepo,
      idempotencyStore: shared.idempotencyStore,
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: async () => false,
    },
  };
}

describe('idempotent retry — handleConfirmSubmission', () => {
  it('returns the same WO IDs on retry without creating duplicate work orders', async () => {
    const workOrderRepo = new InMemoryWorkOrderStore();
    const idempotencyStore = new InMemoryIdempotencyStore();
    const eventRepo = new InMemoryEventStore();

    // --- First call: creates WOs and stores idempotency record ---
    const ctx1 = makeCtx({ workOrderRepo, idempotencyStore, eventRepo });
    const result1 = await handleConfirmSubmission(ctx1);

    expect(result1.newState).toBe(ConversationState.SUBMITTED);
    expect(result1.eventPayload).toBeDefined();
    expect(result1.eventPayload!.work_order_ids).toBeDefined();
    const firstWoIds = result1.eventPayload!.work_order_ids as string[];
    expect(firstWoIds).toHaveLength(1);

    // --- Second call: same idempotency key, same shared stores ---
    const ctx2 = makeCtx({ workOrderRepo, idempotencyStore, eventRepo });
    const result2 = await handleConfirmSubmission(ctx2);

    expect(result2.newState).toBe(ConversationState.SUBMITTED);
    expect(result2.eventPayload).toBeDefined();
    const secondWoIds = result2.eventPayload!.work_order_ids as string[];

    // WO IDs must be identical (cached, not re-created)
    expect(secondWoIds).toEqual(firstWoIds);

    // The work-order store should contain exactly 1 WO, not 2.
    // Verify the original WO is present...
    const storedWo = await workOrderRepo.getById(firstWoIds[0]);
    expect(storedWo).not.toBeNull();
    expect(storedWo!.issue_id).toBe('iss-1');

    // ...and that no extra WO was inserted by the retry.
    // The issue_group_id links all WOs from a single submission batch.
    // If only 1 WO exists for this group, no duplicate was created.
    const groupWos = await workOrderRepo.getByIssueGroup(storedWo!.issue_group_id);
    expect(groupWos).toHaveLength(1);

    // Verify the idempotency record still points to the original WO IDs
    const idempRecord = await idempotencyStore.get('retry-key-1');
    expect(idempRecord).not.toBeNull();
    expect(idempRecord!.work_order_ids).toEqual(firstWoIds);

    // Both results should report the same eventPayload.work_order_ids
    expect(result2.eventPayload!.work_order_ids).toEqual(result1.eventPayload!.work_order_ids);
  });
});
