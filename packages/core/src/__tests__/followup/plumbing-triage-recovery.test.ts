import { describe, expect, it, vi } from 'vitest';
import { ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary, IssueClassifierOutput, SplitIssue } from '@wo-agent/schemas';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { createSession, setSplitIssues, updateSessionState } from '../../session/session.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '2.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

const TRIAGE_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: {
      maintenance: { keywords: ['plumbing', 'issue', 'leak'], regex: [] },
    },
    Maintenance_Category: {
      plumbing: { keywords: ['plumbing', 'pipe', 'leak'], regex: [] },
    },
  },
};

const RECOVERABLE_TRIAGE_OUTPUT: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'needs_object',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
  },
  model_confidence: {
    Category: 0.92,
    Maintenance_Category: 0.9,
    Maintenance_Object: 0.2,
  },
  missing_fields: [],
  needs_human_triage: true,
};

const UNRECOVERABLE_TRIAGE_OUTPUT: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'needs_object',
  },
  model_confidence: {
    Maintenance_Category: 0.9,
    Maintenance_Object: 0.2,
  },
  missing_fields: [],
  needs_human_triage: true,
};

function makeContext(overrides?: {
  issues?: readonly SplitIssue[];
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
}) {
  let counter = 0;
  const issues = overrides?.issues ?? [
    {
      issue_id: 'i1',
      summary: 'Plumbing issue',
      raw_excerpt: 'I have a plumbing issue',
    },
  ];

  let session = createSession({
    conversation_id: 'conv-plumbing',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
  session = setSplitIssues(session, issues);

  return {
    session,
    request: {
      conversation_id: 'conv-plumbing',
      action_type: 'START_CLASSIFICATION' as const,
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
      clock: () => '2026-03-30T12:00:00Z',
      issueSplitter: vi.fn(),
      issueClassifier:
        overrides?.classifierFn ?? vi.fn().mockResolvedValue(RECOVERABLE_TRIAGE_OUTPUT),
      followUpGenerator: vi.fn().mockResolvedValue({
        questions: [
          {
            question_id: 'q-location',
            field_target: 'Location',
            prompt: 'Where is the issue located?',
            options: ['suite', 'building_interior'],
            answer_type: 'enum',
          },
          {
            question_id: 'q-object',
            field_target: 'Maintenance_Object',
            prompt: 'What fixture or item is affected?',
            options: ['sink', 'toilet', 'pipe'],
            answer_type: 'enum',
          },
        ],
      }),
      cueDict: TRIAGE_CUES,
      taxonomy,
    } as any,
  } satisfies ActionHandlerContext;
}

describe('plumbing triage recovery routing', () => {
  it('routes recoverable plumbing triage into follow-ups instead of review confirmation', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.pending_followup_questions).toHaveLength(1);
    expect(result.session.pending_followup_questions?.map((q) => q.field_target)).toEqual([
      'Location',
    ]);

    const classification = result.session.classification_results![0];
    expect(classification.classifierOutput.needs_human_triage).toBe(true);
    expect(classification.recoverable_via_followup).toBe(true);
    expect(classification.fieldsNeedingInput).toEqual(
      expect.arrayContaining([
        'Location',
        'Sub_Location',
        'Maintenance_Object',
        'Maintenance_Problem',
        'Priority',
      ]),
    );
  });

  it('routes unrecoverable triage to review-oriented confirmation', async () => {
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(UNRECOVERABLE_TRIAGE_OUTPUT),
    });
    const result = await handleStartClassification(ctx);

    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.uiMessages[0]?.content).toMatch(/human review/i);

    const classification = result.session.classification_results![0];
    expect(classification.recoverable_via_followup).toBe(false);
    expect(classification.routing_reason).toBe('unrecoverable_classification');
  });

  it('routes the whole conversation to review when any issue is unrecoverable', async () => {
    const issues: SplitIssue[] = [
      {
        issue_id: 'i1',
        summary: 'Plumbing issue',
        raw_excerpt: 'I have a plumbing issue',
      },
      {
        issue_id: 'i2',
        summary: 'Unknown issue',
        raw_excerpt: 'Something is wrong',
      },
    ];
    const ctx = makeContext({
      issues,
      classifierFn: vi
        .fn()
        .mockResolvedValueOnce(RECOVERABLE_TRIAGE_OUTPUT)
        .mockResolvedValueOnce({
          ...UNRECOVERABLE_TRIAGE_OUTPUT,
          issue_id: 'i2',
        }),
    });
    const result = await handleStartClassification(ctx);

    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.pending_followup_questions).toBeNull();
    expect(result.uiMessages[0]?.content).toMatch(/submit this request for review/i);
    expect(result.session.classification_results).toHaveLength(2);
  });
});
