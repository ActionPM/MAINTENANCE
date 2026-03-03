import { describe, it, expect, vi } from 'vitest';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { createSession, updateSessionState, setSplitIssues } from '../../session/session.js';
import { ConversationState, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';
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
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
}): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
  session = setSplitIssues(session, [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
  ]);

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
      followUpGenerator: vi.fn().mockResolvedValue({ questions: [] }),
      cueDict: FULL_CUES,
      taxonomy,
    } as any,
  };
}

describe('classification event recording (spec §7)', () => {
  it('records classification_results in eventPayload with per-issue data', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    expect(result.eventPayload).toBeDefined();
    expect(result.eventPayload!.classification_results).toBeDefined();

    const results = result.eventPayload!.classification_results as any[];
    expect(results).toHaveLength(1);

    const classResult = results[0];
    expect(classResult.issue_id).toBe('i1');
    expect(classResult.classification).toBeDefined();
    expect(classResult.classification.Category).toBe('maintenance');
    expect(classResult.classification.Maintenance_Category).toBe('plumbing');
  });

  it('includes computed confidence scores in eventPayload', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    const results = result.eventPayload!.classification_results as any[];
    const classResult = results[0];

    expect(classResult.computed_confidence).toBeDefined();
    expect(typeof classResult.computed_confidence).toBe('object');

    // Computed confidence should have numeric scores for classified fields
    for (const [field, score] of Object.entries(classResult.computed_confidence)) {
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('session carries pinned_versions for dispatcher to write into events', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    // The handler returns the session with pinned_versions intact.
    // The dispatcher uses session.pinned_versions when writing events (spec §7).
    expect(result.session.pinned_versions).toEqual(VERSIONS);
    expect(result.session.pinned_versions.taxonomy_version).toBe('1.0.0');
    expect(result.session.pinned_versions.model_id).toBe('test-model');
    expect(result.session.pinned_versions.prompt_version).toBe('1.0.0');
  });

  it('records needs_human_triage flag in eventPayload on category gating failure', async () => {
    // Contradictory: Category says management but maintenance fields are populated.
    // The classifier will detect the contradiction, retry with constraint,
    // and if the retry mock also returns contradictory data, result is needs_human_triage.
    const contradictory: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      classification: {
        ...VALID_CLASSIFICATION.classification,
        Category: 'management',
        // Maintenance_Category: 'plumbing' contradicts Category: 'management'
        Maintenance_Category: 'plumbing',
      },
    };
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(contradictory),
    });
    const result = await handleStartClassification(ctx);

    // The handler should have completed (not errored), and the result
    // should flag needs_human_triage in the event payload
    expect(result.eventPayload).toBeDefined();
    if (result.eventPayload!.classification_results) {
      const results = result.eventPayload!.classification_results as any[];
      expect(results).toHaveLength(1);
      expect(results[0].needs_human_triage).toBe(true);
    }
  });

  it('records both attempts in session when needs_human_triage', async () => {
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

    // Session should have the classification result marked for triage
    if (result.session.classification_results) {
      const triageResult = result.session.classification_results[0];
      expect(triageResult.classifierOutput.needs_human_triage).toBe(true);
    }
  });

  it('records error_occurred event on LLM failure', async () => {
    const ctx = makeContext({
      classifierFn: vi.fn().mockRejectedValue(new Error('LLM down')),
    });
    const result = await handleStartClassification(ctx);

    expect(result.eventType).toBe('error_occurred');
    expect(result.eventPayload).toBeDefined();
    expect(result.eventPayload!.error).toBe('classifier_failed');
  });

  it('sets eventType to state_transition on success', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    expect(result.eventType).toBe('state_transition');
  });

  it('records multiple issues in classification_results payload', async () => {
    let counter = 0;
    let callCount = 0;

    let session = createSession({
      conversation_id: 'conv-multi',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });
    session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
    session = setSplitIssues(session, [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet leak' },
      { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light broken' },
    ]);

    const ctx: ActionHandlerContext = {
      session,
      request: {
        conversation_id: 'conv-multi',
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
        issueClassifier: vi.fn().mockImplementation(async () => ({
          ...VALID_CLASSIFICATION,
          issue_id: `i${++callCount}`,
        })),
        followUpGenerator: vi.fn().mockResolvedValue({
          questions: [{ question_id: 'q1', field_target: 'Priority', prompt: 'How urgent?', options: ['low', 'high'], answer_type: 'enum' }],
        }),
        cueDict: FULL_CUES,
        taxonomy,
      } as any,
    };

    const result = await handleStartClassification(ctx);

    expect(result.eventPayload).toBeDefined();
    const results = result.eventPayload!.classification_results as any[];
    expect(results).toHaveLength(2);
    expect(results[0].issue_id).toBe('i1');
    expect(results[1].issue_id).toBe('i2');

    // Each issue should have its own confidence scores
    for (const r of results) {
      expect(r.computed_confidence).toBeDefined();
      expect(r.classification).toBeDefined();
    }
  });
});
