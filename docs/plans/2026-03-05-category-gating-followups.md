# Category Gating for Follow-Up Questions

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Prevent irrelevant follow-up questions by filtering out fields that don't apply to the resolved Category. For "I have a leak in my apartment" (Category=maintenance), Management_Category and Management_Object should never appear as follow-up questions.

**Architecture:** Single-point gating in `determineFieldsNeedingInput()`. After computing low-confidence fields, remove fields that are irrelevant to the resolved Category. This is the chokepoint through which all follow-up field lists pass — both the LLM and mock paths benefit automatically.

**Tech Stack:** TypeScript, Vitest

---

## Root Cause

The classifier always outputs all 9 fields. For a maintenance issue, it sets `Management_Category: "other_mgmt_cat"` and `Management_Object: "other_mgmt_obj"` with `model_confidence: 0.0`. The confidence formula computes:

```
conf = 0.40*0 + 0.25*1.0 + 0.20*0.0 = 0.25 → LOW
```

`determineFieldsNeedingInput()` sees LOW and flags them for follow-up. The LLM then generates questions for these irrelevant fields.

## Design

### Gating Rules

| Resolved Category | Exclude from follow-ups |
|-------------------|------------------------|
| `maintenance` | `Management_Category`, `Management_Object` |
| `management` | `Maintenance_Category`, `Maintenance_Object`, `Maintenance_Problem` |
| Category is LOW (uncertain) | No filtering — ask about everything |

Gating only applies when Category itself is NOT in the `fieldsNeedingInput` list (medium or high confidence). If we're unsure about Category, we can't gate.

### Changes

1. **`determineFieldsNeedingInput()`** in `packages/core/src/classifier/confidence.ts` — add `classification` parameter, filter irrelevant fields after computing low-confidence set
2. **`start-classification.ts`** — pass `classification` to `determineFieldsNeedingInput()`
3. **`answer-followups.ts`** — same
4. **Tests** for all of the above

### What does NOT change

- Confidence formula
- Follow-up prompt/generator
- UI rendering
- Mock classifier

---

## Task Dependency Graph

```
Task 0 (gating logic + unit tests) ── Task 2 (wire into start-classification)
                                    ── Task 3 (wire into answer-followups)
Task 1 (update existing tests)     ── Task 4 (integration test)
```

---

### Task 0: Add category gating to `determineFieldsNeedingInput()`

**Files:**
- Modify: `packages/core/src/classifier/confidence.ts`
- Test: `packages/core/src/__tests__/classifier/confidence.test.ts`

**Step 1: Write failing tests**

Add to `confidence.test.ts`:

```typescript
describe('category gating', () => {
  it('excludes Management fields when Category=maintenance and Category is confident', () => {
    const confidences: Record<string, number> = {
      Category: 0.70,
      Location: 0.70,
      Sub_Location: 0.30,
      Maintenance_Category: 0.70,
      Maintenance_Object: 0.30,
      Maintenance_Problem: 0.70,
      Management_Category: 0.25,
      Management_Object: 0.25,
      Priority: 0.30,
    };
    const classification = {
      Category: 'maintenance',
      Management_Category: 'other_mgmt_cat',
      Management_Object: 'other_mgmt_obj',
    };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG, [], classification);
    expect(result).not.toContain('Management_Category');
    expect(result).not.toContain('Management_Object');
    // Other low fields should still be present
    expect(result).toContain('Sub_Location');
    expect(result).toContain('Maintenance_Object');
    expect(result).toContain('Priority');
  });

  it('excludes Maintenance fields when Category=management and Category is confident', () => {
    const confidences: Record<string, number> = {
      Category: 0.70,
      Location: 0.70,
      Sub_Location: 0.30,
      Maintenance_Category: 0.25,
      Maintenance_Object: 0.25,
      Maintenance_Problem: 0.25,
      Management_Category: 0.70,
      Management_Object: 0.30,
      Priority: 0.30,
    };
    const classification = {
      Category: 'management',
      Maintenance_Category: 'other_maintenance_category',
      Maintenance_Object: 'other_maintenance_object',
      Maintenance_Problem: 'other_problem',
    };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG, [], classification);
    expect(result).not.toContain('Maintenance_Category');
    expect(result).not.toContain('Maintenance_Object');
    expect(result).not.toContain('Maintenance_Problem');
    // Other low fields should still be present
    expect(result).toContain('Sub_Location');
    expect(result).toContain('Management_Object');
    expect(result).toContain('Priority');
  });

  it('does NOT gate when Category itself is low confidence', () => {
    const confidences: Record<string, number> = {
      Category: 0.30,
      Management_Category: 0.25,
      Management_Object: 0.25,
    };
    const classification = { Category: 'maintenance' };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG, [], classification);
    // Category is low, so no gating — management fields stay
    expect(result).toContain('Category');
    expect(result).toContain('Management_Category');
    expect(result).toContain('Management_Object');
  });

  it('does NOT gate when classification is not provided (backward compat)', () => {
    const confidences: Record<string, number> = {
      Category: 0.70,
      Management_Category: 0.25,
    };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toContain('Management_Category');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wo-agent/core test -- --run --reporter=verbose confidence`
