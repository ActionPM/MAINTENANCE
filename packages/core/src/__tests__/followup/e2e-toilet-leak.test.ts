import { describe, it, expect, vi } from 'vitest';
import { ConversationState, loadTaxonomy, DEFAULT_FOLLOWUP_CAPS } from '@wo-agent/schemas';
import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { CueDictionary, IssueClassifierOutput, FollowUpQuestion } from '@wo-agent/schemas';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cueJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../schemas/classification_cues.json'), 'utf-8'),
);
const taxonomy = loadTaxonomy();

/**
 * Relaxed confidence config: low medium_threshold so that fields with
 * high model_confidence pass, while genuinely unknown fields still need input.
 */
const RELAXED_CONFIDENCE: ConfidenceConfig = {
  high_threshold: 0.85,
  medium_threshold: 0.3,
  model_hint_min: 0.2,
  model_hint_max: 0.95,
  weights: {
    cue_strength: 0.4,
    completeness: 0.25,
    model_hint: 0.2,
    constraint_implied: 0.25,
    disagreement: 0.1,
    ambiguity_penalty: 0.05,
  },
};

/** Answer mapping: field_target → answer value for the tenant. */
const TENANT_ANSWERS: Record<string, string> = {
  Location: 'suite',
  Maintenance_Object: 'toilet',
  Priority: 'high',
  Sub_Location: 'bathroom',
  Maintenance_Category: 'plumbing',
};

/**
 * E2E integration test: "toilet leak" scenario.
 *
 * Verifies the full constraint resolution pipeline:
 * 1. "I have a leak" → classifier returns vague/low-confidence fields
 * 2. Follow-up asks about uncertain fields
 * 3. Tenant answers (Location=suite, Object=toilet, etc.)
 * 4. Re-classification → Sub_Location auto-resolved to bathroom via constraints
 * 5. State → tenant_confirmation_pending (no unnecessary follow-up round)
 */
