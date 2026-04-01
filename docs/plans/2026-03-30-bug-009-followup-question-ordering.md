# Implementation Plan: Bug-009 — Follow-Up Question Ordering

> **Status:** Phase 1 (dependency ordering) is done. Phase 2 (answer pinning) is tracked in `2026-03-30-bug-009-phase2-answer-pinning.md`.

**Date:** 2026-03-30
**Bug:** BUG-009 — Follow-up questions are asked in an overly broad order instead of narrowing step-by-step
**Root cause:** The follow-up generator receives all `fields_needing_input` at once with no dependency ordering. The LLM can ask about downstream fields (e.g., `Maintenance_Problem`) before upstream parents (e.g., `Location`, `Sub_Location`) are resolved. Constraint filtering removes invalid _options_ post-generation, but doesn't prevent premature _questions_.

## Design

**Two-layer fix — deterministic gate + prompt reinforcement:**

1. **Layer 1 (authoritative):** Before calling the LLM, filter `fields_needing_input` to only include fields whose parent dependencies in the constraint graph are already resolved in the current classification. This is deterministic — the LLM physically cannot generate questions for gated fields.

2. **Layer 2 (belt-and-suspenders):** Add explicit dependency-order guidance to the follow-up system prompt so the LLM prioritizes upstream fields first even within the eligible set.

**Key insight:** The constraint graph already exists in `CONSTRAINT_EDGES` (derived from `taxonomy_constraints.json` map keys). We just need a function that walks edges to determine which fields are "ready" — i.e., all parent fields are either resolved in the classification or are not in the needing-input set.

### Dependency Chains

**Maintenance track:**

```
Category (root — no parent)
Location (root — no parent)
├── Sub_Location (parent: Location; also reverse-constrained by Maintenance_Object)
│   └── Maintenance_Category (parent: Sub_Location)
│       └── Maintenance_Object (parent: Maintenance_Category)
│           └── Maintenance_Problem (parent: Maintenance_Object)
```

**Management track:**

```
Category (root)
├── Management_Category (no constraint parent in taxonomy_constraints.json)
│   └── Management_Object (no constraint parent in taxonomy_constraints.json)
```

**Priority:** Root field — always eligible.

### "Resolved" Definition

A parent field is considered resolved if:

- It has a non-empty value in `classification`, AND
- The value is not a vague placeholder (`general`, `other_sub_location`), AND
- The value is not `needs_object` (intentional placeholder for follow-up)

This aligns with the existing `VAGUE_VALUES` set in `constraint-resolver.ts`.

### Edge Case: Reverse Constraint (`Maintenance_Object_to_Sub_Location`)

The reverse edge means `Maintenance_Object` is also a parent of `Sub_Location`. If the classifier sets `Maintenance_Object` to a specific value (e.g., `toilet`) but `Sub_Location` is unresolved, Sub*Location should still be eligible since `Location` (its primary parent) is resolved. The reverse edge provides additional \_filtering of options* but should not _gate eligibility_.

**Decision:** For eligibility gating, use only the forward chain edges (the 4 `*_to_*` maps that form the linear dependency chain). The reverse edge `Maintenance_Object_to_Sub_Location` continues to filter options (as it does today) but does not gate question eligibility.

---

## Sequencing Overview

| Step | What it does                                                 | Files                                                                           |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1    | Add `filterFieldsByDependencyOrder()` function               | `packages/core/src/followup/field-ordering.ts` (new)                            |
| 2    | Add tests for the ordering function                          | `packages/core/src/__tests__/followup/field-ordering.test.ts` (new)             |
| 3    | Wire ordering into `callFollowUpGenerator`                   | `packages/core/src/followup/followup-generator.ts`                              |
| 4    | Add dependency-order guidance to the system prompt           | `packages/core/src/llm/prompts/followup-prompt.ts`                              |
| 5    | Add integration test for ordering in the generation pipeline | `packages/core/src/__tests__/followup/followup-generator.test.ts`               |
| 6    | Update barrel exports                                        | `packages/core/src/followup/index.ts` (if exists), `packages/core/src/index.ts` |
| 7    | Run full test suite, fix any breakage                        | —                                                                               |
| 8    | Update bug tracker and spec gap tracker                      | `docs/bug-tracker.md`, `docs/spec-gap-tracker.md`                               |

---

## Step 1 — Add `filterFieldsByDependencyOrder()`

### Task 1.1: Create `packages/core/src/followup/field-ordering.ts`