Expected: FAIL — new tests call with 4th argument that doesn't exist yet

**Step 3: Implement the gating logic**

In `confidence.ts`, update `determineFieldsNeedingInput`:

```typescript
/** Fields to exclude when Category is confidently resolved */
const MAINTENANCE_EXCLUDES = ['Management_Category', 'Management_Object'];
const MANAGEMENT_EXCLUDES = ['Maintenance_Category', 'Maintenance_Object', 'Maintenance_Problem'];

export function determineFieldsNeedingInput(
  confidences: Record<string, number>,
  config: ConfidenceConfig,
  missingFields?: readonly string[],
  classification?: Record<string, string>,
): string[] {
  const fields: string[] = [];

  for (const [field, confidence] of Object.entries(confidences)) {
    const band = classifyConfidenceBand(confidence, config);
    if (band === 'low') {
      fields.push(field);
    }
  }

  if (missingFields) {
    for (const field of missingFields) {
      if (!fields.includes(field)) {
        fields.push(field);
      }
    }
  }

  // Category gating: if Category is confident, exclude irrelevant cross-category fields
  if (classification && !fields.includes('Category')) {
    const category = classification['Category'];
    const excludes =
      category === 'maintenance' ? MAINTENANCE_EXCLUDES :
      category === 'management' ? MANAGEMENT_EXCLUDES :
      [];
    return fields.filter(f => !excludes.includes(f));
  }

  return fields;
}
```

**Step 4: Run tests**

Run: `pnpm --filter @wo-agent/core test -- --run --reporter=verbose confidence`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/classifier/confidence.ts packages/core/src/__tests__/classifier/confidence.test.ts
git commit -m "feat(confidence): add category gating to determineFieldsNeedingInput

When Category is confidently resolved as maintenance, exclude Management_Category
and Management_Object from fields needing input (and vice versa for management).
This prevents irrelevant follow-up questions for cross-category fields."
```

---

### Task 1: Update existing tests that call `determineFieldsNeedingInput`

**Files:**
- Modify: `packages/core/src/__tests__/classifier/confidence.test.ts` (existing tests)
- Check: any other test files calling `determineFieldsNeedingInput`

The function signature change adds an optional 4th parameter, so existing tests should still compile. But verify no assertions break due to the new filtering.

**Step 1: Search for all callers**

```bash
grep -rn "determineFieldsNeedingInput" packages/core/src/
```

**Step 2: Run full test suite**

Run: `pnpm --filter @wo-agent/core test -- --run`
Expected: ALL PASS (the new parameter is optional, so no breakage)

**Step 3: Commit** (only if changes were needed)

```bash
git commit -m "test: update existing tests for category gating parameter"
```

---

### Task 2: Wire classification into start-classification handler

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/start-classification.ts:139-141`

