# Phase 6: Follow-Up Generator + Termination Caps + followup_events + Tests

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Implement the FollowUpGenerator LLM tool with termination cap enforcement, wire follow-up question generation into the classification→follow-up loop, record all follow-up turns in append-only `followup_events`, and handle the escape hatch when caps are exhausted.

**Architecture:** The FollowUpGenerator is injected into the orchestrator as a dependency (`OrchestratorDependencies.followUpGenerator`). When classification determines fields need tenant input (state = `needs_tenant_input`), the orchestrator calls FollowUpGenerator to produce targeted questions. Questions are presented to the tenant as UI quick-replies. When the tenant answers (`ANSWER_FOLLOWUPS`), the handler: (1) records a followup_event with questions + answers, (2) updates session tracking, (3) checks termination caps, (4) re-classifies with enriched input. If caps are exhausted and fields remain incomplete, the escape hatch creates a WO with `needs_human_triage = true`.

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema validation), `@wo-agent/schemas` validators

**Prerequisite:** Phase 5 classifier must be merged. This plan branches from `feature/phase-05-classifier`.

**Spec references:** §2 (non-negotiables), §7.1 (followup_events schema), §10 (orchestrator contract), §11.2 (transition matrix), §15 (follow-ups, termination caps)

**Skills that apply during execution:**
- `@test-driven-development` — every task follows red-green-refactor
- `@state-machine-implementation` — any state transition changes
- `@schema-first-development` — all model outputs validated
- `@llm-tool-contracts` — FollowUpGenerator schema-lock, caps enforcement, followup_events recording
- `@append-only-events` — followup_events INSERT-only
- `@project-conventions` — naming, structure, commands

---

## Task 0: Create worktree and branch from Phase 5

**Files:**
- N/A (git operations only)

**Step 1: Create worktree branching from Phase 5 classifier**

```bash
cd /workspaces/MAINTENANCE
git worktree add .worktrees/phase-06-followup feature/phase-05-classifier -b feature/phase-06-followup
```

**Step 2: Verify the worktree has Phase 5 code**

```bash
ls .worktrees/phase-06-followup/packages/core/src/classifier/
```

Expected: `cue-scoring.ts`, `confidence.ts`, `issue-classifier.ts`, `index.ts`

**Step 3: Install dependencies**

```bash
cd .worktrees/phase-06-followup && pnpm install
```

**Step 4: Run existing tests to confirm green baseline**

```bash
pnpm -r test
```

Expected: All tests pass.

**Step 5: Commit — no code changes, just branch creation**

No commit needed — branch created from Phase 5 HEAD.

---

## Task 1: Implement follow-up caps enforcement function

**Files:**
- Create: `packages/core/src/followup/caps.ts`
- Test: `packages/core/src/__tests__/followup/caps.test.ts`

**Context:** The caps enforcement function is pure deterministic code. It checks the four termination caps defined in spec §15 and `DEFAULT_FOLLOWUP_CAPS`: max 3 questions per turn, max 8 turns, max 9 total questions, max 2 re-asks per field. It returns which fields can still be asked about and whether the escape hatch should trigger. This function is called BEFORE invoking the FollowUpGenerator LLM tool and AFTER receiving its output (to truncate excess questions).

**Spec reference:** §15 — "Termination caps: 8 turns, 9 questions, max 2 re-asks per field. Escape hatch: create WO with needs_human_triage if still incomplete."

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/followup/caps.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  checkFollowUpCaps,
  filterEligibleFields,
  truncateQuestions,
} from '../../followup/caps.js';
import { DEFAULT_FOLLOWUP_CAPS } from '@wo-agent/schemas';
import type { FollowUpQuestion, PreviousQuestion, FollowUpCaps } from '@wo-agent/schemas';

const caps = DEFAULT_FOLLOWUP_CAPS;

describe('checkFollowUpCaps', () => {
  it('returns canContinue=true when under all caps', () => {
    const result = checkFollowUpCaps({
      turnNumber: 1,
      totalQuestionsAsked: 0,
      previousQuestions: [],
      fieldsNeedingInput: ['Priority', 'Location'],
      caps,
    });
    expect(result.canContinue).toBe(true);
    expect(result.escapeHatch).toBe(false);
    expect(result.remainingQuestionBudget).toBe(3); // min(3 per turn, 9 - 0 total)
  });

  it('returns escapeHatch=true when turn_number exceeds max_turns', () => {
    const result = checkFollowUpCaps({
      turnNumber: 9, // exceeds max_turns=8
      totalQuestionsAsked: 5,
      previousQuestions: [],
      fieldsNeedingInput: ['Priority'],
      caps,
    });
    expect(result.canContinue).toBe(false);
    expect(result.escapeHatch).toBe(true);
    expect(result.reason).toContain('max_turns');
  });

  it('returns escapeHatch=true when total questions exhausted', () => {
    const result = checkFollowUpCaps({
      turnNumber: 4,
      totalQuestionsAsked: 9, // at max
      previousQuestions: [],
      fieldsNeedingInput: ['Priority'],
      caps,
    });
    expect(result.canContinue).toBe(false);
    expect(result.escapeHatch).toBe(true);
    expect(result.reason).toContain('max_total_questions');
  });

  it('limits remaining budget to max_questions_per_turn', () => {
    const result = checkFollowUpCaps({
      turnNumber: 1,
      totalQuestionsAsked: 0,
      previousQuestions: [],
      fieldsNeedingInput: ['A', 'B', 'C', 'D', 'E'],
      caps,
    });
    expect(result.remainingQuestionBudget).toBe(3);
  });

  it('limits remaining budget to total questions remaining', () => {
    const result = checkFollowUpCaps({
      turnNumber: 4,
      totalQuestionsAsked: 7, // only 2 left
      previousQuestions: [],
      fieldsNeedingInput: ['A', 'B', 'C'],
      caps,
    });
    expect(result.remainingQuestionBudget).toBe(2);
  });

  it('returns escapeHatch when no eligible fields remain', () => {
    const result = checkFollowUpCaps({
      turnNumber: 2,
      totalQuestionsAsked: 2,
      previousQuestions: [
        { field_target: 'Priority', times_asked: 2 }, // maxed out
      ],
      fieldsNeedingInput: ['Priority'], // only field, but maxed
      caps,
    });
    expect(result.canContinue).toBe(false);
    expect(result.escapeHatch).toBe(true);
    expect(result.eligibleFields).toEqual([]);
  });
});

describe('filterEligibleFields', () => {
  it('excludes fields at max re-ask limit', () => {
    const result = filterEligibleFields(
      ['Priority', 'Location', 'Category'],
      [
        { field_target: 'Priority', times_asked: 2 },
        { field_target: 'Location', times_asked: 1 },
      ],
      caps,
    );
    expect(result).toEqual(['Location', 'Category']);
  });

  it('includes fields not yet asked', () => {
    const result = filterEligibleFields(
      ['Priority', 'Location'],
      [],
      caps,
    );
    expect(result).toEqual(['Priority', 'Location']);
  });

  it('excludes all fields when all maxed', () => {
    const result = filterEligibleFields(
      ['Priority'],
      [{ field_target: 'Priority', times_asked: 2 }],
      caps,
    );
    expect(result).toEqual([]);
  });
});

describe('truncateQuestions', () => {
  it('passes through when under budget', () => {
    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'Priority', prompt: 'What priority?', options: ['low', 'normal', 'high'], answer_type: 'enum' },
    ];
    const result = truncateQuestions(questions, 3);
    expect(result).toHaveLength(1);
  });

  it('truncates to budget', () => {
    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'A', prompt: 'Q1?', options: [], answer_type: 'text' },
      { question_id: 'q2', field_target: 'B', prompt: 'Q2?', options: [], answer_type: 'text' },
      { question_id: 'q3', field_target: 'C', prompt: 'Q3?', options: [], answer_type: 'text' },
      { question_id: 'q4', field_target: 'D', prompt: 'Q4?', options: [], answer_type: 'text' },
    ];
    const result = truncateQuestions(questions, 2);
    expect(result).toHaveLength(2);
    expect(result[0].question_id).toBe('q1');
    expect(result[1].question_id).toBe('q2');
  });

  it('returns empty array when budget is 0', () => {
    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'A', prompt: 'Q1?', options: [], answer_type: 'text' },
    ];
    const result = truncateQuestions(questions, 0);
    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/caps.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/followup/caps.ts`:

```typescript
import type { FollowUpCaps, FollowUpQuestion, PreviousQuestion } from '@wo-agent/schemas';