This module exports a single pure function that filters and sorts fields by the constraint dependency graph.

```typescript
import { CONSTRAINT_EDGES } from '@wo-agent/schemas';
import type { TaxonomyConstraints } from '@wo-agent/schemas';

/**
 * Values considered too vague to count as "resolved" for dependency gating.
 * Matches VAGUE_VALUES in constraint-resolver.ts plus the follow-up placeholder.
 */
const UNRESOLVED_VALUES = new Set(['', 'general', 'other_sub_location', 'needs_object']);

/**
 * Forward-chain constraint map names — these form the linear dependency
 * hierarchy used for question eligibility gating.
 *
 * The reverse edge (Maintenance_Object_to_Sub_Location) is excluded because
 * it constrains *options* not *eligibility*. A tenant can be asked about
 * Sub_Location as long as Location is resolved, even if Maintenance_Object
 * is unknown.
 */
const FORWARD_CHAIN_MAPS = new Set([
  'Location_to_Sub_Location',
  'Sub_Location_to_Maintenance_Category',
  'Maintenance_Category_to_Maintenance_Object',
  'Maintenance_Object_to_Maintenance_Problem',
]);

/**
 * Canonical ordering of taxonomy fields for follow-up question priority.
 * Lower index = higher priority = asked first.
 */
const FIELD_PRIORITY: readonly string[] = [
  'Category',
  'Location',
  'Sub_Location',
  'Maintenance_Category',
  'Management_Category',
  'Maintenance_Object',
  'Management_Object',
  'Maintenance_Problem',
  'Priority',
];

/**
 * Determine whether a field value counts as "resolved" for dependency gating.
 */
function isFieldResolved(value: string | undefined): boolean {
  return value != null && !UNRESOLVED_VALUES.has(value);
}

/**
 * Filter `fieldsNeedingInput` to only include fields whose parent dependencies
 * in the constraint graph are resolved in the current classification.
 *
 * Returns the eligible fields sorted in dependency order (upstream first).
 *
 * Fields with no parent constraints (Category, Location, Priority, management
 * fields) are always eligible.
 *
 * @param fieldsNeedingInput - raw list of fields that need follow-up
 * @param classification - current classification values
 * @returns filtered + sorted fields ready for follow-up questions
 */
export function filterFieldsByDependencyOrder(
  fieldsNeedingInput: readonly string[],
  classification: Record<string, string>,
): string[] {
  const forwardEdges = CONSTRAINT_EDGES.filter((e) => FORWARD_CHAIN_MAPS.has(e.mapKey));
  const needingSet = new Set(fieldsNeedingInput);
  const eligible: string[] = [];

  for (const field of fieldsNeedingInput) {
    // Find all forward-chain edges where this field is the child
    const parentEdges = forwardEdges.filter((e) => e.childField === field);

    if (parentEdges.length === 0) {
      // Root field (no parent constraint) — always eligible
      eligible.push(field);
      continue;
    }

    // Field is eligible if ALL parent fields are resolved in classification
    const allParentsResolved = parentEdges.every((edge) =>
      isFieldResolved(classification[edge.parentField]),
    );

    if (allParentsResolved) {
      eligible.push(field);
    }
  }

  // Sort by dependency priority (upstream first)
  eligible.sort((a, b) => {
    const ai = FIELD_PRIORITY.indexOf(a);
    const bi = FIELD_PRIORITY.indexOf(b);
    // Unknown fields go to end
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return eligible;
}
```

**Why this design:**

- Pure function — no side effects, easy to test
- Uses the existing `CONSTRAINT_EDGES` (no second source of truth)
- Only uses forward-chain edges for gating (reverse edge excluded per design decision)
- Fields with no constraint parent (Category, Location, Priority, management fields) pass through unconditionally
- Sort ensures the LLM sees fields in narrowing order even if multiple are eligible

---

## Step 2 — Unit tests for field ordering

### Task 2.1: Create `packages/core/src/__tests__/followup/field-ordering.test.ts`

Test cases:

