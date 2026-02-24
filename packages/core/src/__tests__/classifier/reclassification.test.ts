import { describe, it, expect, vi } from 'vitest';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import { createSession, updateSessionState, setSplitIssues, setClassificationResults } from '../../session/session.js';
import { ConversationState, ActorType, DEFAULT_CONFIDENCE_CONFIG, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary, ConfidenceConfig } from '@wo-agent/schemas';
import type { IssueClassificationResult } from '../../session/types.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';

const taxonomy = loadTaxonomy();

/**
 * Lower thresholds for test scenarios — same rationale as start-classification tests:
 * the default high_threshold (0.85) exceeds the theoretical max of the confidence
 * formula because model_hint is clamped, so we lower thresholds for test clarity.
 */
const TEST_CONFIDENCE_CONFIG: ConfidenceConfig = {
  ...DEFAULT_CONFIDENCE_CONFIG,
  high_threshold: 0.40,
  medium_threshold: 0.25,
};

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const HIGH_CONFIDENCE_OUTPUT: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak',
    Priority: 'normal',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
  },
  model_confidence: {
    Category: 0.95,
    Maintenance_Category: 0.95,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.95,
    Priority: 0.9,
    Location: 0.9,
    Sub_Location: 0.9,
    Management_Category: 0.95,
    Management_Object: 0.95,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

/**
 * Build an ActionHandlerContext simulating an ANSWER_FOLLOWUPS action.
 * The prior classification had low Priority confidence triggering a follow-up.
 */
function makeFollowupContext(overrides?: {
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  confidenceConfig?: ConfidenceConfig;
}): ActionHandlerContext {
  let counter = 0;
  const priorResults: IssueClassificationResult[] = [{
    issue_id: 'i1',
    classifierOutput: {
      ...HIGH_CONFIDENCE_OUTPUT,
      model_confidence: { ...HIGH_CONFIDENCE_OUTPUT.model_confidence, Priority: 0.3 },
    },
    computedConfidence: { Category: 0.9, Priority: 0.4 },
    fieldsNeedingInput: ['Priority'],
  }];

  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
  session = setSplitIssues(session, [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
  ]);
  session = setClassificationResults(session, priorResults);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: 'ANSWER_FOLLOWUPS' as any,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [{ question_id: 'Priority', answer: 'normal' }],
      },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: { insert: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-24T12:00:00Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(HIGH_CONFIDENCE_OUTPUT),
      cueDict: MINI_CUES,
      taxonomy,
      confidenceConfig: overrides?.confidenceConfig ?? TEST_CONFIDENCE_CONFIG,
    } as any,
  };
}

describe('handleAnswerFollowups (re-classification)', () => {
  it('re-classifies with followup answers and transitions to tenant_confirmation_pending', async () => {
    const ctx = makeFollowupContext();
    const result = await handleAnswerFollowups(ctx);
    // After re-classification with enriched input and high model confidence, should reach confirmation
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('passes followup_answers to classifier input', async () => {
    const ctx = makeFollowupContext();
    await handleAnswerFollowups(ctx);
    // Verify the classifier was called with followup_answers mapped from tenant input
    expect(ctx.deps.issueClassifier).toHaveBeenCalledWith(
      expect.objectContaining({
        followup_answers: expect.arrayContaining([
          expect.objectContaining({ field_target: 'Priority', answer: 'normal' }),
        ]),
      }),
      undefined,
    );
  });

  it('stores updated classification results on session', async () => {
    const ctx = makeFollowupContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.session.classification_results).toBeDefined();
    expect(result.session.classification_results!.length).toBeGreaterThan(0);
    // The stored result should come from the new classifier output, not the old one
    expect(result.session.classification_results![0].issue_id).toBe('i1');
  });

  it('uses intermediate step for classification_in_progress', async () => {
    const ctx = makeFollowupContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.intermediateSteps).toBeDefined();
    expect(result.intermediateSteps!.length).toBeGreaterThanOrEqual(1);
    expect(result.intermediateSteps![0].state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
  });

  it('uses finalSystemAction LLM_CLASSIFY_SUCCESS on success', async () => {
    const ctx = makeFollowupContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.finalSystemAction).toBe('LLM_CLASSIFY_SUCCESS');
  });

  it('transitions to needs_tenant_input when re-classified fields still have low confidence', async () => {
    const stillLowOutput: IssueClassifierOutput = {
      ...HIGH_CONFIDENCE_OUTPUT,
      model_confidence: {
        ...HIGH_CONFIDENCE_OUTPUT.model_confidence,
        Priority: 0.2,
      },
    };
    const ctx = makeFollowupContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowOutput),
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.classification_results![0].fieldsNeedingInput.length).toBeGreaterThan(0);
  });

  it('handles LLM failure during re-classification', async () => {
    const ctx = makeFollowupContext({
      classifierFn: vi.fn().mockRejectedValue(new Error('LLM down')),
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.LLM_ERROR_RETRYABLE);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('returns error when session has no split_issues', async () => {
    const ctx = makeFollowupContext();
    (ctx as any).session = { ...ctx.session, split_issues: null };
    const result = await handleAnswerFollowups(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('handles multiple issues re-classification', async () => {
    const ctx = makeFollowupContext();
    // Add a second issue to split_issues and classification_results
    (ctx as any).session = setSplitIssues(ctx.session, [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
      { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light broken' },
    ]);
    (ctx as any).session = setClassificationResults((ctx as any).session, [
      {
        issue_id: 'i1',
        classifierOutput: { ...HIGH_CONFIDENCE_OUTPUT, model_confidence: { ...HIGH_CONFIDENCE_OUTPUT.model_confidence, Priority: 0.3 } },
        computedConfidence: { Category: 0.9, Priority: 0.4 },
        fieldsNeedingInput: ['Priority'],
      },
      {
        issue_id: 'i2',
        classifierOutput: { ...HIGH_CONFIDENCE_OUTPUT, issue_id: 'i2', model_confidence: { ...HIGH_CONFIDENCE_OUTPUT.model_confidence, Location: 0.3 } },
        computedConfidence: { Category: 0.9, Location: 0.4 },
        fieldsNeedingInput: ['Location'],
      },
    ]);

    let callCount = 0;
    (ctx.deps as any).issueClassifier = vi.fn().mockImplementation(async () => ({
      ...HIGH_CONFIDENCE_OUTPUT,
      issue_id: `i${++callCount}`,
    }));

    const result = await handleAnswerFollowups(ctx);
    expect(result.session.classification_results).toHaveLength(2);
  });
});