export interface CapsCheckInput {
  readonly turnNumber: number;
  readonly totalQuestionsAsked: number;
  readonly previousQuestions: readonly PreviousQuestion[];
  readonly fieldsNeedingInput: readonly string[];
  readonly caps: FollowUpCaps;
}

export interface CapsCheckResult {
  /** Whether we can generate more follow-up questions */
  readonly canContinue: boolean;
  /** Whether the escape hatch should trigger (caps exhausted, fields still incomplete) */
  readonly escapeHatch: boolean;
  /** Fields that are eligible for follow-up (not maxed on re-asks) */
  readonly eligibleFields: readonly string[];
  /** Max questions we can ask this turn */
  readonly remainingQuestionBudget: number;
  /** Human-readable reason if canContinue is false */
  readonly reason?: string;
}

/**
 * Check follow-up termination caps (spec §15).
 * Called BEFORE invoking FollowUpGenerator to determine if we should continue
 * or trigger the escape hatch.
 */
export function checkFollowUpCaps(input: CapsCheckInput): CapsCheckResult {
  const { turnNumber, totalQuestionsAsked, previousQuestions, fieldsNeedingInput, caps } = input;

  // Cap 1: max turns
  if (turnNumber > caps.max_turns) {
    return {
      canContinue: false,
      escapeHatch: true,
      eligibleFields: [],
      remainingQuestionBudget: 0,
      reason: `max_turns exceeded (${turnNumber} > ${caps.max_turns})`,
    };
  }

  // Cap 2: max total questions
  if (totalQuestionsAsked >= caps.max_total_questions) {
    return {
      canContinue: false,
      escapeHatch: true,
      eligibleFields: [],
      remainingQuestionBudget: 0,
      reason: `max_total_questions reached (${totalQuestionsAsked} >= ${caps.max_total_questions})`,
    };
  }

  // Cap 4: filter out fields at max re-ask limit
  const eligibleFields = filterEligibleFields(fieldsNeedingInput, previousQuestions, caps);

  if (eligibleFields.length === 0) {
    return {
      canContinue: false,
      escapeHatch: true,
      eligibleFields: [],
      remainingQuestionBudget: 0,
      reason: 'no eligible fields remain (all at max re-ask limit)',
    };
  }

  // Cap 3: remaining question budget = min(per-turn cap, total remaining)
  const totalRemaining = caps.max_total_questions - totalQuestionsAsked;
  const remainingQuestionBudget = Math.min(caps.max_questions_per_turn, totalRemaining);

  return {
    canContinue: true,
    escapeHatch: false,
    eligibleFields,
    remainingQuestionBudget,
  };
}

/**
 * Filter fields to only those eligible for follow-up (not at max re-ask limit).
 * Spec §15: "max 2 re-asks per field"
 */
export function filterEligibleFields(
  fieldsNeedingInput: readonly string[],
  previousQuestions: readonly PreviousQuestion[],
  caps: FollowUpCaps,
): string[] {
  const askCounts = new Map<string, number>();
  for (const pq of previousQuestions) {
    askCounts.set(pq.field_target, pq.times_asked);
  }

  return fieldsNeedingInput.filter(
    (field) => (askCounts.get(field) ?? 0) < caps.max_reasks_per_field,
  );
}

/**
 * Truncate follow-up questions to the remaining budget (spec §15).
 * Called AFTER receiving FollowUpGenerator output to enforce per-turn cap.
 */