```typescript
import { describe, it, expect } from 'vitest';
import { filterFieldsByDependencyOrder } from '../../followup/field-ordering.js';

describe('filterFieldsByDependencyOrder', () => {
  it('returns root fields (Category, Location, Priority) unconditionally', () => {
    const result = filterFieldsByDependencyOrder(
      ['Category', 'Location', 'Priority'],
      {}, // empty classification
    );
    expect(result).toEqual(['Category', 'Location', 'Priority']);
  });

  it('blocks Sub_Location when Location is unresolved', () => {
    const result = filterFieldsByDependencyOrder(
      ['Location', 'Sub_Location', 'Maintenance_Category'],
      { Category: 'maintenance' },
    );
    expect(result).toEqual(['Location']);
  });

  it('allows Sub_Location when Location is resolved', () => {
    const result = filterFieldsByDependencyOrder(['Sub_Location', 'Maintenance_Category'], {
      Category: 'maintenance',
      Location: 'suite',
    });
    // Sub_Location eligible (Location resolved); Maintenance_Category blocked (Sub_Location unresolved)
    expect(result).toEqual(['Sub_Location']);
  });

  it('allows the full chain when all parents resolved', () => {
    const result = filterFieldsByDependencyOrder(['Maintenance_Problem'], {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'bathroom',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
    });
    expect(result).toEqual(['Maintenance_Problem']);
  });

  it('treats vague values as unresolved', () => {
    const result = filterFieldsByDependencyOrder(['Sub_Location', 'Maintenance_Category'], {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
    });
    // Sub_Location is in fields_needing_input AND its parent (Location) is resolved → eligible
    // Maintenance_Category parent (Sub_Location) has 'general' = vague → blocked
    expect(result).toEqual(['Sub_Location']);
  });

  it('treats needs_object as unresolved for downstream gating', () => {
    const result = filterFieldsByDependencyOrder(['Maintenance_Object', 'Maintenance_Problem'], {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'kitchen',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'needs_object',
    });
    // Maintenance_Object in fields_needing_input, parent resolved → eligible
    // Maintenance_Problem parent (Maintenance_Object) = 'needs_object' → blocked
    expect(result).toEqual(['Maintenance_Object']);
  });

  it('sorts eligible fields in dependency order', () => {
    const result = filterFieldsByDependencyOrder(
      ['Priority', 'Maintenance_Object', 'Location', 'Category'],
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'plumbing',
      },
    );
    // All eligible; sorted by FIELD_PRIORITY
    expect(result).toEqual(['Category', 'Location', 'Maintenance_Object', 'Priority']);
  });

  it('management fields are always eligible (no constraint parents)', () => {
    const result = filterFieldsByDependencyOrder(['Management_Category', 'Management_Object'], {
      Category: 'management',
    });
    expect(result).toEqual(['Management_Category', 'Management_Object']);
  });

  it('returns empty array when no fields are eligible', () => {
    const result = filterFieldsByDependencyOrder(
      ['Maintenance_Problem'],
      { Category: 'maintenance' }, // no parent chain resolved
    );
    expect(result).toEqual([]);
  });

  it('handles empty fields_needing_input gracefully', () => {
    const result = filterFieldsByDependencyOrder([], { Category: 'maintenance' });
    expect(result).toEqual([]);
  });
});
```

**Run:** `pnpm --filter @wo-agent/core exec vitest run src/__tests__/followup/field-ordering.test.ts`

---

## Step 3 — Wire ordering into `callFollowUpGenerator`

### Task 3.1: Add dependency filtering in `followup-generator.ts`

**File:** `packages/core/src/followup/followup-generator.ts`

Add import at top:

```typescript
import { filterFieldsByDependencyOrder } from './field-ordering.js';
```

Insert dependency filtering **before** the LLM call loop (after line 57, before line 61). The filtered fields replace `input.fields_needing_input` for both the LLM call and the post-LLM field filter:

```typescript
// Gate fields by dependency order — only include fields whose parent
// dependencies are resolved in the current classification (Bug-009)
const orderedFields = filterFieldsByDependencyOrder(
  input.fields_needing_input,
  input.classification,
);

// If no fields are eligible yet (parents unresolved), return empty output
// so the caller can handle it (escape hatch or wait for next round)
if (orderedFields.length === 0) {
  return {
    status: 'ok',
    output: { questions: [] },
  };
}

// Build a narrowed input with only dependency-eligible fields
const narrowedInput: FollowUpGeneratorInput = {
  ...input,
  fields_needing_input: orderedFields,
};
```

Then update the LLM call and filter to use `narrowedInput` and `orderedFields`:

**Line 57** — change `eligibleFields` to use `orderedFields`:

```typescript
const eligibleFields = new Set(orderedFields);
```

**Lines 64-66** — change `llmCall(input, ...)` to `llmCall(narrowedInput, ...)`:

```typescript
raw = obsCtx
  ? await llmCall(narrowedInput, attempt > 0 ? { retryHint: 'schema_errors' } : undefined, obsCtx)
  : await llmCall(narrowedInput, attempt > 0 ? { retryHint: 'schema_errors' } : undefined);
```

**Full revised function signature area (lines 56–67 become):**

```typescript
export async function callFollowUpGenerator(
  input: FollowUpGeneratorInput,
  llmCall: LlmFollowUpFn,
  remainingBudget: number,
  metricsRecorder?: MetricsRecorder,
  obsCtx?: ObservabilityContext,
): Promise<FollowUpGeneratorResult> {
  // Gate fields by dependency order (Bug-009)
  const orderedFields = filterFieldsByDependencyOrder(
    input.fields_needing_input,
    input.classification,
  );

  if (orderedFields.length === 0) {
    return { status: 'ok', output: { questions: [] } };
  }

  const narrowedInput: FollowUpGeneratorInput = {
    ...input,
    fields_needing_input: orderedFields,
  };

  const eligibleFields = new Set(orderedFields);
  let validated: FollowUpGeneratorOutput | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = obsCtx
        ? await llmCall(narrowedInput, attempt > 0 ? { retryHint: 'schema_errors' } : undefined, obsCtx)
        : await llmCall(narrowedInput, attempt > 0 ? { retryHint: 'schema_errors' } : undefined);
    } catch (err) {
      // ... (rest unchanged)
```

---

## Step 4 — Add dependency-order guidance to the system prompt

### Task 4.1: Update `buildFollowUpSystemPrompt()` in `followup-prompt.ts`

**File:** `packages/core/src/llm/prompts/followup-prompt.ts`

Add a new rule after rule 14 (before the JSON response format):

```
15. Ask questions in dependency order — resolve upstream fields before downstream ones.
    The priority order for maintenance issues is:
    Location → Sub_Location → Maintenance_Category → Maintenance_Object → Maintenance_Problem.
    For management issues: Management_Category → Management_Object.
    If multiple fields are eligible, prioritize the earlier field in the chain.
    Do NOT ask about a downstream field if you could instead ask about its upstream parent.
```

This is belt-and-suspenders — Layer 1 (the deterministic filter) already prevents ineligible fields from reaching the LLM. This prompt guidance helps the LLM prioritize correctly _within_ the eligible set.

---

## Step 5 — Integration test for ordering in generation pipeline

### Task 5.1: Add test cases to `followup-generator.test.ts`

**File:** `packages/core/src/__tests__/followup/followup-generator.test.ts`

Add a new `describe` block:

```typescript
describe('dependency-ordered question generation (Bug-009)', () => {
  it('blocks downstream fields when parent is unresolved', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: {
        Location: 0.3,
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.1,
      },
      missing_fields: [],
      fields_needing_input: [
        'Location',
        'Sub_Location',
        'Maintenance_Category',
        'Maintenance_Object',
        'Maintenance_Problem',
      ],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0',
      prompt_version: '1.0',
      cue_version: '1.2.0',
      original_text: 'I have a plumbing issue',
    };

    const mockLlm = async (_input: FollowUpGeneratorInput) => {
      // Verify the LLM only received eligible fields
      expect(_input.fields_needing_input).toEqual(['Location']);
      return {
        questions: [
          {
            question_id: 'q1',
            field_target: 'Location',
            prompt: 'Where is this issue located?',
            options: ['suite', 'building_interior', 'building_exterior'],
            answer_type: 'enum',
          },
        ],
      };
    };

    const result = await callFollowUpGenerator(input, mockLlm, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Location');
  });

  it('returns empty questions when no fields are dependency-eligible', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Maintenance_Problem: 0.1 },
      missing_fields: [],
      fields_needing_input: ['Maintenance_Problem'], // parent chain unresolved
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0',
      prompt_version: '1.0',
      cue_version: '1.2.0',
    };

    const mockLlm = async () => {
      throw new Error('LLM should not be called when no fields are eligible');
    };

    const result = await callFollowUpGenerator(input, mockLlm, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toEqual([]);
  });

  it('progressively unlocks fields as parents resolve across rounds', async () => {
    // Round 1: Only Location eligible
    const round1Input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Location: 0.3, Sub_Location: 0.2 },
      missing_fields: [],
      fields_needing_input: ['Location', 'Sub_Location'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0',
      prompt_version: '1.0',
      cue_version: '1.2.0',
    };

    const round1Llm = async (_input: FollowUpGeneratorInput) => {
      expect(_input.fields_needing_input).toEqual(['Location']);
      return {
        questions: [
          {
            question_id: 'q1',
            field_target: 'Location',
            prompt: 'Where is this?',
            options: ['suite'],
            answer_type: 'enum',
          },
        ],
      };
    };

    const r1 = await callFollowUpGenerator(round1Input, round1Llm, 3);
    expect(r1.output!.questions[0].field_target).toBe('Location');

    // Round 2: Location resolved → Sub_Location now eligible
    const round2Input: FollowUpGeneratorInput = {
      ...round1Input,
      classification: { Category: 'maintenance', Location: 'suite' },
      fields_needing_input: ['Sub_Location'],
      turn_number: 2,
      total_questions_asked: 1,
    };

    const round2Llm = async (_input: FollowUpGeneratorInput) => {
      expect(_input.fields_needing_input).toEqual(['Sub_Location']);
      return {
        questions: [
          {
            question_id: 'q2',
            field_target: 'Sub_Location',
            prompt: 'Which room?',
            options: ['kitchen', 'bathroom'],
            answer_type: 'enum',
          },
        ],
      };
    };

    const r2 = await callFollowUpGenerator(round2Input, round2Llm, 3);
    expect(r2.output!.questions[0].field_target).toBe('Sub_Location');
  });
});
```