**Step 1: Pass classification to `determineFieldsNeedingInput`**

Change line ~139-141 from:

```typescript
const fieldsNeedingInput = output.needs_human_triage
  ? []
  : determineFieldsNeedingInput(computedConfidence, confidenceConfig, output.missing_fields);
```

To:

```typescript
const fieldsNeedingInput = output.needs_human_triage
  ? []
  : determineFieldsNeedingInput(computedConfidence, confidenceConfig, output.missing_fields, output.classification);
```

**Step 2: Run tests**

Run: `pnpm --filter @wo-agent/core test -- --run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/start-classification.ts
git commit -m "fix(classification): pass classification to determineFieldsNeedingInput

Enables category gating so maintenance issues don't generate
follow-up questions for Management fields."
```

---

### Task 3: Wire classification into answer-followups handler

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/answer-followups.ts`

**Step 1: Find the `determineFieldsNeedingInput` call and pass classification**

Search for the call in `answer-followups.ts` and add `output.classification` as the 4th argument, same pattern as Task 2.

**Step 2: Run tests**

Run: `pnpm --filter @wo-agent/core test -- --run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/answer-followups.ts
git commit -m "fix(followups): pass classification to determineFieldsNeedingInput in answer handler

Same category gating fix as start-classification, applied to re-classification
after follow-up answers are submitted."
```

---

### Task 4: Integration test — "leak in apartment" no longer asks about management

**Files:**
- Modify: `packages/core/src/__tests__/classifier/confidence-integration.test.ts`

**Step 1: Add integration test**

```typescript
describe('confidence integration: category gating', () => {
  const text = 'I have a leak in my apartment';

  const classification = {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'other_object',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  };

  const modelConfidence = {
    Category: 0.95,
    Location: 0.90,
    Sub_Location: 0.5,
    Maintenance_Category: 0.90,
    Maintenance_Object: 0.5,
    Maintenance_Problem: 0.95,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  };

  it('does NOT include Management fields in fieldsNeedingInput for maintenance issues', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config, [], classification);

    expect(fieldsNeedingInput).not.toContain('Management_Category');
    expect(fieldsNeedingInput).not.toContain('Management_Object');
  });

  it('still includes genuinely uncertain maintenance fields', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config, [], classification);

    // Maintenance_Object has no cue hits and low model confidence — should still need input
    expect(fieldsNeedingInput).toContain('Maintenance_Object');
  });
});
```

**Step 2: Run tests**

Run: `pnpm --filter @wo-agent/core test -- --run --reporter=verbose confidence-integration`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/classifier/confidence-integration.test.ts
git commit -m "test: add category gating integration tests

Verifies Management fields are excluded from fieldsNeedingInput
when Category=maintenance, while genuinely uncertain maintenance
fields (like Maintenance_Object) are still included."
```

---

## Expected Result

For "I have a leak in my apartment" after this fix:

| Field | Confidence | Band | In fieldsNeedingInput? |
|-------|-----------|------|----------------------|
| Category | 0.68 | MEDIUM | No |
| Location | 0.67 | MEDIUM | No |
| Maintenance_Category | 0.67 | MEDIUM | No |
| Maintenance_Problem | 0.68 | MEDIUM | No |
| Maintenance_Object | 0.35 | LOW | **Yes** (genuinely uncertain) |
| Priority | 0.63 | LOW | **Yes** (genuinely uncertain) |
| Management_Category | 0.25 | LOW | **No** (gated — maintenance issue) |
| Management_Object | 0.25 | LOW | **No** (gated — maintenance issue) |
| Sub_Location | ~0.42 | LOW | **Yes** (genuinely uncertain) |

Follow-up questions should only appear for Maintenance_Object, Priority, and Sub_Location — all genuinely relevant to a maintenance leak.