export function truncateQuestions(
  questions: readonly FollowUpQuestion[],
  budget: number,
): readonly FollowUpQuestion[] {
  return questions.slice(0, budget);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/caps.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/followup/caps.ts packages/core/src/__tests__/followup/caps.test.ts
git commit -m "feat(core): add follow-up caps enforcement (spec §15)"
```

---

## Task 2: Implement FollowUpGenerator LLM tool wrapper with validation pipeline

**Files:**
- Create: `packages/core/src/followup/followup-generator.ts`
- Test: `packages/core/src/__tests__/followup/followup-generator.test.ts`

**Context:** This wraps the raw FollowUpGenerator LLM call with the full validation pipeline from the `@llm-tool-contracts` skill: schema validate → accept or retry → fail. It follows the same pattern as `callIssueClassifier` in `packages/core/src/classifier/issue-classifier.ts`. The output must validate against `followups.schema.json`. After validation, questions are truncated to the remaining budget. The tool itself has no side effects — the orchestrator handles state, events, and follow-up tracking.

**Spec references:** §15 (follow-ups), `@llm-tool-contracts` (validation pipeline)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/followup/followup-generator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  callFollowUpGenerator,
  FollowUpGeneratorError,
  FollowUpGeneratorErrorCode,
} from '../../followup/followup-generator.js';
import type { FollowUpGeneratorInput, FollowUpGeneratorOutput, FollowUpQuestion } from '@wo-agent/schemas';

const VALID_INPUT: FollowUpGeneratorInput = {
  issue_id: 'issue-1',
  classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
  confidence_by_field: { Category: 0.9, Maintenance_Category: 0.5, Priority: 0.4 },
  missing_fields: [],
  fields_needing_input: ['Maintenance_Category', 'Priority'],
  previous_questions: [],
  turn_number: 1,
  total_questions_asked: 0,
  taxonomy_version: '1.0.0',
  prompt_version: '1.0.0',
};

const VALID_OUTPUT: FollowUpGeneratorOutput = {
  questions: [
    {
      question_id: 'q1',
      field_target: 'Maintenance_Category',
      prompt: 'What type of maintenance issue is this?',
      options: ['plumbing', 'electrical', 'hvac', 'other'],
      answer_type: 'enum',
    },
    {
      question_id: 'q2',
      field_target: 'Priority',
      prompt: 'How urgent is this issue?',
      options: ['low', 'normal', 'high', 'emergency'],
      answer_type: 'enum',
    },
  ],
};

describe('callFollowUpGenerator', () => {
  it('returns valid output on first attempt', async () => {
    const llmCall = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(2);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries once on schema validation failure then succeeds', async () => {
    const badOutput = { questions: [{ question_id: 'q1' }] }; // missing required fields
    const llmCall = vi.fn()
      .mockResolvedValueOnce(badOutput)
      .mockResolvedValueOnce(VALID_OUTPUT);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('returns llm_fail after two schema validation failures', async () => {
    const badOutput = { questions: [{ question_id: 'q1' }] };
    const llmCall = vi.fn().mockResolvedValue(badOutput);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 3);
    expect(result.status).toBe('llm_fail');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws FollowUpGeneratorError on LLM call exception', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(
      callFollowUpGenerator(VALID_INPUT, llmCall, 3),
    ).rejects.toThrow(FollowUpGeneratorError);
  });

  it('truncates questions to remaining budget', async () => {
    const fourQuestions: FollowUpGeneratorOutput = {
      questions: [
        { question_id: 'q1', field_target: 'A', prompt: 'Q1?', options: [], answer_type: 'text' },
        { question_id: 'q2', field_target: 'B', prompt: 'Q2?', options: [], answer_type: 'text' },
        { question_id: 'q3', field_target: 'C', prompt: 'Q3?', options: [], answer_type: 'text' },
      ],
    };
    const llmCall = vi.fn().mockResolvedValue(fourQuestions);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 2);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(2);
  });

  it('filters out questions targeting ineligible fields', async () => {
    const inputWithRestricted: FollowUpGeneratorInput = {
      ...VALID_INPUT,
      fields_needing_input: ['Priority'], // only Priority eligible
    };
    const outputWithExtra: FollowUpGeneratorOutput = {
      questions: [
        { question_id: 'q1', field_target: 'Maintenance_Category', prompt: 'Category?', options: [], answer_type: 'enum' },
        { question_id: 'q2', field_target: 'Priority', prompt: 'Priority?', options: ['low', 'high'], answer_type: 'enum' },
      ],
    };
    const llmCall = vi.fn().mockResolvedValue(outputWithExtra);
    const result = await callFollowUpGenerator(inputWithRestricted, llmCall, 3);
    expect(result.status).toBe('ok');
    // Should filter to only the eligible field
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Priority');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/followup-generator.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/followup/followup-generator.ts`:

```typescript
import type { FollowUpGeneratorInput, FollowUpGeneratorOutput, FollowUpQuestion } from '@wo-agent/schemas';
import { validateFollowUpOutput } from '@wo-agent/schemas';
import { truncateQuestions } from './caps.js';

export enum FollowUpGeneratorErrorCode {
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  LLM_CALL_FAILED = 'LLM_CALL_FAILED',
}

export class FollowUpGeneratorError extends Error {
  constructor(
    public readonly code: FollowUpGeneratorErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FollowUpGeneratorError';
  }
}

export interface FollowUpGeneratorResult {
  readonly status: 'ok' | 'llm_fail';
  readonly output?: FollowUpGeneratorOutput;
  readonly error?: string;
}

type LlmFollowUpFn = (
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
) => Promise<unknown>;

/**
 * Call the FollowUpGenerator LLM tool with schema validation pipeline.
 *
 * Pipeline: LLM call → schema validate → filter ineligible fields → truncate to budget → accept
 * Schema failure: one retry with error context → llm_fail
 * LLM exception: throw immediately
 *
 * @param input - validated FollowUpGeneratorInput
 * @param llmCall - the raw LLM function
 * @param remainingBudget - max questions this turn (from caps check)
 */
export async function callFollowUpGenerator(
  input: FollowUpGeneratorInput,
  llmCall: LlmFollowUpFn,
  remainingBudget: number,
): Promise<FollowUpGeneratorResult> {
  const eligibleFields = new Set(input.fields_needing_input);
  let validated: FollowUpGeneratorOutput | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await llmCall(
        input,
        attempt > 0 ? { retryHint: 'schema_errors' } : undefined,
      );
    } catch (err) {
      throw new FollowUpGeneratorError(
        FollowUpGeneratorErrorCode.LLM_CALL_FAILED,
        `FollowUpGenerator LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const schemaResult = validateFollowUpOutput(raw);
    if (!schemaResult.valid) {
      lastError = schemaResult.errors;
      continue;
    }

    validated = schemaResult.data!;
    break;
  }

  if (validated === null) {
    return {
      status: 'llm_fail',
      error: `FollowUpGenerator output failed schema validation after retry: ${JSON.stringify(lastError)}`,
    };
  }

  // Filter out questions targeting fields not in fields_needing_input
  const filteredQuestions = validated.questions.filter(
    (q) => eligibleFields.has(q.field_target),
  );

  // Truncate to remaining budget (spec §15: max 3 per turn)
  const finalQuestions = truncateQuestions(filteredQuestions, remainingBudget);

  return {
    status: 'ok',
    output: { questions: finalQuestions as FollowUpQuestion[] },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/followup-generator.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/followup/followup-generator.ts packages/core/src/__tests__/followup/followup-generator.test.ts
git commit -m "feat(core): add FollowUpGenerator wrapper with validation pipeline"
```

---

## Task 3: Implement follow-up event builder

**Files:**
- Create: `packages/core/src/followup/event-builder.ts`
- Test: `packages/core/src/__tests__/followup/event-builder.test.ts`

**Context:** Follow-up events are append-only (spec §7, `@append-only-events` skill). Each follow-up turn produces a `FollowUpEvent` that records the questions asked and (when available) the answers received. Two events per turn: (1) when questions are generated (answers_received = null), (2) when tenant answers (answers_received populated). The event builder creates and validates events using the existing `validateFollowUpEvent` from `@wo-agent/schemas`.

**Spec reference:** §7.1 — followup_events minimum schema

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/followup/event-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildFollowUpQuestionsEvent,
  buildFollowUpAnswersEvent,
} from '../../followup/event-builder.js';
import type { FollowUpQuestion, FollowUpEvent } from '@wo-agent/schemas';
import { validateFollowUpEvent } from '@wo-agent/schemas';

const QUESTIONS: FollowUpQuestion[] = [
  {
    question_id: 'q1',
    field_target: 'Priority',
    prompt: 'How urgent is this?',
    options: ['low', 'normal', 'high'],
    answer_type: 'enum',
  },
];

describe('buildFollowUpQuestionsEvent', () => {
  it('creates a valid FollowUpEvent with questions and null answers', () => {
    const event = buildFollowUpQuestionsEvent({
      eventId: 'evt-1',
      conversationId: 'conv-1',
      issueId: 'issue-1',
      turnNumber: 1,
      questions: QUESTIONS,
      createdAt: '2026-02-25T12:00:00.000Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.issue_id).toBe('issue-1');
    expect(event.turn_number).toBe(1);
    expect(event.questions_asked).toEqual(QUESTIONS);
    expect(event.answers_received).toBeNull();
    expect(event.created_at).toBe('2026-02-25T12:00:00.000Z');

    // Must pass schema validation
    const validation = validateFollowUpEvent(event);
    expect(validation.valid).toBe(true);
  });
});

describe('buildFollowUpAnswersEvent', () => {
  it('creates a valid FollowUpEvent with questions and answers', () => {
    const event = buildFollowUpAnswersEvent({
      eventId: 'evt-2',
      conversationId: 'conv-1',
      issueId: 'issue-1',
      turnNumber: 1,
      questions: QUESTIONS,
      answers: [
        { question_id: 'q1', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' },
      ],
      createdAt: '2026-02-25T12:05:00.000Z',
    });

    expect(event.event_id).toBe('evt-2');
    expect(event.answers_received).toHaveLength(1);
    expect(event.answers_received![0].answer).toBe('normal');

    // Must pass schema validation
    const validation = validateFollowUpEvent(event);
    expect(validation.valid).toBe(true);
  });

  it('rejects mismatched question_id in answers', () => {
    expect(() =>
      buildFollowUpAnswersEvent({
        eventId: 'evt-3',
        conversationId: 'conv-1',
        issueId: 'issue-1',
        turnNumber: 1,
        questions: QUESTIONS,
        answers: [
          { question_id: 'nonexistent', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' },
        ],
        createdAt: '2026-02-25T12:05:00.000Z',
      }),
    ).toThrow(/question_id .* does not match/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/event-builder.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/followup/event-builder.ts`:

```typescript
import type { FollowUpEvent, FollowUpQuestion, AnswerReceived } from '@wo-agent/schemas';

export interface QuestionsEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly issueId: string;
  readonly turnNumber: number;
  readonly questions: readonly FollowUpQuestion[];
  readonly createdAt: string;
}

export interface AnswersEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly issueId: string;
  readonly turnNumber: number;
  readonly questions: readonly FollowUpQuestion[];
  readonly answers: readonly AnswerReceived[];
  readonly createdAt: string;
}

/**
 * Build a followup_event recording that questions were asked (spec §7.1).
 * answers_received is null — the tenant hasn't responded yet.
 * This event is append-only (INSERT only, never updated).
 */
export function buildFollowUpQuestionsEvent(input: QuestionsEventInput): FollowUpEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    issue_id: input.issueId,
    turn_number: input.turnNumber,
    questions_asked: [...input.questions],
    answers_received: null,
    created_at: input.createdAt,
  };
}

/**
 * Build a followup_event recording that the tenant answered (spec §7.1).
 * Both questions and answers are recorded for full traceability.
 * This is a NEW event — the previous "questions asked" event is immutable.
 */
export function buildFollowUpAnswersEvent(input: AnswersEventInput): FollowUpEvent {
  // Validate that all answer question_ids match questions_asked
  const questionIds = new Set(input.questions.map((q) => q.question_id));
  for (const answer of input.answers) {
    if (!questionIds.has(answer.question_id)) {
      throw new Error(
        `question_id "${answer.question_id}" does not match any question in questions_asked`,
      );
    }
  }

  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    issue_id: input.issueId,
    turn_number: input.turnNumber,
    questions_asked: [...input.questions],
    answers_received: [...input.answers],
    created_at: input.createdAt,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/event-builder.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/followup/event-builder.ts packages/core/src/__tests__/followup/event-builder.test.ts
git commit -m "feat(core): add follow-up event builder (append-only, spec §7.1)"
```

---

## Task 4: Extend ConversationSession with follow-up tracking fields

**Files:**
- Modify: `packages/core/src/session/types.ts`
- Modify: `packages/core/src/session/session.ts`
- Modify: `packages/core/src/session/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/followup/session-followup.test.ts`

**Context:** The session needs follow-up tracking state to persist across the classification→follow-up→re-classification cycle. Three new fields: `followup_turn_number` (current turn, 1-indexed), `total_questions_asked` (running total), and `previous_questions` (per-field ask counts for re-ask limit). Also `pending_followup_questions` to store the current questions awaiting answers. Follow the pattern from `split_issues` and `classification_results`.

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/followup/session-followup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createSession, updateFollowUpTracking, setPendingFollowUpQuestions } from '../../session/session.js';
import type { FollowUpQuestion, PreviousQuestion } from '@wo-agent/schemas';

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test',
  prompt_version: '1.0.0',
};