**Run:** `pnpm --filter @wo-agent/core exec vitest run src/__tests__/followup/followup-generator.test.ts`

---

## Step 6 — Update barrel exports

### Task 6.1: Export from followup barrel (if exists)

Check if `packages/core/src/followup/index.ts` exists. If yes, add:

```typescript
export { filterFieldsByDependencyOrder } from './field-ordering.js';
```

### Task 6.2: Export from core barrel

**File:** `packages/core/src/index.ts`

Add export if followup functions are re-exported at the package level (check existing pattern).

---

## Step 7 — Run full test suite

```bash
pnpm test
pnpm typecheck
pnpm lint
```

**Expected impact on existing tests:**

- Tests that pass `fields_needing_input` with downstream-only fields to `callFollowUpGenerator` where parents are unresolved may now get empty questions back (since the dependency gate blocks them). These tests should be updated to either:
  - Provide resolved parents in the classification, OR
  - Assert on the new empty-questions behavior

**Key test files to check:**

- `constraint-filtered-followup.test.ts` — already has `Location: 'suite'` set, should be fine
- `followup-generator.test.ts` — may need classification updates
- `e2e-toilet-leak.test.ts` — has full classification chain, should be fine
- `followup-integration.test.ts` — check if parents are set in test fixtures

---

## Step 8 — Update trackers

### Task 8.1: Update `docs/bug-tracker.md`

Add or update the BUG-009 row:

- **Status:** `IN PROGRESS` → `DONE` (after implementation)
- **Fix:** Deterministic dependency-order gating in follow-up generator + prompt reinforcement
- **Evidence:** Tests in `field-ordering.test.ts`, integration tests in `followup-generator.test.ts`

### Task 8.2: Update `docs/spec-gap-tracker.md`

Check for any rows related to follow-up ordering or field dependency that should be updated. The follow-up generation (§15) row should note that dependency ordering is now enforced.

---

## Risk Assessment

| Risk                                                                       | Mitigation                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty questions when all fields blocked → deadlock at `needs_tenant_input` | The empty-questions guard already exists in both handlers (lines 515-542 in start-classification.ts, lines 559-585 in answer-followups.ts) — routes to escape hatch                                    |
| More follow-up rounds needed (asking one field at a time)                  | Each turn allows up to 3 questions; dependency ordering allows multiple eligible fields per turn (e.g., Category + Location are both roots). Worst case adds 1-2 extra rounds for deeply nested chains |
| Existing tests break due to dependency gating                              | Low risk — most test fixtures already provide reasonable parent classifications. Step 7 catches any issues                                                                                             |
| Management track fields incorrectly gated                                  | Management fields have no parent constraints in `taxonomy_constraints.json` → always pass through as root fields                                                                                       |

## Scope Boundaries

**In scope:**

- Deterministic dependency-order filtering of `fields_needing_input`
- Priority-sorted field ordering
- System prompt ordering guidance
- Unit + integration tests
- Bug tracker and spec gap tracker updates

**Out of scope:**

- Changes to the constraint graph itself (`taxonomy_constraints.json`)
- Changes to the confidence/completeness gates
- Changes to the caps system
- Changes to the answer processing pipeline
- Multi-issue ordering (ordering is per-issue, which is the current model)
