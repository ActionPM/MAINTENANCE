# Intercom Domain Policy Hardening + Gold-v1 Recovery Plan

**Status**: Ready for implementation
**Date**: 2026-03-26
**Predecessor**: hardening-classification-followup-policy.md (Batch 1-3 complete)
**Artifact**: `packages/evals/baselines/regression-run-1774528979119.json`
**Coordinates with**: live-confidence-followup-drift-hardening.md (ship this plan first)

---

## Summary

The regression provider run shows `reg-007` failing with `schema_fail` because the LLM returns `Maintenance_Object=intercom` — a value that doesn't exist in the taxonomy. The cue dictionary already maps intercom terms to the management domain, but the model ignores the cue signal.

This plan:

1. Adds a **deterministic domain-policy normalizer** that corrects known domain mismatches **before** taxonomy validation, treating intercom routing as a business rule enforced in code.
2. Mirrors the normalizer in the eval replay pipeline so production and eval behavior stay aligned.
3. Treats the current `gold-v1` dataset as a **diagnostic target** — the first provider-backed run must be created and analyzed before any baseline can be promoted.

## Non-Goals

- No taxonomy changes (intercom already exists as `Management_Object`).
- No new maintenance-side intercom path.
- No changes to the risk/emergency pipeline (it already operates post-classification independently).
- No prompt version bump in this plan (defer to drift hardening plan's v2.2.0 bump).

---

## Track 1: Domain Policy Normalizer

### Design

**What**: A typed policy map + normalizer function that deterministically corrects LLM output when:

1. The issue text matches known domain-policy trigger terms (regex/keyword), AND
2. The model returned a classification in the wrong domain (e.g., `Category=maintenance` for an intercom issue).

**Where in the pipeline**: Inside `callIssueClassifier()` at [issue-classifier.ts:70](packages/core/src/classifier/issue-classifier.ts#L70), **after** the LLM adapter returns raw output and **before** schema/taxonomy validation at line 73. This ensures:

- The normalizer corrects the classification before validation rejects it
- The retry mechanism is only consumed for genuine ambiguity, not for known policy mismatches
- The normalizer runs on both attempt 0 and attempt 1 (inside the loop)

**Policy rules (v1)**:

| Trigger Terms                                                           | Target Classification                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| intercom, buzzer, door entry, entry system, call box                    | Category=management, Management_Category=general, Management_Object=intercom        |
| key fob, access card, fob (when not "fob" as substring of another word) | Category=management, Management_Category=general, Management_Object=building_access |

**Normalization behavior**:

- Override: `Category`, `Management_Category`, `Management_Object`
- Set to `not_applicable`: `Maintenance_Category`, `Maintenance_Object`, `Maintenance_Problem`
- Preserve from model output: `Location`, `Sub_Location`, `Priority`
- Override `model_confidence` for corrected fields to `1.0` (deterministic = certain)
- Add corrected fields to `policyImpliedFields` on `ClassifierResult`, which both `start-classification.ts` and `answer-followups.ts` merge into `impliedFields` before confidence scoring. This intentionally reuses the existing `constraint_implied` channel in the confidence formula — domain-policy corrections and hierarchical constraint resolutions are both deterministic field-value locks, so the same confidence bonus is appropriate.

**Activation guard**: Only fires when the model returned `Category !== 'management'` or `Management_Object` doesn't match the policy target. If the model already classified correctly, the normalizer is a no-op.

### Confidence Impact Analysis

Domain-policy-corrected fields flow through the existing `constraint_implied` channel. In `confidence-config.ts`, `constraint_implied` is weighted at **0.25** (not 0.10 — the positive weights intentionally sum to 1.10 so constraint-implied fields can reach high band). With model_confidence=1.0 (clamped to 0.95) + cue_strength ~0.6 (single keyword hit) + constraint_implied=1:

```
confidence = 0.40 × 0.6 + 0.25 × 1.0 + 0.20 × 0.95 + 0.25 × 1.0 − 0 − 0 = 0.93
```

This lands solidly in the **high band** (≥ 0.85). With multiple keyword hits (cue_strength=1.0), confidence reaches 1.09 → clamped to 1.0. Even with a weak single-cue hit (cue_strength=0.3), confidence reaches 0.82 — above `resolved_medium_threshold` (0.78). Domain-policy-corrected fields will not trigger unnecessary follow-up questions under any realistic cue scenario.

---

## Track 2: Gold-v1 Recovery

### Current State

| Dataset         | Provider Run Exists?                    | Baseline Exists?                    | Status                                         |
| --------------- | --------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| regression-v0.2 | Yes (regression-run-1774528979119.json) | Yes (regression-v0.2-baseline.json) | schema_invalid_rate=3.7%, field_accuracy=0.849 |
| gold-v1         | **No**                                  | Yes (fixture only)                  | No provider data to analyze                    |
| hard            | Yes                                     | Yes (anthropic)                     | Separate from this plan                        |

### Strategy

1. Fix `schema_invalid_rate` via Track 1 (intercom normalizer eliminates the reg-007 failure).
2. Rerun regression provider eval to confirm `schema_invalid_rate=0` and `contradiction_after_retry_rate=0`.
3. Run **first-ever** gold-v1 provider eval (`--adapter anthropic`).
4. Analyze gold-v1 results by failure bucket before considering baseline promotion.

### Failure Buckets (for analysis)

| Bucket                    | Priority             | Example                                               |
| ------------------------- | -------------------- | ----------------------------------------------------- |
| schema_invalid            | P0 — blocks baseline | Field value not in taxonomy                           |
| contradiction_after_retry | P0 — blocks baseline | Cross-domain fields populated after constrained retry |
| taxonomy_policy_mismatch  | P1                   | Correct value exists but model chose wrong domain     |
| prompt_cue_miss           | P2                   | Model ignores strong cue signal                       |
| split_multi_issue_miss    | P2                   | Splitter under/over-splits                            |
| confidence_followup_miss  | P3                   | Wrong fields flagged for follow-up                    |

### Promotion Criteria

A gold-v1 provider baseline requires:

- `schema_invalid_rate = 0`
- `contradiction_after_retry_rate = 0`
- `needs_human_triage_rate < 0.05`
- One clean confirmation rerun with the same zero blocking-rate metrics

---

## Implementation Batches

### Batch 1: Domain Policy Infrastructure (no investigation needed)

#### Task 1.1 — Create `domain-policy.ts` with typed policy map

**File**: `packages/core/src/classifier/domain-policy.ts` (new)

Define:

```typescript
export interface DomainPolicyRule {
  readonly id: string;
  readonly triggerTerms: readonly string[];
  readonly triggerRegex: readonly RegExp[];
  readonly target: {
    readonly Category: string;
    readonly Management_Category: string;
    readonly Management_Object: string;
  };
}

export const DOMAIN_POLICIES: readonly DomainPolicyRule[] = [
  {
    id: 'intercom',
    triggerTerms: ['intercom', 'buzzer', 'door entry', 'entry system', 'call box'],
    triggerRegex: [/\b(intercom|buzzer|door\s*entry|entry\s*system|call\s*box)\b/i],
    target: {
      Category: 'management',
      Management_Category: 'general',
      Management_Object: 'intercom',
    },
  },
  {
    id: 'building_access',
    triggerTerms: ['key fob', 'access card'],
    triggerRegex: [/\b(key\s*fob|access\s*card)\b/i, /\bfob\s+(not|is|program|replace|need)\b/i],
    target: {
      Category: 'management',
      Management_Category: 'general',
      Management_Object: 'building_access',
    },
  },
];
```

Export the policy array and type. No runtime logic yet.

**Tests**: Type-level only — verify `DOMAIN_POLICIES` is non-empty and each rule has required fields.

**Estimated scope**: ~40 lines of source.

---

#### Task 1.2 — Create `domain-normalizer.ts` with normalization function

**File**: `packages/core/src/classifier/domain-normalizer.ts` (new)

Implement:

```typescript
export interface DomainNormalizationResult {
  readonly classification: Record<string, string>;
  readonly modelConfidence: Record<string, number>;
  readonly missingFields: readonly string[];
  readonly applied: boolean;
  readonly policyId?: string;
}

export function applyDomainNormalization(
  issueText: string,
  classification: Record<string, string>,
  modelConfidence: Record<string, number>,
  missingFields: readonly string[],
  policies?: readonly DomainPolicyRule[],
): DomainNormalizationResult;
```

Logic:

1. For each policy in `policies` (default: `DOMAIN_POLICIES`):
   a. Check if any `triggerRegex` matches `issueText`
   b. If match AND (`classification.Category !== policy.target.Category` OR `classification.Management_Object !== policy.target.Management_Object`):
   - Override `Category`, `Management_Category`, `Management_Object` from policy target
   - Set `Maintenance_Category`, `Maintenance_Object`, `Maintenance_Problem` to `not_applicable`
   - Preserve `Location`, `Sub_Location`, `Priority` from original classification
   - Set `model_confidence` for overridden fields to `1.0`
   - **Sanitize `missingFields`**: remove all six policy-touched fields (`Category`, `Management_Category`, `Management_Object`, `Maintenance_Category`, `Maintenance_Object`, `Maintenance_Problem`) from the array. These fields now have deterministic values — leaving them in `missingFields` would cause `determineFieldsNeedingInput` to unconditionally re-add them to `fieldsNeedingInput` (confidence.ts lines 239–243) and block resolved-medium acceptance (line 218), even though their confidence is 0.93+.
   - Return `{ applied: true, policyId: policy.id, ... }`
2. If no policy matches or classification already correct: return `{ applied: false, ... }` with original values (including unmodified `missingFields`).

First-match wins (policies are ordered by specificity).

**Estimated scope**: ~60 lines of source.

---

#### Task 1.3 — Unit tests for domain-normalizer

**File**: `packages/core/src/__tests__/classifier/domain-normalizer.test.ts` (new)

Test cases (~15 tests):

1. **Intercom term triggers normalization**: text="intercom is broken", classification=maintenance/electrical → normalized to management/general/intercom
2. **Buzzer variant**: text="buzzer not working" → management/general/intercom
3. **Door entry variant**: text="door entry system is broken" → management/general/intercom
4. **Call box variant**: text="call box doesn't ring" → management/general/intercom
5. **Key fob triggers building_access**: text="key fob not working" → management/general/building_access
6. **Access card variant**: text="access card won't scan" → management/general/building_access
7. **No-op when already correct**: text="intercom broken", classification=management/general/intercom → applied=false, missingFields unchanged
8. **No-op when no trigger terms**: text="toilet is leaking" → applied=false, missingFields unchanged
9. **Preserves Location/Sub_Location/Priority**: text="intercom broken in lobby", model has Location=building_interior → preserved after normalization
10. **Model confidence overridden for corrected fields**: overridden fields get model_confidence=1.0
11. **Model confidence preserved for non-overridden fields**: Location/Sub_Location/Priority keep original model_confidence
12. **Maintenance-like wording doesn't prevent normalization**: text="intercom wiring is bad, needs electrical repair" → still normalizes to management
13. **missing_fields sanitized: policy-overridden fields removed**: input missing_fields=['Category', 'Management_Object', 'Location'] → output missingFields=['Location'] (Category and Management_Object removed because they are now deterministic)
14. **missing_fields sanitized: policy-pruned maintenance fields removed**: input missing_fields=['Maintenance_Category', 'Maintenance_Object'] → output missingFields=[] (both set to not_applicable by policy)
15. **missing_fields pass-through on no-op**: when normalization doesn't fire, missingFields returned unchanged from input

---

### Batch 2: Pipeline Integration (depends on Batch 1)

#### Task 2.1 — Integrate normalizer into `callIssueClassifier`

**File**: `packages/core/src/classifier/issue-classifier.ts`

**Change**: Inside the validation loop (lines 58–108), after the LLM adapter returns raw output (line 63) and after schema validation succeeds (line 85), but **before** taxonomy validation (line 88):

```typescript
// After schema validation succeeds at line 85:
const schemaResult = validateClassifierOutput(raw);
if (!schemaResult.valid) {
  /* ... continue */
}

// NEW: Apply domain normalization before taxonomy validation
const normResult = applyDomainNormalization(
  `${input.issue_summary} ${input.raw_excerpt}`,
  schemaResult.data!.classification,
  schemaResult.data!.model_confidence,
  schemaResult.data!.missing_fields,
);
if (normResult.applied) {
  // Replace classification, model_confidence, and missing_fields on the validated output
  schemaResult.data = {
    ...schemaResult.data!,
    classification: normResult.classification,
    model_confidence: normResult.modelConfidence,
    missing_fields: normResult.missingFields,
  };
}

// Existing taxonomy validation continues with potentially-normalized classification
const domainResult = validateClassificationAgainstTaxonomy(
  schemaResult.data!.classification,
  taxonomy,
  taxonomyVersion,
);
```

**Note**: `schemaResult.data` is currently typed as readonly via `ValidationResult<T>`. We may need to use a local mutable copy. Check the `ValidationResult` type and adjust accordingly — e.g., `let validatedOutput = schemaResult.data!;` then mutate the local.

**Also**: Pass the `normResult.policyId` through so it can be logged in the classification event downstream. Add an optional `domainPolicyApplied?: string` field to `ClassifierResult`.

**Also**: When `normResult.applied`, add the overridden field names to a `policyImpliedFields` set that the action handler can merge into `impliedFields` for the confidence `constraint_implied` bonus.

**Why `missing_fields` must be sanitized here**: Both `start-classification.ts` and `answer-followups.ts` pass `output.missing_fields` to `determineFieldsNeedingInput`, which unconditionally adds every listed field to `fieldsNeedingInput` (confidence.ts lines 239–243) and blocks resolved-medium acceptance (line 218). If the model marked Category or Management_Object as missing before the policy override, the system would still ask about them after normalization unless they are removed from `missing_fields` at the point of correction.

**Estimated scope**: ~25 lines changed in issue-classifier.ts.

---

#### Task 2.2 — Thread policy-implied fields through to confidence scoring (both handlers)

Both `start-classification.ts` and `answer-followups.ts` call `callIssueClassifier`, then independently compute implied fields and confidence. The same `policyImpliedFields` merge is needed in both.

**File 1**: `packages/core/src/orchestrator/action-handlers/start-classification.ts`

After `callIssueClassifier` returns (line 127) and after constraint-implied fields are computed (line 220), merge policy-implied fields:

```typescript
// After line 220 (existing impliedFields from constraint resolution):
if (classifierResult.policyImpliedFields) {
  Object.assign(impliedFields, classifierResult.policyImpliedFields);
}
```

**File 2**: `packages/core/src/orchestrator/action-handlers/answer-followups.ts`

Same pattern after the reclassification `callIssueClassifier` call (line 173) and after constraint-implied fields are computed (line 275):

```typescript
// After line 277 (existing impliedFields from constraint resolution):
if (classifierResult.policyImpliedFields) {
  Object.assign(impliedFields, classifierResult.policyImpliedFields);
}
```

This ensures the `constraint_implied` bonus (weight=0.25) applies to domain-policy-corrected fields in both the initial classification path and the follow-up reclassification path. Without this, a tenant who answers follow-up questions would trigger reclassification that diverges from the initial pass — the normalizer would still fire inside `callIssueClassifier`, but the confidence scoring in `answer-followups.ts` wouldn't know those fields are policy-implied, potentially re-asking about fields already deterministically resolved.

**Estimated scope**: ~10 lines per handler, ~20 lines total.

---

#### Task 2.3 — Add event type and log domain normalization event (append-only)

The new event type `classification_domain_policy_applied` must be plumbed through the type system before it can be inserted.

**File 1**: `packages/core/src/classifier/classification-event.ts`

Add the new event type to the `ClassificationEvent` union. Currently the `event_type` field allows only two values:

```typescript
// Before:
event_type:
  | 'classification_hierarchy_violation_unresolved'
  | 'classification_constraint_resolution';

// After:
event_type:
  | 'classification_hierarchy_violation_unresolved'
  | 'classification_constraint_resolution'
  | 'classification_domain_policy_applied';
```

No changes needed in `event-repository.ts` — it accepts `ClassificationEvent` via `AnyInsertableEvent`, so the union expansion propagates automatically.

**File 2**: `packages/core/src/orchestrator/action-handlers/start-classification.ts`

After the classifier call, if `domainPolicyApplied` is set, insert the event:

```typescript
if (classifierResult.domainPolicyApplied) {
  await deps.eventRepo.insert({
    event_id: deps.idGenerator(),
    event_type: 'classification_domain_policy_applied',
    conversation_id: session.conversation_id,
    issue_id: issue.issue_id,
    payload: {
      policy_id: classifierResult.domainPolicyApplied,
      original_category: /* stash from pre-normalization output */,
      corrected_category: 'management',
    },
    created_at: deps.clock(),
  });
}
```

**File 3**: `packages/core/src/orchestrator/action-handlers/answer-followups.ts`

Same event insertion after the reclassification path, mirroring start-classification.

**Tests to update**: Any test in `packages/core/src/__tests__/` that asserts on the exhaustive set of `ClassificationEvent` event types or validates the event type union. Grep for `classification_hierarchy_violation_unresolved` and `classification_constraint_resolution` to find them.

**Estimated scope**: ~3 lines in classification-event.ts, ~15 lines per handler, ~5 lines test updates.

---

#### Task 2.4 — Integration tests for pipeline normalization

**File**: `packages/core/src/__tests__/classifier/issue-classifier.test.ts` (add tests to existing file)

Test cases (~7 tests):

1. **reg-007 reproduction**: LLM returns maintenance/electrical/intercom → normalized to management/general/intercom → taxonomy validation passes → `status: 'ok'`
2. **Normalization on retry attempt**: first attempt returns gibberish (schema fail), second attempt returns maintenance/intercom → normalized on second attempt → passes
3. **No normalization for non-intercom maintenance**: LLM returns maintenance/plumbing/toilet → no normalization → passes as-is
4. **Policy-implied fields in result**: when normalization fires, `policyImpliedFields` includes the overridden field names
5. **Model confidence overridden**: normalized output has model_confidence=1.0 for corrected fields
6. **Category gating not triggered after normalization**: since normalization sets maintenance fields to not_applicable, no cross-domain contradiction exists
7. **missing_fields sanitized through pipeline**: LLM returns missing_fields=['Category', 'Maintenance_Object'] for an intercom issue → after normalization, validated output.missing_fields contains neither Category nor Maintenance_Object → these fields do not appear in the downstream `fieldsNeedingInput`

---

### Batch 3: Eval Pipeline Alignment (depends on Batch 1)

#### Task 3.1 — Add domain normalization to eval issue-replay runner

**File**: `packages/evals/src/runners/issue-replay.ts`

After Step 1 (classify, line 74) and before Step 2 (validate against taxonomy, line 88), add domain normalization:

```typescript
// After line 74 (classify):
const normResult = applyDomainNormalization(
  issue_text,
  output.classification,
  output.model_confidence,
  output.missing_fields,
);
const effectiveClassification = normResult.applied
  ? normResult.classification
  : output.classification;
const effectiveConfidence = normResult.applied
  ? normResult.modelConfidence
  : output.model_confidence;
const effectiveMissingFields = normResult.applied
  ? normResult.missingFields
  : output.missing_fields;

// Use effectiveClassification, effectiveConfidence, effectiveMissingFields
// in subsequent steps (taxonomy validation, confidence, fieldsNeedingInput)
```

The `effectiveMissingFields` must be passed to `determineFieldsNeedingInput` at line 166 (currently `missingFields: output.missing_fields`). Without this, the eval replay pipeline would diverge from production — policy-corrected fields would still appear in `fieldsNeedingInput` in evals but not in production.

Import `applyDomainNormalization` from `@wo-agent/core` (add to barrel export).

**Estimated scope**: ~20 lines.

---

#### Task 3.2 — Export normalizer from core barrel

**File**: `packages/core/src/index.ts`

Add exports:

```typescript
export { applyDomainNormalization, DOMAIN_POLICIES } from './classifier/domain-normalizer.js';
export type { DomainPolicyRule, DomainNormalizationResult } from './classifier/domain-policy.js';
```

**Estimated scope**: ~4 lines.

---

#### Task 3.3 — Update intercom regression test to verify normalization

**File**: `packages/evals/src/__tests__/runners/intercom-domain-regression.test.ts`

Update the existing "regression guard" test (line 101–118). Currently it expects `taxonomy_fail` when the adapter returns `maintenance/electrical/intercom`. After the normalizer is in place, the expectation changes:

- **Before**: `maintenance/electrical/intercom` → `taxonomy_fail` (normalization didn't exist)
- **After**: `maintenance/electrical/intercom` → `ok` with `management/general/intercom` (normalizer corrects before validation)

Add new tests:

1. **Buzzer variant through replay pipeline**: adapter returns maintenance classification for "buzzer at entrance" → normalized to management/general/intercom → `status: 'ok'`
2. **Key fob through replay pipeline**: adapter returns maintenance for "key fob not working" → normalized to management/general/building_access → `status: 'ok'`
3. **Emergency + intercom**: issue text "intercom sparking and smoking" → normalized to management but Priority=emergency preserved from model

**Estimated scope**: ~60 lines (modify 1 test, add 3 tests).

---

### Batch 4: Regression Verification Run (depends on Batches 2-3)

#### Task 4.1 — Run regression provider eval

```bash
pnpm --filter @wo-agent/evals eval:run --dataset regression --adapter anthropic
```

Verify:

- `schema_invalid_rate = 0` (reg-007 no longer fails)
- `contradiction_after_retry_rate = 0`
- `field_accuracy >= 0.849` (no regression from baseline)
- All critical slices pass

If any metrics regress, investigate before proceeding.

---

#### Task 4.2 — Update regression baseline if clean

```bash
pnpm --filter @wo-agent/evals eval:update-baseline --dataset regression --adapter anthropic
```

Promote the clean run as `regression-anthropic-baseline.json`.

---

### Batch 5: Gold-v1 Provider Eval (depends on Batch 4)

#### Task 5.1 — Run first gold-v1 provider eval

```bash
pnpm --filter @wo-agent/evals eval:run --dataset gold-v1 --adapter anthropic
```

This is the first-ever provider-backed run of the 167-example, 214-issue gold-v1 dataset.

---

#### Task 5.2 — Analyze gold-v1 results by failure bucket

Build a failure inventory from the run output:

- Count results by status: `ok`, `schema_fail`, `taxonomy_fail`, `needs_human_triage`
- Bucket non-ok results by root cause (schema, contradiction, policy, prompt, split, confidence)
- Identify the highest-loss semantic slices (hvac, emergency, multi-issue, cross-domain)
- Prioritize fixes: P0 (schema/contradiction) → P1 (policy) → P2 (prompt/cue) → P3 (confidence)

Write findings to `docs/plans/gold-v1-provider-analysis.md` with specific example IDs and failure details.

---

#### Task 5.3 — Fix structural issues and rerun targeted subsets

For each P0/P1 issue found:

1. Identify root cause (missing taxonomy value, constraint gap, normalizer gap, prompt weakness)
2. Implement fix
3. Rerun only the affected slice/examples to verify

---

#### Task 5.4 — Promote gold-v1 provider baseline (when clean)

Only when:

- `schema_invalid_rate = 0`
- `contradiction_after_retry_rate = 0`
- `needs_human_triage_rate < 0.05`
- One clean confirmation rerun

```bash
pnpm --filter @wo-agent/evals eval:update-baseline --dataset gold-v1 --adapter anthropic
```

---

## Coordination Notes

### With Live Drift Hardening Plan

- **Ship this plan first**. The intercom normalizer is independent of confidence threshold changes.
- This plan does NOT bump prompt_version or cue_dict_version.
- Domain-policy-corrected fields reach ~0.93 confidence (high band) via the `constraint_implied` channel (weight=0.25), so the drift hardening plan's `resolved_medium_threshold` is not the gating factor — these fields are auto-accepted at the high band regardless.
- No merge conflicts expected: this plan touches `issue-classifier.ts` (validation loop only) and both action handlers (implied-fields merge only); drift hardening touches `confidence.ts` and `determineFieldsNeedingInput`.

### With Spec Gap Tracker

- No new spec-gap-tracker rows needed. S14-02 (category gating with constrained retry) already covers domain enforcement. The normalizer strengthens the existing mechanism.
- Update S14-02 evidence to note domain-policy normalization layer added.

---

## Files Changed Summary

| File                                                                      | Change Type                                                | Batch |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | ----- |
| `packages/core/src/classifier/domain-policy.ts`                           | **New**                                                    | 1     |
| `packages/core/src/classifier/domain-normalizer.ts`                       | **New**                                                    | 1     |
| `packages/core/src/__tests__/classifier/domain-normalizer.test.ts`        | **New**                                                    | 1     |
| `packages/core/src/classifier/issue-classifier.ts`                        | Modified (validation loop + policyImpliedFields on result) | 2     |
| `packages/core/src/classifier/classification-event.ts`                    | Modified (add event type to union)                         | 2     |
| `packages/core/src/orchestrator/action-handlers/start-classification.ts`  | Modified (implied fields merge + event)                    | 2     |
| `packages/core/src/orchestrator/action-handlers/answer-followups.ts`      | Modified (implied fields merge + event)                    | 2     |
| `packages/core/src/__tests__/classifier/issue-classifier.test.ts`         | Modified (add tests)                                       | 2     |
| `packages/core/src/index.ts`                                              | Modified (barrel export)                                   | 3     |
| `packages/evals/src/runners/issue-replay.ts`                              | Modified (add normalization step)                          | 3     |
| `packages/evals/src/__tests__/runners/intercom-domain-regression.test.ts` | Modified (update expectations)                             | 3     |

**Total**: 3 new files, 8 modified files. ~310 lines of new code + tests.