describe('follow-up tracking on session', () => {
  it('initializes with default follow-up tracking values', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    expect(session.followup_turn_number).toBe(0);
    expect(session.total_questions_asked).toBe(0);
    expect(session.previous_questions).toEqual([]);
    expect(session.pending_followup_questions).toBeNull();
  });
});

describe('updateFollowUpTracking', () => {
  it('increments turn number and total questions asked', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'Priority', prompt: 'Priority?', options: ['low', 'high'], answer_type: 'enum' },
      { question_id: 'q2', field_target: 'Location', prompt: 'Location?', options: ['suite', 'common'], answer_type: 'enum' },
    ];

    session = updateFollowUpTracking(session, questions);

    expect(session.followup_turn_number).toBe(1);
    expect(session.total_questions_asked).toBe(2);
    expect(session.previous_questions).toEqual([
      { field_target: 'Priority', times_asked: 1 },
      { field_target: 'Location', times_asked: 1 },
    ]);
  });

  it('increments times_asked for previously asked fields', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    // First turn: ask about Priority
    const turn1: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'Priority', prompt: 'Priority?', options: [], answer_type: 'enum' },
    ];
    session = updateFollowUpTracking(session, turn1);
    expect(session.previous_questions).toEqual([
      { field_target: 'Priority', times_asked: 1 },
    ]);

    // Second turn: ask about Priority again + Location
    const turn2: FollowUpQuestion[] = [
      { question_id: 'q2', field_target: 'Priority', prompt: 'Priority again?', options: [], answer_type: 'enum' },
      { question_id: 'q3', field_target: 'Location', prompt: 'Location?', options: [], answer_type: 'enum' },
    ];
    session = updateFollowUpTracking(session, turn2);
    expect(session.followup_turn_number).toBe(2);
    expect(session.total_questions_asked).toBe(3);
    expect(session.previous_questions).toContainEqual({ field_target: 'Priority', times_asked: 2 });
    expect(session.previous_questions).toContainEqual({ field_target: 'Location', times_asked: 1 });
  });
});

