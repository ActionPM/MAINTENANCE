import { describe, it, expect } from 'vitest';
import { handleConfirmSubmission } from '../../orchestrator/action-handlers/confirm-submission.js';
import { ConversationState, ActionType, ActorType, DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession, IssueClassificationResult } from '../../session/types.js';
import { computeContentHash } from '../../confirmation/payload-builder.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import type { UnitResolver } from '../../unit-resolver/types.js';

const PINNED = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'default',
  prompt_version: '1.0.0',
};

const SPLIT_ISSUES = [{ issue_id: 'issue-1', summary: 'Leaking toilet', raw_excerpt: 'My toilet leaks' }];

// Pre-compute the hashes that will match what the handler computes
const MATCHING_SOURCE_HASH = computeContentHash(SPLIT_ISSUES.map(i => i.raw_excerpt).join('|'));
const MATCHING_SPLIT_HASH = computeContentHash(
  JSON.stringify(SPLIT_ISSUES.map(i => ({ id: i.issue_id, summary: i.summary }))),
);

const CLASSIFICATION_RESULTS: IssueClassificationResult[] = [
  {
    issue_id: 'issue-1',
    classifierOutput: {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
      model_confidence: { Category: 0.95, Maintenance_Category: 0.90 },
      missing_fields: [],
      needs_human_triage: false,
    },
    computedConfidence: { Category: 0.92, Maintenance_Category: 0.87 },
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
    ...overrides,
  };
}

function makeCtx(sessionOverrides: Partial<ConversationSession> = {}): ActionHandlerContext {
  const events: unknown[] = [];
  return {
    session: makeSession(sessionOverrides),
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['unit-1'],
      },
    },
    deps: {
      eventRepo: {
        insert: async (e: unknown) => { events.push(e); },
        query: async () => [],
      },
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${Math.random().toString(36).slice(2)}`,
      clock: () => '2026-01-01T10:30:00.000Z', // 5 min after confirmation entered
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({}),
      followUpGenerator: async () => ({}),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', categories: {} } as any,
      unitResolver: { resolve: async () => ({ unit_id: 'unit-1', property_id: 'prop-1', client_id: 'client-1' }) } satisfies UnitResolver,
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
    },
  };
}

describe('handleConfirmSubmission', () => {
  it('transitions to submitted when confirmation is fresh', async () => {
    const ctx = makeCtx();
    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);
  });

  it('includes pending side effect for WO creation', async () => {
    const ctx = makeCtx();
    const result = await handleConfirmSubmission(ctx);
    expect(result.sideEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effect_type: 'create_work_orders', status: 'completed' }),
      ]),
    );
  });

  it('returns error when no split issues on session', async () => {
    const ctx = makeCtx({ split_issues: null });
    const result = await handleConfirmSubmission(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('NO_ISSUES');
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('returns error when no classification results on session', async () => {
    const ctx = makeCtx({ classification_results: null });
    const result = await handleConfirmSubmission(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('NO_CLASSIFICATION');
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('re-routes to split_finalized when staleness is detected (source hash changed)', async () => {
    const ctx = makeCtx({
      source_text_hash: 'original-hash-that-wont-match',
      confirmation_entered_at: '2026-01-01T10:00:00.000Z',
    });
    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.eventPayload).toMatchObject({ staleness_detected: true });
  });

  it('produces a confirmation UI message on success', async () => {
    const ctx = makeCtx();
    const result = await handleConfirmSubmission(ctx);
    expect(result.uiMessages.length).toBeGreaterThan(0);
  });

  it('detects staleness when earlier issue has low confidence on shared field (multi-issue)', async () => {
    // Issue 1: Category low confidence (0.30)
    // Issue 2: Category high confidence (0.92)
    // With flat map keyed by field name, issue 2 overwrites issue 1 → hides the low band.
    const multiIssues = [
      { issue_id: 'issue-1', summary: 'Toilet leaking', raw_excerpt: 'My toilet leaks' },
      { issue_id: 'issue-2', summary: 'Sink broken', raw_excerpt: 'My sink is broken' },
    ];
    const multiClassification: IssueClassificationResult[] = [
      {
        issue_id: 'issue-1',
        classifierOutput: {
          issue_id: 'issue-1',
          classification: { Category: 'maintenance' },
          model_confidence: { Category: 0.3 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.30 }, // low band
        fieldsNeedingInput: [],
      },
      {
        issue_id: 'issue-2',
        classifierOutput: {
          issue_id: 'issue-2',
          classification: { Category: 'maintenance' },
          model_confidence: { Category: 0.95 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.92 }, // high band
        fieldsNeedingInput: [],
      },
    ];

    const sourceHash = computeContentHash(multiIssues.map(i => i.raw_excerpt).join('|'));
    const splitHash = computeContentHash(
      JSON.stringify(multiIssues.map(i => ({ id: i.issue_id, summary: i.summary }))),
    );

    const ctx = makeCtx({
      split_issues: multiIssues,
      classification_results: multiClassification,
      source_text_hash: sourceHash,
      split_hash: splitHash,
      confirmation_presented: true,
      // 61 min after confirmation entered → over threshold, borderline check applies
      confirmation_entered_at: '2026-01-01T09:29:00.000Z',
    });
    const result = await handleConfirmSubmission(ctx);

    // Should be stale because issue 1 has Category in low band + age > 60 min
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.eventPayload).toMatchObject({ staleness_detected: true });
  });

  it('sets finalSystemAction to STALENESS_DETECTED when stale', async () => {
    const ctx = makeCtx({
      source_text_hash: 'original-hash-that-wont-match',
      confirmation_entered_at: '2026-01-01T10:00:00.000Z',
    });
    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.finalSystemAction).toBe('STALENESS_DETECTED');
  });
});
