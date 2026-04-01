import { describe, it, expect, vi } from 'vitest';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { createSession, updateSessionState, setSplitIssues } from '../../session/session.js';
import {
  ConversationState,
  ActorType,
  DEFAULT_FOLLOWUP_CAPS,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type {
  SplitIssue,
  IssueClassifierOutput,
  FollowUpGeneratorOutput,
  CueDictionary,
} from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

const LOW_CONF_CLASSIFICATION: IssueClassifierOutput = {
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
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.3, // Low confidence -> needs follow-up
  },
  missing_fields: [],
  needs_human_triage: false,
};

const FOLLOWUP_OUTPUT: FollowUpGeneratorOutput = {
  questions: [
    {
      question_id: 'q1',
      field_target: 'Priority',
      prompt: 'How urgent is this issue?',
      options: ['low', 'normal', 'high', 'emergency'],
      answer_type: 'enum',
    },
  ],
};

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

function makeContext(overrides?: {
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  followUpFn?: (...args: unknown[]) => Promise<unknown>;
}) {
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
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-25T12:00:00.000Z',
      issueSplitter: vi.fn(),
      issueClassifier:
        overrides?.classifierFn ?? vi.fn().mockResolvedValue(LOW_CONF_CLASSIFICATION),
      followUpGenerator: overrides?.followUpFn ?? vi.fn().mockResolvedValue(FOLLOWUP_OUTPUT),
      cueDict: MINI_CUES,
      taxonomy,
      followUpCaps: DEFAULT_FOLLOWUP_CAPS,
    } as any,
  };
}

describe('handleStartClassification with follow-up generation', () => {
  it('generates follow-up questions when fields need input', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    // Session should have pending questions
    expect(result.session.pending_followup_questions).toHaveLength(1);
    expect(result.session.pending_followup_questions![0].field_target).toBe('Location');
    // Session tracking should be updated
    expect(result.session.followup_turn_number).toBe(1);
    expect(result.session.total_questions_asked).toBe(1);
  });

  it('records a followup_event for questions asked', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    // eventRepo.insert should have been called with a followup event
    expect(ctx.deps.eventRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-1',
        issue_id: 'i1',
        turn_number: 1,
        questions_asked: expect.any(Array),
        answers_received: null,
      }),
    );
  });

  it('triggers escape hatch when FollowUpGenerator LLM fails', async () => {
    const ctx = makeContext({
      followUpFn: vi.fn().mockRejectedValue(new Error('LLM down')),
    });
    const result = await handleStartClassification(ctx);

    // Should still transition but mark for human triage
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(
      true,
    );
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});