describe('setPendingFollowUpQuestions', () => {
  it('stores pending questions on session', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'Priority', prompt: 'Priority?', options: ['low', 'high'], answer_type: 'enum' },
    ];

    session = setPendingFollowUpQuestions(session, questions);
    expect(session.pending_followup_questions).toEqual(questions);
  });

  it('allows clearing pending questions with null', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    session = setPendingFollowUpQuestions(session, [
      { question_id: 'q1', field_target: 'Priority', prompt: '?', options: [], answer_type: 'text' },
    ]);
    session = setPendingFollowUpQuestions(session, null);
    expect(session.pending_followup_questions).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/session-followup.test.ts`
Expected: FAIL — new fields and functions not found

**Step 3: Add follow-up tracking fields to ConversationSession type**

In `packages/core/src/session/types.ts`, add to `ConversationSession`:

```typescript
readonly followup_turn_number: number;
readonly total_questions_asked: number;
readonly previous_questions: readonly PreviousQuestion[];
readonly pending_followup_questions: readonly FollowUpQuestion[] | null;
```

Add imports:

```typescript
import type { PreviousQuestion, FollowUpQuestion } from '@wo-agent/schemas';
```

**Step 4: Update createSession to initialize follow-up tracking**

In `packages/core/src/session/session.ts`, in `createSession()`, add:

```typescript
followup_turn_number: 0,
total_questions_asked: 0,
previous_questions: [],
pending_followup_questions: null,
```

**Step 5: Implement updateFollowUpTracking and setPendingFollowUpQuestions**

In `packages/core/src/session/session.ts`:

```typescript
import type { FollowUpQuestion, PreviousQuestion } from '@wo-agent/schemas';

/**
 * Update session follow-up tracking after generating questions for a turn.
 * Increments turn number, total questions asked, and per-field ask counts.
 */
export function updateFollowUpTracking(
  session: ConversationSession,
  questionsAsked: readonly FollowUpQuestion[],
): ConversationSession {
  const newTurn = session.followup_turn_number + 1;
  const newTotal = session.total_questions_asked + questionsAsked.length;

  // Update per-field ask counts
  const askCounts = new Map<string, number>();
  for (const pq of session.previous_questions) {
    askCounts.set(pq.field_target, pq.times_asked);
  }
  for (const q of questionsAsked) {
    askCounts.set(q.field_target, (askCounts.get(q.field_target) ?? 0) + 1);
  }
  const updatedPrevious: PreviousQuestion[] = Array.from(askCounts.entries()).map(
    ([field_target, times_asked]) => ({ field_target, times_asked }),
  );

  return {
    ...session,
    followup_turn_number: newTurn,
    total_questions_asked: newTotal,
    previous_questions: updatedPrevious,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Store pending follow-up questions awaiting tenant answers.
 */
export function setPendingFollowUpQuestions(
  session: ConversationSession,
  questions: readonly FollowUpQuestion[] | null,
): ConversationSession {
  return {
    ...session,
    pending_followup_questions: questions ? [...questions] : null,
    last_activity_at: new Date().toISOString(),
  };
}
```

**Step 6: Export new functions from session/index.ts and core/index.ts**

In `packages/core/src/session/index.ts`, add `updateFollowUpTracking` and `setPendingFollowUpQuestions` to exports.

In `packages/core/src/index.ts`, add them to the Session export block.

**Step 7: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/session-followup.test.ts`
Expected: PASS

**Step 8: Run full test suite and fix regressions**

Run: `pnpm -r test`

If any existing tests fail due to deep equality on session shape, add the new fields with their defaults:
```typescript
followup_turn_number: 0,
total_questions_asked: 0,
previous_questions: [],
pending_followup_questions: null,
```

**Step 9: Commit**

```bash
git add packages/core/src/session/types.ts packages/core/src/session/session.ts packages/core/src/session/index.ts packages/core/src/index.ts packages/core/src/__tests__/followup/session-followup.test.ts
git add -u # any test fixture fixes
git commit -m "feat(core): add follow-up tracking fields to ConversationSession"
```

---

## Task 5: Create followup barrel export and add followUpGenerator port to OrchestratorDependencies

**Files:**
- Create: `packages/core/src/followup/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/orchestrator/types.ts`
- Modify: All test files that create `OrchestratorDependencies` fixtures

**Context:** Wire the followup module into the core package exports and add the `followUpGenerator` port to `OrchestratorDependencies` so the orchestrator can call it. Follow the same pattern as the `issueClassifier` port from Phase 5 Task 4.

**Step 1: Create barrel export for followup module**

Create `packages/core/src/followup/index.ts`:

```typescript
export { checkFollowUpCaps, filterEligibleFields, truncateQuestions } from './caps.js';
export type { CapsCheckInput, CapsCheckResult } from './caps.js';

export {
  callFollowUpGenerator,
  FollowUpGeneratorError,
  FollowUpGeneratorErrorCode,
} from './followup-generator.js';
export type { FollowUpGeneratorResult } from './followup-generator.js';

export { buildFollowUpQuestionsEvent, buildFollowUpAnswersEvent } from './event-builder.js';
export type { QuestionsEventInput, AnswersEventInput } from './event-builder.js';
```

**Step 2: Add followup exports to packages/core/src/index.ts**

```typescript
// --- Follow-up ---
export {
  checkFollowUpCaps,
  filterEligibleFields,
  truncateQuestions,
  callFollowUpGenerator,
  FollowUpGeneratorError,
  FollowUpGeneratorErrorCode,
  buildFollowUpQuestionsEvent,
  buildFollowUpAnswersEvent,
} from './followup/index.js';
export type {
  CapsCheckInput,
  CapsCheckResult,
  FollowUpGeneratorResult,
  QuestionsEventInput,
  AnswersEventInput,
} from './followup/index.js';
```

**Step 3: Add followUpGenerator port to OrchestratorDependencies**

In `packages/core/src/orchestrator/types.ts`, add to `OrchestratorDependencies`:

```typescript
import type { FollowUpGeneratorInput } from '@wo-agent/schemas';

// Add to interface:
readonly followUpGenerator: (
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
) => Promise<unknown>;
```

**Step 4: Update all test fixtures that create OrchestratorDependencies**

In every test file that creates a `deps` object, add the stub:

```typescript
followUpGenerator: vi.fn().mockResolvedValue({
  questions: [
    {
      question_id: 'q1',
      field_target: 'Priority',
      prompt: 'How urgent is this?',
      options: ['low', 'normal', 'high'],
      answer_type: 'enum',
    },
  ],
}),
```

**Step 5: Run full test suite to verify no regressions**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/followup/index.ts packages/core/src/index.ts packages/core/src/orchestrator/types.ts
git add -u # test fixture updates
git commit -m "feat(core): add followup barrel export and followUpGenerator port to orchestrator"
```

---

## Task 6: Implement follow-up question generation in classification handler

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/start-classification.ts`
- Test: `packages/core/src/__tests__/followup/classification-followup.test.ts`

**Context:** When classification determines fields need tenant input (target state = `needs_tenant_input`), the handler must call FollowUpGenerator to produce questions, record a followup_event (questions asked, answers null), update session tracking, and include questions in the UI response. This extends the existing `handleStartClassification` from Phase 5 Task 6.

The flow within the handler when `anyFieldsNeedInput` is true:
1. Check caps via `checkFollowUpCaps` — if escape hatch, skip to human triage
2. Call `callFollowUpGenerator` with eligible fields
3. Record followup_event (questions asked) via event builder
4. Update session tracking (turn number, total questions, previous questions, pending questions)
5. Include questions as quick replies in UI response

**Spec references:** §15 (follow-ups), §7.1 (followup_events), §11.2 (needs_tenant_input state)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/followup/classification-followup.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { createSession, updateSessionState, setSplitIssues } from '../../session/session.js';
import { ConversationState, ActorType, DEFAULT_FOLLOWUP_CAPS, loadTaxonomy } from '@wo-agent/schemas';
import type { SplitIssue, IssueClassifierOutput, FollowUpGeneratorOutput, CueDictionary } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
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
      eventRepo: { append: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-25T12:00:00.000Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(LOW_CONF_CLASSIFICATION),
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
    expect(result.session.pending_followup_questions![0].field_target).toBe('Priority');
    // Session tracking should be updated
    expect(result.session.followup_turn_number).toBe(1);
    expect(result.session.total_questions_asked).toBe(1);
  });

  it('records a followup_event for questions asked', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);

    // eventRepo.append should have been called with a followup event
    expect(ctx.deps.eventRepo.append).toHaveBeenCalledWith(
      'followup_events',
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
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/classification-followup.test.ts`
Expected: FAIL — modified handler doesn't generate follow-ups yet

**Step 3: Extend handleStartClassification to generate follow-up questions**

In `packages/core/src/orchestrator/action-handlers/start-classification.ts`, after the existing classification loop determines `anyFieldsNeedInput = true` and before returning:

Add imports:

```typescript
import { checkFollowUpCaps } from '../../followup/caps.js';
import { callFollowUpGenerator, FollowUpGeneratorError } from '../../followup/followup-generator.js';
import { buildFollowUpQuestionsEvent } from '../../followup/event-builder.js';
import { updateFollowUpTracking, setPendingFollowUpQuestions } from '../../session/session.js';
import { DEFAULT_FOLLOWUP_CAPS } from '@wo-agent/schemas';
import type { FollowUpGeneratorInput, FollowUpCaps } from '@wo-agent/schemas';
```

After `setClassificationResults` and before the return when `anyFieldsNeedInput`:

```typescript
// --- Follow-up generation when fields need input ---
if (anyFieldsNeedInput) {
  const followUpCaps: FollowUpCaps = (deps as any).followUpCaps ?? DEFAULT_FOLLOWUP_CAPS;
  const allFieldsNeedingInput = classificationResults.flatMap(r => r.fieldsNeedingInput);

  const capsCheck = checkFollowUpCaps({
    turnNumber: updatedSession.followup_turn_number + 1,
    totalQuestionsAsked: updatedSession.total_questions_asked,
    previousQuestions: updatedSession.previous_questions,
    fieldsNeedingInput: allFieldsNeedingInput,
    caps: followUpCaps,
  });

  if (capsCheck.escapeHatch) {
    // Escape hatch: mark all issues as needs_human_triage
    const triageResults = classificationResults.map(r => ({
      ...r,
      classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
      fieldsNeedingInput: [],
    }));
    updatedSession = setClassificationResults(updatedSession, triageResults);

    return {
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
      uiMessages: [{
        role: 'agent',
        content: 'I\'ve classified your issue(s) but couldn\'t resolve all details. A human will review the remaining items.',
      }],
      eventPayload: { escape_hatch: true, reason: capsCheck.reason },
      eventType: 'state_transition',
    };
  }

  // Call FollowUpGenerator for the first issue with fields needing input
  const targetIssue = classificationResults.find(r => r.fieldsNeedingInput.length > 0)!;
  const followUpInput: FollowUpGeneratorInput = {
    issue_id: targetIssue.issue_id,
    classification: targetIssue.classifierOutput.classification,
    confidence_by_field: targetIssue.computedConfidence,
    missing_fields: [...targetIssue.classifierOutput.missing_fields],
    fields_needing_input: [...capsCheck.eligibleFields],
    previous_questions: [...updatedSession.previous_questions],
    turn_number: updatedSession.followup_turn_number + 1,
    total_questions_asked: updatedSession.total_questions_asked,
    taxonomy_version: session.pinned_versions.taxonomy_version,
    prompt_version: session.pinned_versions.prompt_version,
  };

  let followUpQuestions;
  try {
    const followUpResult = await callFollowUpGenerator(
      followUpInput,
      deps.followUpGenerator,
      capsCheck.remainingQuestionBudget,
    );

    if (followUpResult.status === 'llm_fail') {
      // FollowUp generation failed — fall through to escape hatch
      const triageResults = classificationResults.map(r => ({
        ...r,
        classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
        fieldsNeedingInput: [],
      }));
      updatedSession = setClassificationResults(updatedSession, triageResults);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [{
          role: 'agent',
          content: 'I\'ve classified your issue(s) but had trouble generating follow-up questions. A human will review.',
        }],
        eventPayload: { followup_generation_failed: true },
        eventType: 'state_transition',
      };
    }

    followUpQuestions = followUpResult.output!.questions;
  } catch {
    // LLM exception — escape hatch
    const triageResults = classificationResults.map(r => ({
      ...r,
      classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
      fieldsNeedingInput: [],
    }));
    updatedSession = setClassificationResults(updatedSession, triageResults);

    return {
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
      uiMessages: [{
        role: 'agent',
        content: 'I\'ve classified your issue(s) but had trouble generating follow-up questions. A human will review.',
      }],
      eventPayload: { followup_generation_error: true },
      eventType: 'state_transition',
    };
  }

  // Record followup_event (questions asked, answers null)
  const followUpEvent = buildFollowUpQuestionsEvent({
    eventId: deps.idGenerator(),
    conversationId: session.conversation_id,
    issueId: targetIssue.issue_id,
    turnNumber: updatedSession.followup_turn_number + 1,
    questions: followUpQuestions,
    createdAt: deps.clock(),
  });
  await deps.eventRepo.append('followup_events', followUpEvent);

  // Update session tracking
  updatedSession = updateFollowUpTracking(updatedSession, followUpQuestions);
  updatedSession = setPendingFollowUpQuestions(updatedSession, followUpQuestions);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/classification-followup.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass. Fix any Phase 5 tests that need updated mock deps.

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/start-classification.ts packages/core/src/__tests__/followup/classification-followup.test.ts
git add -u # any existing test fixes
git commit -m "feat(core): generate follow-up questions in classification handler when fields need input"
```

---

## Task 7: Extend handleAnswerFollowups with event recording, caps check, and re-classification

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/answer-followups.ts`
- Test: `packages/core/src/__tests__/followup/answer-followups.test.ts`

**Context:** The `handleAnswerFollowups` handler (created in Phase 5 Task 9) re-classifies with enriched input when the tenant answers follow-up questions. Phase 6 extends this handler to: (1) record a followup_event with both questions and answers (append-only), (2) convert answers to `followup_answers` for the classifier, (3) re-classify, (4) check caps before generating another round of questions, (5) trigger escape hatch if caps exhausted.

The full flow in this handler:
1. Retrieve pending questions from session
2. Build followup_event with questions + answers → append to `followup_events`
3. Build enriched `IssueClassifierInput` with `followup_answers`
4. Re-classify each issue
5. Check if fields still need input → if yes, check caps → if under caps, call FollowUpGenerator → update session → return `needs_tenant_input`
6. If all fields resolved → `tenant_confirmation_pending`
7. If caps exhausted → escape hatch → `tenant_confirmation_pending` with `needs_human_triage`

**Spec references:** §11.2 (`needs_tenant_input -> ANSWER_FOLLOWUPS -> classification_in_progress`), §15 (termination caps, escape hatch), §7.1 (followup_events)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/followup/answer-followups.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import {
  createSession,
  updateSessionState,
  setSplitIssues,
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
} from '../../session/session.js';
import { ConversationState, ActorType, DEFAULT_FOLLOWUP_CAPS, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, FollowUpGeneratorOutput, FollowUpQuestion, CueDictionary } from '@wo-agent/schemas';
import type { IssueClassificationResult } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const HIGH_CONF_OUTPUT: IssueClassifierOutput = {
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
    Category: 0.95, Location: 0.9, Sub_Location: 0.85,
    Maintenance_Category: 0.95, Maintenance_Object: 0.95, Maintenance_Problem: 0.95,
    Management_Category: 0.0, Management_Object: 0.0, Priority: 0.95,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const PENDING_QUESTIONS: FollowUpQuestion[] = [
  {
    question_id: 'q1',
    field_target: 'Priority',
    prompt: 'How urgent?',
    options: ['low', 'normal', 'high'],
    answer_type: 'enum',
  },
];

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

function makeAnswerContext(overrides?: {
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  followUpFn?: (...args: unknown[]) => Promise<unknown>;
  turnNumber?: number;
  totalQuestionsAsked?: number;
}) {
  let counter = 0;
  const priorResults: IssueClassificationResult[] = [{
    issue_id: 'i1',
    classifierOutput: {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.3 },
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
  session = updateFollowUpTracking(session, PENDING_QUESTIONS);
  session = setPendingFollowUpQuestions(session, PENDING_QUESTIONS);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: 'ANSWER_FOLLOWUPS' as any,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [
          { question_id: 'q1', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' },
        ],
      },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: { append: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-25T12:05:00.000Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(HIGH_CONF_OUTPUT),
      followUpGenerator: overrides?.followUpFn ?? vi.fn().mockResolvedValue({
        questions: [{
          question_id: 'q2', field_target: 'Priority',
          prompt: 'Priority again?', options: ['low', 'high'], answer_type: 'enum',
        }],
      }),
      cueDict: MINI_CUES,
      taxonomy,
      followUpCaps: DEFAULT_FOLLOWUP_CAPS,
    } as any,
  };
}

describe('handleAnswerFollowups', () => {
  it('records a followup_event with answers', async () => {
    const ctx = makeAnswerContext();
    await handleAnswerFollowups(ctx);

    expect(ctx.deps.eventRepo.append).toHaveBeenCalledWith(
      'followup_events',
      expect.objectContaining({
        conversation_id: 'conv-1',
        issue_id: 'i1',
        turn_number: 1,
        answers_received: expect.arrayContaining([
          expect.objectContaining({ question_id: 'q1', answer: 'normal' }),
        ]),
      }),
    );
  });

  it('re-classifies and transitions to tenant_confirmation_pending when all fields resolved', async () => {
    const ctx = makeAnswerContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('generates new follow-up questions when fields still need input after re-classification', async () => {
    const stillLowConf: IssueClassifierOutput = {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.4 },
    };
    const ctx = makeAnswerContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowConf),
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.pending_followup_questions).toBeDefined();
    expect(result.session.pending_followup_questions!.length).toBeGreaterThan(0);
  });

  it('triggers escape hatch when turn cap exceeded', async () => {
    const stillLowConf: IssueClassifierOutput = {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.4 },
    };
    const ctx = makeAnswerContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowConf),
    });
    // Simulate being at turn 8 already
    ctx.session = {
      ...ctx.session,
      followup_turn_number: 8,
      total_questions_asked: 8,
    } as any;

    const result = await handleAnswerFollowups(ctx);
    // Should escape hatch → tenant_confirmation_pending with needs_human_triage
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
  });

  it('triggers escape hatch when re-ask limit reached for all fields', async () => {
    const stillLowConf: IssueClassifierOutput = {
      ...HIGH_CONF_OUTPUT,
      model_confidence: { ...HIGH_CONF_OUTPUT.model_confidence, Priority: 0.4 },
    };
    const ctx = makeAnswerContext({
      classifierFn: vi.fn().mockResolvedValue(stillLowConf),
    });
    // Simulate Priority already asked 2 times
    ctx.session = {
      ...ctx.session,
      previous_questions: [{ field_target: 'Priority', times_asked: 2 }],
    } as any;

    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
  });

  it('clears pending questions from session on completion', async () => {
    const ctx = makeAnswerContext();
    const result = await handleAnswerFollowups(ctx);
    expect(result.session.pending_followup_questions).toBeNull();
  });

  it('passes followup_answers to classifier re-classification input', async () => {
    const ctx = makeAnswerContext();
    await handleAnswerFollowups(ctx);

    // Verify the classifier was called with followup_answers
    expect(ctx.deps.issueClassifier).toHaveBeenCalledWith(
      expect.objectContaining({
        followup_answers: expect.arrayContaining([
          expect.objectContaining({ field_target: 'Priority', answer: 'normal' }),
        ]),
      }),
      undefined,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/answer-followups.test.ts`
Expected: FAIL — handler lacks event recording and caps logic

**Step 3: Extend the handleAnswerFollowups handler**

In `packages/core/src/orchestrator/action-handlers/answer-followups.ts`, rewrite or extend the handler:

```typescript
import { ConversationState, DEFAULT_CONFIDENCE_CONFIG, DEFAULT_FOLLOWUP_CAPS } from '@wo-agent/schemas';
import type {
  IssueClassifierInput,
  FollowUpGeneratorInput,
  FollowUpCaps,
  ConfidenceConfig,
} from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { callIssueClassifier } from '../../classifier/issue-classifier.js';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { computeAllFieldConfidences, determineFieldsNeedingInput } from '../../classifier/confidence.js';
import {
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
} from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import { resolveLlmClassifySuccess } from '../../state-machine/guards.js';
import { checkFollowUpCaps } from '../../followup/caps.js';
import { callFollowUpGenerator, FollowUpGeneratorError } from '../../followup/followup-generator.js';
import { buildFollowUpAnswersEvent, buildFollowUpQuestionsEvent } from '../../followup/event-builder.js';

/**
 * Handle ANSWER_FOLLOWUPS action (spec §11.2, §15).
 * Transition: needs_tenant_input → ANSWER_FOLLOWUPS → classification_in_progress
 * Then re-classify with enriched input and determine next state.
 */
export async function handleAnswerFollowups(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;
  const tenantInput = request.tenant_input as { answers: Array<{ question_id: string; answer: unknown; received_at?: string }> };
  const pendingQuestions = session.pending_followup_questions;
  const issues = session.split_issues;

  // Guard: must have pending questions
  if (!pendingQuestions || pendingQuestions.length === 0) {
    return {
      newState: session.state,
      session,
      errors: [{ code: 'NO_PENDING_QUESTIONS', message: 'No pending follow-up questions to answer' }],
    };
  }

  // Guard: must have issues
  if (!issues || issues.length === 0) {
    return {
      newState: session.state,
      session,
      errors: [{ code: 'NO_ISSUES', message: 'No issues to re-classify' }],
    };
  }

  // Step 1: Record followup_event with questions + answers (append-only)
  const answersReceived = tenantInput.answers.map(a => ({
    question_id: a.question_id,
    answer: a.answer,
    received_at: a.received_at ?? deps.clock(),
  }));

  // Determine which issue this follow-up relates to
  const targetIssueId = pendingQuestions[0]?.field_target
    ? session.classification_results?.find(
        r => r.fieldsNeedingInput.length > 0,
      )?.issue_id ?? issues[0].issue_id
    : issues[0].issue_id;

  const answersEvent = buildFollowUpAnswersEvent({
    eventId: deps.idGenerator(),
    conversationId: session.conversation_id,
    issueId: targetIssueId,
    turnNumber: session.followup_turn_number,
    questions: pendingQuestions,
    answers: answersReceived,
    createdAt: deps.clock(),
  });
  await deps.eventRepo.append('followup_events', answersEvent);

  // Step 2: Clear pending questions
  let updatedSession = setPendingFollowUpQuestions(session, null);

  // Step 3: Convert answers to followup_answers for classifier
  const followupAnswers = tenantInput.answers.map(a => {
    const question = pendingQuestions.find(q => q.question_id === a.question_id);
    return {
      field_target: question?.field_target ?? '',
      answer: a.answer as string | boolean,
    };
  }).filter(a => a.field_target);

  // Intermediate step: needs_tenant_input → classification_in_progress
  const intermediateStep = {
    state: ConversationState.CLASSIFICATION_IN_PROGRESS,
    eventType: 'state_transition' as const,
    eventPayload: { action: 'answer_followups', answers_count: tenantInput.answers.length },
  };

  // Step 4: Re-classify each issue with enriched input
  const cueDict = (deps as any).cueDict;
  const taxonomy = (deps as any).taxonomy;
  const confidenceConfig: ConfidenceConfig = (deps as any).confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;
  const followUpCaps: FollowUpCaps = (deps as any).followUpCaps ?? DEFAULT_FOLLOWUP_CAPS;

  const classificationResults: IssueClassificationResult[] = [];
  let anyFieldsNeedInput = false;

  for (const issue of issues) {
    const cueScoreMap = computeCueScores(`${issue.summary} ${issue.raw_excerpt}`, cueDict);
    const cueScoresForInput: Record<string, number> = {};
    for (const [field, result] of Object.entries(cueScoreMap)) {
      cueScoresForInput[field] = result.score;
    }

    const classifierInput: IssueClassifierInput = {
      issue_id: issue.issue_id,
      issue_summary: issue.summary,
      raw_excerpt: issue.raw_excerpt,
      followup_answers: issue.issue_id === targetIssueId ? followupAnswers : undefined,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      model_id: session.pinned_versions.model_id,
      prompt_version: session.pinned_versions.prompt_version,
      cue_scores: cueScoresForInput,
    };

    let classifierResult;
    try {
      classifierResult = await callIssueClassifier(classifierInput, deps.issueClassifier, taxonomy);
    } catch {
      return {
        newState: ConversationState.LLM_ERROR_RETRYABLE,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_FAIL,
        uiMessages: [{ role: 'agent', content: 'I had trouble re-classifying. Please try again.' }],
        errors: [{ code: 'CLASSIFIER_FAILED', message: 'Re-classification failed' }],
        transitionContext: { prior_state: ConversationState.CLASSIFICATION_IN_PROGRESS },
      };
    }

    if (classifierResult.status === 'llm_fail') {
      return {
        newState: ConversationState.LLM_ERROR_RETRYABLE,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_FAIL,
        uiMessages: [{ role: 'agent', content: 'I had trouble re-classifying. Please try again.' }],
        errors: [{ code: 'CLASSIFIER_FAILED', message: 'Re-classification failed' }],
        transitionContext: { prior_state: ConversationState.CLASSIFICATION_IN_PROGRESS },
      };
    }

    let output = classifierResult.status === 'needs_human_triage'
      ? { ...(classifierResult.conflicting?.[0] ?? { issue_id: issue.issue_id, classification: {}, model_confidence: {}, missing_fields: [], needs_human_triage: true }), needs_human_triage: true }
      : classifierResult.output!;

    const computedConfidence = computeAllFieldConfidences({
      classification: output.classification,
      modelConfidence: output.model_confidence,
      cueResults: cueScoreMap,
      config: confidenceConfig,
    });

    const fieldsNeedingInput = output.needs_human_triage
      ? []
      : determineFieldsNeedingInput(computedConfidence, confidenceConfig);

    if (fieldsNeedingInput.length > 0) anyFieldsNeedInput = true;

    classificationResults.push({
      issue_id: issue.issue_id,
      classifierOutput: output,
      computedConfidence,
      fieldsNeedingInput,
    });
  }

  updatedSession = setClassificationResults(updatedSession, classificationResults);

  // Step 5: If fields still need input, check caps and generate follow-ups
  if (anyFieldsNeedInput) {
    const allFieldsNeedingInput = classificationResults.flatMap(r => r.fieldsNeedingInput);

    const capsCheck = checkFollowUpCaps({
      turnNumber: updatedSession.followup_turn_number + 1,
      totalQuestionsAsked: updatedSession.total_questions_asked,
      previousQuestions: updatedSession.previous_questions,
      fieldsNeedingInput: allFieldsNeedingInput,
      caps: followUpCaps,
    });

    if (capsCheck.escapeHatch) {
      // Escape hatch: mark needs_human_triage
      const triageResults = classificationResults.map(r => ({
        ...r,
        classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
        fieldsNeedingInput: [],
      }));
      updatedSession = setClassificationResults(updatedSession, triageResults);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [{
          role: 'agent',
          content: 'Thank you for your answers. Some details still need review — a human will follow up.',
        }],
        eventPayload: { escape_hatch: true, reason: capsCheck.reason },
        eventType: 'state_transition',
      };
    }

    // Generate next round of follow-up questions
    const targetResult = classificationResults.find(r => r.fieldsNeedingInput.length > 0)!;
    const followUpInput: FollowUpGeneratorInput = {
      issue_id: targetResult.issue_id,
      classification: targetResult.classifierOutput.classification,
      confidence_by_field: targetResult.computedConfidence,
      missing_fields: [...targetResult.classifierOutput.missing_fields],
      fields_needing_input: [...capsCheck.eligibleFields],
      previous_questions: [...updatedSession.previous_questions],
      turn_number: updatedSession.followup_turn_number + 1,
      total_questions_asked: updatedSession.total_questions_asked,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      prompt_version: session.pinned_versions.prompt_version,
    };

    let nextQuestions;
    try {
      const followUpResult = await callFollowUpGenerator(
        followUpInput,
        deps.followUpGenerator,
        capsCheck.remainingQuestionBudget,
      );
      if (followUpResult.status === 'ok') {
        nextQuestions = followUpResult.output!.questions;
      }
    } catch {
      // FollowUp generation failed — escape hatch
    }

    if (!nextQuestions || nextQuestions.length === 0) {
      // Escape hatch
      const triageResults = classificationResults.map(r => ({
        ...r,
        classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
        fieldsNeedingInput: [],
      }));
      updatedSession = setClassificationResults(updatedSession, triageResults);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [{ role: 'agent', content: 'Thank you. A human will review the remaining details.' }],
        eventPayload: { escape_hatch: true },
        eventType: 'state_transition',
      };
    }

    // Record followup_event for new questions
    const questionsEvent = buildFollowUpQuestionsEvent({
      eventId: deps.idGenerator(),
      conversationId: session.conversation_id,
      issueId: targetResult.issue_id,
      turnNumber: updatedSession.followup_turn_number + 1,
      questions: nextQuestions,
      createdAt: deps.clock(),
    });
    await deps.eventRepo.append('followup_events', questionsEvent);

    // Update session tracking
    updatedSession = updateFollowUpTracking(updatedSession, nextQuestions);
    updatedSession = setPendingFollowUpQuestions(updatedSession, nextQuestions);

    return {
      newState: ConversationState.NEEDS_TENANT_INPUT,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
      uiMessages: [{
        role: 'agent',
        content: 'Thanks for that info. I still need a few more details.',
      }],
      eventPayload: {
        reclassification: true,
        new_followup_turn: updatedSession.followup_turn_number,
      },
      eventType: 'state_transition',
    };
  }

  // All fields resolved — proceed to confirmation
  return {
    newState: ConversationState.TENANT_CONFIRMATION_PENDING,
    session: updatedSession,
    intermediateSteps: [intermediateStep],
    finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
    uiMessages: [{
      role: 'agent',
      content: 'Thank you! I\'ve updated the classification. Please review and confirm.',
    }],
    eventPayload: {
      reclassification: true,
      all_fields_resolved: true,
    },
    eventType: 'state_transition',
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/answer-followups.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/answer-followups.ts packages/core/src/__tests__/followup/answer-followups.test.ts
git commit -m "feat(core): extend handleAnswerFollowups with event recording, caps, and re-classification"
```

---

## Task 8: Integration tests — full follow-up loop with termination caps and escape hatch

**Files:**
- Create: `packages/core/src/__tests__/followup/followup-integration.test.ts`

**Context:** End-to-end integration tests that exercise the full classification → follow-up → re-classification loop through the dispatcher. Tests cover: (1) happy path with one round of follow-ups, (2) multi-turn follow-ups converging to confirmation, (3) escape hatch when turn cap exceeded, (4) escape hatch when re-ask limit reached, (5) escape hatch when total questions exhausted, (6) multiple issues with different follow-up needs. Uses the dispatcher directly (not action handlers) to validate the full orchestrator wiring.

**Step 1: Write the integration test**

Create `packages/core/src/__tests__/followup/followup-integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import {
  ActionType,
  ActorType,
  ConversationState,
  DEFAULT_FOLLOWUP_CAPS,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type { IssueClassifierOutput, FollowUpGeneratorOutput, CueDictionary } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const HIGH_CONF_CLASSIFICATION: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance', Location: 'suite', Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing', Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak', Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj', Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95, Location: 0.9, Sub_Location: 0.85,
    Maintenance_Category: 0.95, Maintenance_Object: 0.95,
    Maintenance_Problem: 0.95, Management_Category: 0.0,
    Management_Object: 0.0, Priority: 0.95,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const LOW_PRIORITY_CLASSIFICATION: IssueClassifierOutput = {
  ...HIGH_CONF_CLASSIFICATION,
  model_confidence: {
    ...HIGH_CONF_CLASSIFICATION.model_confidence,
    Priority: 0.3, // Triggers follow-up
  },
};

const FOLLOWUP_QUESTIONS: FollowUpGeneratorOutput = {
  questions: [{
    question_id: 'q1',
    field_target: 'Priority',
    prompt: 'How urgent is this?',
    options: ['low', 'normal', 'high', 'emergency'],
    answer_type: 'enum',
  }],
};

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

const AUTH = {
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  authorized_unit_ids: ['u1'],
};

function makeDeps(overrides?: {
  classifierResponses?: IssueClassifierOutput[];
}) {
  let counter = 0;
  let classifierCallCount = 0;
  const classifierResponses = overrides?.classifierResponses ?? [
    LOW_PRIORITY_CLASSIFICATION,  // First classification: low priority
    HIGH_CONF_CLASSIFICATION,     // Re-classification after follow-up: high confidence
  ];

  return {
    eventRepo: {
      append: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
    },
    sessionStore: {
      sessions: new Map(),
      async get(id: string) { return this.sessions.get(id) ?? null; },
      async getByTenantUser() { return []; },
      async save(session: any) { this.sessions.set(session.conversation_id, session); },
    },
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-02-25T12:00:00.000Z',
    issueSplitter: vi.fn().mockResolvedValue({
      issues: [{ issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' }],
      issue_count: 1,
    }),
    issueClassifier: vi.fn().mockImplementation(async () => {
      return classifierResponses[classifierCallCount++] ?? HIGH_CONF_CLASSIFICATION;
    }),
    followUpGenerator: vi.fn().mockResolvedValue(FOLLOWUP_QUESTIONS),
    cueDict: MINI_CUES,
    taxonomy,
    followUpCaps: DEFAULT_FOLLOWUP_CAPS,
  };
}

describe('Follow-up loop integration', () => {
  it('happy path: classify → follow-up → answer → re-classify → confirm', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    // 1. Create conversation
    const r1 = await dispatch({
      conversation_id: null, action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT, tenant_input: {}, auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // 2. Select unit
    await dispatch({
      conversation_id: convId, action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT, tenant_input: { unit_id: 'u1' }, auth_context: AUTH,
    });

    // 3. Submit initial message → split
    await dispatch({
      conversation_id: convId, action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT, tenant_input: { message: 'My toilet is leaking' }, auth_context: AUTH,
    });

    // 4. Confirm split → classification → needs_tenant_input (low priority confidence)
    const r4 = await dispatch({
      conversation_id: convId, action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT, tenant_input: {}, auth_context: AUTH,
    });

    // Should be in needs_tenant_input with follow-up questions
    const stateAfterClassification = r4.response.conversation_snapshot.state;
    expect(stateAfterClassification).toBe(ConversationState.NEEDS_TENANT_INPUT);

    // 5. Answer follow-up → re-classify → tenant_confirmation_pending
    const r5 = await dispatch({
      conversation_id: convId, action_type: ActionType.ANSWER_FOLLOWUPS,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [{ question_id: 'q1', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' }],
      },
      auth_context: AUTH,
    });

    expect(r5.response.conversation_snapshot.state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);

    // Verify followup_events were recorded
    expect(deps.eventRepo.append).toHaveBeenCalledWith(
      'followup_events',
      expect.objectContaining({ questions_asked: expect.any(Array) }),
    );
  });

  it('escape hatch: caps exhausted after multiple turns', async () => {
    // Classifier always returns low confidence — never resolves
    const deps = makeDeps({
      classifierResponses: Array(20).fill(LOW_PRIORITY_CLASSIFICATION),
    });
    const dispatch = createDispatcher(deps as any);

    // Walk through to needs_tenant_input
    const r1 = await dispatch({
      conversation_id: null, action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT, tenant_input: {}, auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId, action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT, tenant_input: { unit_id: 'u1' }, auth_context: AUTH,
    });
    await dispatch({
      conversation_id: convId, action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT, tenant_input: { message: 'My toilet is leaking' }, auth_context: AUTH,
    });
    await dispatch({
      conversation_id: convId, action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT, tenant_input: {}, auth_context: AUTH,
    });

    // Keep answering follow-ups until escape hatch triggers
    let state = ConversationState.NEEDS_TENANT_INPUT;
    let rounds = 0;
    const maxRounds = 15; // Safety: should escape well before this

    while (state === ConversationState.NEEDS_TENANT_INPUT && rounds < maxRounds) {
      const r = await dispatch({
        conversation_id: convId, action_type: ActionType.ANSWER_FOLLOWUPS,
        actor: ActorType.TENANT,
        tenant_input: {
          answers: [{ question_id: `q${rounds + 1}`, answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' }],
        },
        auth_context: AUTH,
      });
      state = r.response.conversation_snapshot.state;
      rounds++;
    }

    // Should have escaped to confirmation (not stuck in infinite loop)
    expect(state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    // Should not exceed max_turns + 1 (the +1 is from the initial classification)
    expect(rounds).toBeLessThanOrEqual(DEFAULT_FOLLOWUP_CAPS.max_turns + 1);
  });
});
```

**Step 2: Run the integration test**

Run: `cd packages/core && pnpm vitest run src/__tests__/followup/followup-integration.test.ts`
Expected: PASS — this test validates the full loop works end-to-end through the dispatcher.

**Step 3: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 4: Commit**

```bash
git add packages/core/src/__tests__/followup/followup-integration.test.ts
git commit -m "test(core): add follow-up loop integration tests with caps and escape hatch"
```

---

## Task 9: Final cleanup — update barrel exports and run full validation

**Files:**
- Verify: `packages/core/src/index.ts` (all followup exports present)
- Verify: `packages/core/src/followup/index.ts` (barrel complete)
- Verify: All test files pass
- Verify: TypeScript compiles cleanly

**Step 1: Verify barrel exports are complete**

Check `packages/core/src/index.ts` includes all followup module exports and session follow-up tracking functions.

Check `packages/core/src/followup/index.ts` includes all public API from the followup module.

**Step 2: Run TypeScript type checking**

Run: `pnpm typecheck`
Expected: No errors.

**Step 3: Run full test suite**

Run: `pnpm -r test`
Expected: All tests pass across all packages.

**Step 4: Run linting**

Run: `pnpm lint`
Expected: No lint errors.

**Step 5: Final commit**

```bash
git add -u
git commit -m "chore(core): Phase 6 cleanup — barrel exports and validation"
```

**Step 6: Verify commit log**

```bash
git log --oneline -10
```

Expected: Clean sequence of feat/test/chore commits for Phase 6.
