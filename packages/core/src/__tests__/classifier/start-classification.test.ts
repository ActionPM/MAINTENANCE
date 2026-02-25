import { describe, it, expect, vi } from 'vitest';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { createSession, updateSessionState, setSplitIssues } from '../../session/session.js';
import { ConversationState, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { SplitIssue, IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';
import type { ActionHandlerContext } from '../../orchestrator/types.js';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const VALID_CLASSIFICATION: IssueClassifierOutput = {
  issue_id: 'i1',
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
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.85,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.88,
    Management_Category: 0.95,
    Management_Object: 0.95,
    Priority: 0.9,
  },
  missing_fields: [],
  needs_human_triage: false,
};

/**
 * Cue dictionary covering all fields in VALID_CLASSIFICATION.
 * Each entry has keywords matching the test text "Toilet leaking / My toilet is leaking"
 * so that cue_strength > 0 for every field, pushing confidence into the medium band
 * (>= 0.65) which is accepted without follow-up.
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

function makeContext(overrides?: {
  issues?: readonly SplitIssue[];
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  cueDict?: CueDictionary;
}): ActionHandlerContext {
  let counter = 0;
  const issues = overrides?.issues ?? [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
  ];

  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
  session = setSplitIssues(session, issues as SplitIssue[]);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: 'START_CLASSIFICATION' as any,
      actor: ActorType.SYSTEM,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: { insert: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: {
        get: vi.fn().mockResolvedValue(null),
        getByTenantUser: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-24T12:00:00Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
      followUpGenerator: vi.fn().mockResolvedValue({
        questions: [{ question_id: 'q1', field_target: 'Priority', prompt: 'How urgent?', options: ['low', 'high'], answer_type: 'enum' }],
      }),
      cueDict: overrides?.cueDict ?? FULL_CUES,
      taxonomy,
    } as any,
  };
}

describe('handleStartClassification', () => {
  it('classifies all issues and transitions to tenant_confirmation_pending when all high confidence', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.classification_results).toHaveLength(1);
    expect(result.session.classification_results![0].issue_id).toBe('i1');
  });

  it('transitions to needs_tenant_input when fields lack cue support and have low model confidence', async () => {
    // Without cue dictionary entries, even high model confidence only gives
    // conf = 0 + 0.25 + 0.19 = 0.44 (low band). This test verifies that
    // fields without cue support are correctly flagged as needing input.
    const emptyCues: CueDictionary = { version: '1.0.0', fields: {} };
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
      cueDict: emptyCues,
    });
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.classification_results![0].fieldsNeedingInput.length).toBeGreaterThan(0);
  });

  it('classifies multiple issues', async () => {
    const issues: SplitIssue[] = [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet leak' },
      { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light broken' },
    ];
    let callCount = 0;
    const ctx = makeContext({
      issues,
      classifierFn: vi.fn().mockImplementation(async () => ({
        ...VALID_CLASSIFICATION,
        issue_id: `i${++callCount}`,
      })),
    });
    const result = await handleStartClassification(ctx);
    expect(result.session.classification_results).toHaveLength(2);
  });

  it('returns error when split_issues is null', async () => {
    const ctx = makeContext();
    (ctx as any).session = setSplitIssues(ctx.session, null);
    const result = await handleStartClassification(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('handles needs_human_triage from category gating failure', async () => {
    const contradictory: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      classification: {
        ...VALID_CLASSIFICATION.classification,
        Category: 'management',
        Maintenance_Category: 'plumbing',
      },
    };
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(contradictory),
    });
    const result = await handleStartClassification(ctx);
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
  });

  it('handles LLM failure gracefully', async () => {
    const ctx = makeContext({
      classifierFn: vi.fn().mockRejectedValue(new Error('LLM down')),
    });
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.LLM_ERROR_RETRYABLE);
  });

  it('uses finalSystemAction LLM_CLASSIFY_SUCCESS on success', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);
    expect(result.finalSystemAction).toBe('LLM_CLASSIFY_SUCCESS');
  });

  it('transitions to needs_tenant_input when classifier reports missing_fields', async () => {
    const outputWithMissing: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      missing_fields: ['Location'],
    };
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(outputWithMissing),
    });
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.classification_results![0].fieldsNeedingInput).toContain('Location');
  });

  it('uses intermediateSteps for matrix compliance', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);
    expect(result.intermediateSteps).toBeDefined();
    expect(result.intermediateSteps!.length).toBeGreaterThanOrEqual(1);
    expect(result.intermediateSteps![0].state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
  });
});