describe('e2e toilet leak scenario', () => {
  const ISSUE_ID = 'issue-toilet-1';
  const CONV_ID = 'conv-e2e-1';

  function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
    return {
      conversation_id: CONV_ID,
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      state: ConversationState.CLASSIFICATION_IN_PROGRESS,
      unit_id: 'u1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test-model',
        prompt_version: '1.0.0',
      },
      split_issues: [
        {
          issue_id: ISSUE_ID,
          summary: 'Tenant reports a leak',
          raw_excerpt: 'I have a leak',
        },
      ],
      classification_results: null,
      prior_state_before_error: null,
      followup_turn_number: 0,
      total_questions_asked: 0,
      previous_questions: [],
      pending_followup_questions: null,
      draft_photo_ids: [],
      created_at: '2026-03-05T10:00:00Z',
      last_activity_at: '2026-03-05T10:00:00Z',
      confirmation_entered_at: null,
      source_text_hash: null,
      split_hash: null,
      confirmation_presented: false,
      property_id: 'prop-1',
      client_id: 'client-1',
      risk_triggers: [],
      escalation_state: 'none',
      escalation_plan_id: null,
      ...overrides,
    };
  }

  it('full flow: classify → followup → answer → resolve Sub_Location via constraints → confirmation', async () => {
    let followUpCallCount = 0;

    // Phase 1: vague classification with low confidence on key fields
    const phase1Output: IssueClassifierOutput = {
      issue_id: ISSUE_ID,
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'general',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'needs_object',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.05,
        Sub_Location: 0.05,
        Maintenance_Category: 0.85,
        Maintenance_Object: 0.05,
        Maintenance_Problem: 0.9,
        Priority: 0.05,
      },
      missing_fields: [],
      needs_human_triage: false,
    };

    // Phase 2: complete classification after tenant answers
    const phase2Output: IssueClassifierOutput = {
      issue_id: ISSUE_ID,
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'general', // vague — resolved to bathroom by constraints
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'high',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.9,
        Sub_Location: 0.3,
        Maintenance_Category: 0.9,
        Maintenance_Object: 0.95,
        Maintenance_Problem: 0.95,
        Priority: 0.85,
      },
      missing_fields: [],
      needs_human_triage: false,
    };

    let classifierCallCount = 0;
    const mockClassifier = vi.fn(async () => {
      classifierCallCount++;
      if (classifierCallCount === 1) return phase1Output;
      return phase2Output;
    });

    // Follow-up generator returns exactly 3 questions (schema max).
    // The pipeline filters to only fields_needing_input.
    const followUpQuestions: FollowUpQuestion[] = [
      {
        question_id: 'q-loc',
        field_target: 'Location',
        prompt: 'Where?',
        options: ['suite', 'building_interior', 'building_exterior'],
        answer_type: 'enum' as const,
      },
      {
        question_id: 'q-sub',
        field_target: 'Sub_Location',
        prompt: 'Which room?',
        options: ['kitchen', 'bathroom', 'bedroom'],
        answer_type: 'enum' as const,
      },
      {
        question_id: 'q-obj',
        field_target: 'Maintenance_Object',
        prompt: 'What object?',
        options: ['toilet', 'sink', 'faucet', 'pipe', 'shower'],
        answer_type: 'enum' as const,
      },
    ];

    const mockFollowUpGenerator = vi.fn(async () => {
      followUpCallCount++;
      return { questions: followUpQuestions };
    });

    let idCounter = 0;
    const eventRepo = new InMemoryEventStore();
    const deps = {
      eventRepo,
      idGenerator: () => `id-${++idCounter}`,
      clock: () => '2026-03-05T10:01:00Z',
      issueClassifier: mockClassifier,
      followUpGenerator: mockFollowUpGenerator,
      cueDict: cueJson as CueDictionary,
      taxonomy,
      confidenceConfig: RELAXED_CONFIDENCE,
      followUpCaps: DEFAULT_FOLLOWUP_CAPS,
    };

    // ── Phase 1: Start classification ──
    const session1 = makeSession();
    const ctx1: ActionHandlerContext = {
      session: session1,
      request: { action_type: 'START_CLASSIFICATION', actor: 'system' } as any,
      deps: deps as any,
    };

    const result1 = await handleStartClassification(ctx1);

    // Should need tenant input (some fields have low confidence)
    expect(result1.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(followUpCallCount).toBe(1);

    const sessionAfterPhase1 = result1.session;
    const pendingQuestions = sessionAfterPhase1.pending_followup_questions!;
    expect(pendingQuestions.length).toBeGreaterThan(0);

    // ── Phase 2: Tenant answers ALL pending questions ──
    const answers = pendingQuestions.map((q) => ({
      question_id: q.question_id,
      answer: TENANT_ANSWERS[q.field_target] ?? 'unknown',
    }));

    const sessionForAnswer = {
      ...sessionAfterPhase1,
      state: ConversationState.NEEDS_TENANT_INPUT,
    };

    const ctx2: ActionHandlerContext = {
      session: sessionForAnswer,
      request: {
        action_type: 'ANSWER_FOLLOWUPS',
        actor: 'tenant',
        tenant_input: { answers },
      } as any,
      deps: deps as any,
    };

    const result2 = await handleAnswerFollowups(ctx2);

    // With the updated confidence policy (spec §14.3), medium-confidence
    // required/risk-relevant fields that weren't directly answered by the tenant
    // (e.g., Category, Maintenance_Problem) still need input. The handler calls
    // the follow-up generator a second time, but the mock returns questions
    // targeting already-answered fields, which are filtered out. The empty
    // filtered result triggers the escape hatch → tenant_confirmation_pending
    // with needs_human_triage for remaining uncertain fields.
    expect(result2.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);

    // Follow-up generator is called a second time for the remaining fields,
    // but its questions are filtered out (targeting already-resolved fields).
    expect(followUpCallCount).toBe(2);

    // ── Verify constraint resolution ──
    const finalSession = result2.session;
    const finalResults = finalSession.classification_results;
    expect(finalResults).toBeDefined();
    expect(finalResults!.length).toBe(1);

    const finalClassification = finalResults![0].classifierOutput.classification;

    // Sub_Location resolved to "bathroom" via Maintenance_Object→Sub_Location constraint
    expect(finalClassification.Sub_Location).toBe('bathroom');
    expect(finalClassification.Category).toBe('maintenance');
    expect(finalClassification.Location).toBe('suite');
    expect(finalClassification.Maintenance_Object).toBe('toilet');
    expect(finalClassification.Maintenance_Problem).toBe('leak');
    expect(finalClassification.Priority).toBe('high');

    // ── Verify constraint resolution event was logged ──
    const events = await eventRepo.queryAll(CONV_ID);
    const resolutionEvents = events.filter(
      (e: any) => e.event_type === 'classification_constraint_resolution',
    );
    expect(resolutionEvents.length).toBe(1);
    expect((resolutionEvents[0] as any).payload.resolved_fields.Sub_Location).toBe('bathroom');

    // No hierarchy violations
    const violationEvents = events.filter(
      (e: any) => e.event_type === 'classification_hierarchy_violation_unresolved',
    );
    expect(violationEvents.length).toBe(0);
  });
});
