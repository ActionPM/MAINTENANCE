# Plan: Live Confidence / Follow-Up Drift Hardening (Revised)

**Created**: 2026-03-26
**Revised**: 2026-03-26 (peer review round 2 corrections applied)
**Trigger**: Provider-backed `regression` eval gate FAILED — correct classifications over-asked due to medium-band confidence ceiling
**Status**: Ready for implementation
**Predecessor**: `docs/plans/hardening-classification-followup-policy.md` (Batch 1-3, executed 2026-03-25)
**Artifact**: `packages/evals/baselines/regression-run-1774528979119.json`

---

## Diagnosis

The regression eval returned correct taxonomy paths in most cases, but the release gate failed because:

1. **Structural ceiling**: Without `constraint_implied`, the confidence formula maxes at `0.40*1.0 + 0.25*1.0 + 0.20*0.95 = 0.84` — always below `high_threshold = 0.85`. Category gating (which requires Category to be high-confidence) essentially never fires for live classifications.

2. **Over-asking on required/risk-relevant fields**: Medium-band fields (0.65–0.84) that are required or risk-relevant always appear in `fieldsNeedingInput`, even when cue and model agree strongly. This generates 8–9 follow-up fields per issue.

3. **Management cross-domain leak**: Because Category confidence stays medium (0.68 for management cases), category gating never fires, so maintenance fields and Location/Sub_Location are never pruned from management issues.

4. **reg-007 schema failure**: Intercom classified as maintenance electrical object — a separate classifier/cue issue, not confidence drift.

This is a **policy-calibration problem** with one classifier outlier. The fix is a `resolved medium` acceptance layer plus a separate category-gating threshold, not a threshold reduction.

---

## Peer Review Corrections (from original plan)

| #   | Issue                                                                                                                          | Fix Applied                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `reg-006` Category=0.68 < proposed `resolved_medium_threshold=0.78` — plan's own acceptance criteria unreachable               | Added separate `category_gating_threshold: 0.70` for cross-domain pruning; strengthened management Category cues |
| 2   | `determineFieldsNeedingInput` only receives `Record<string, number>` — cannot check disagreement/ambiguity for resolved-medium | Changed `computeAllFieldConfidences` return to `Record<string, FieldConfidenceDetail>` with components           |
| 3   | Prompt changes for reg-007 require version bump                                                                                | Added PROMPT_VERSION bump to 2.2.0 and CUE_VERSION bump to 1.5.0                                                 |
| 4   | Section 3 (category pruning with resolved medium) was redundant                                                                | Merged into new Section 3 with separate `category_gating_threshold`                                              |

### Round 2 Corrections

| #   | Issue                                                                                                                                           | Fix Applied                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Domain hints added "unconditionally" to v1/v2 breaks version-pinning semantics for sessions pinned to 2.0.0/2.1.0                               | Added `DOMAIN_HINTS_VERSION = '2.2.0'` gate; hints only emitted when `promptVersion >= 2.2.0`; tests prove 2.1.x does not get hint text |
| 6   | `categoryGatable` lacks ambiguity guard — mixed-domain texts can be over-pruned with only confidence+disagreement checks                        | Added `ambiguityPenalty <= config.resolved_medium_max_ambiguity` to category gating condition (reuses existing config field)            |
| 7   | Provider-backed eval baseline/gate strategy not specified — implementer cannot tell if fixture baselines or live baselines are the release gate | Added explicit baseline strategy section: first provider run establishes live baselines, subsequent runs compare live-to-live           |
| 8   | "Also strengthen maintenance Category cues" is too vague and risks false positives                                                              | Removed maintenance cue expansion from this plan; scoped Batch 3 to management-only cue changes                                         |
| 9   | reg-007 regression test placed in confidence-integration.test.ts but failure is classifier/schema-layer                                         | Moved reg-007 tests to a new issue-replay-level test file targeting the actual failing layer                                            |

---

## Batch 1 — Observability + Data Flow Refactor

### Task 1.1: Define `FieldConfidenceDetail` type

**Files**:

- `packages/core/src/classifier/confidence.ts`

**Change**: Add a new interface that carries both the final score and the raw components:

```typescript
export interface FieldConfidenceComponents {
  readonly cueStrength: number;
  readonly completeness: number;
  readonly modelHint: number;
  readonly modelHintClamped: number;
  readonly constraintImplied: number;
  readonly disagreement: number;
  readonly ambiguityPenalty: number;
}

export interface FieldConfidenceDetail {
  readonly confidence: number;
  readonly components: FieldConfidenceComponents;
}
```

**Also update**: `packages/core/src/classifier/index.ts` barrel export to include the new types.

**Acceptance**: Types compile. No runtime changes yet.

---

### Task 1.2: Refactor `computeAllFieldConfidences` return type

**File**: `packages/core/src/classifier/confidence.ts`

**Change**: `computeAllFieldConfidences` currently returns `Record<string, number>`. Change to `Record<string, FieldConfidenceDetail>`.

Before (line 74):

```typescript
export function computeAllFieldConfidences(input: ComputeAllInput): Record<string, number> {
```

After:

```typescript
export function computeAllFieldConfidences(input: ComputeAllInput): Record<string, FieldConfidenceDetail> {
```

Inside the loop, capture components alongside the final score:

```typescript
const clampedHint = Math.max(config.model_hint_min, Math.min(config.model_hint_max, rawModelHint));
const conf = computeFieldConfidence({
  cueStrength,
  completeness,
  modelHint: rawModelHint,
  constraintImplied,
  disagreement,
  ambiguityPenalty: ambiguityPenalty,
  config,
});

result[field] = {
  confidence: conf,
  components: {
    cueStrength,
    completeness,
    modelHint: rawModelHint,
    modelHintClamped: clampedHint,
    constraintImplied,
    disagreement,
    ambiguityPenalty,
  },
};
```

**Do not change**: `computeFieldConfidence` (single-field formula) — it stays as-is.

**Acceptance**: Return type is `Record<string, FieldConfidenceDetail>`. All callers that previously accessed `result[field]` as a number now need `result[field].confidence`.

---

### Task 1.3: Update `determineFieldsNeedingInput` to accept richer structure

**File**: `packages/core/src/classifier/confidence.ts`

**Change**: Update `DetermineFieldsOptions.confidenceByField` to accept `Record<string, FieldConfidenceDetail>`:

```typescript
export interface DetermineFieldsOptions {
  readonly confidenceByField: Record<string, FieldConfidenceDetail>;
  readonly config: ConfidenceConfig;
  readonly missingFields?: readonly string[];
  readonly classificationOutput?: Record<string, string>;
  readonly fieldPolicy?: FieldPolicyMetadata;
}
```

Inside `determineFieldsNeedingInput`, change `Object.entries(opts.confidenceByField)` to destructure the detail:

```typescript
for (const [field, detail] of Object.entries(opts.confidenceByField)) {
  const band = classifyConfidenceBand(detail.confidence, config);
  // ... existing logic uses detail.confidence where it previously used confidence
}
```

The components (`detail.components.disagreement`, `detail.components.ambiguityPenalty`) are now available for the resolved-medium and category-gating logic added in Batch 2.

**Acceptance**: Function signature updated. Callers still compile (after Task 1.4 fixes them).

---

### Task 1.4: Fix all callers of `computeAllFieldConfidences`

Two callers need updating:

**File 1**: `packages/core/src/orchestrator/action-handlers/start-classification.ts` (line ~272)

Currently:

```typescript
const computedConfidence = computeAllFieldConfidences({ ... });
```

`computedConfidence` is used in two places:

- Passed to `determineFieldsNeedingInput` (already accepts the new type after Task 1.3)
- Stored in `classificationResults[].computedConfidence` — check how this is consumed downstream

If downstream code only needs `Record<string, number>`, extract it:

```typescript
const confidenceDetail = computeAllFieldConfidences({ ... });
const computedConfidence: Record<string, number> = {};
for (const [field, detail] of Object.entries(confidenceDetail)) {
  computedConfidence[field] = detail.confidence;
}
```

Pass `confidenceDetail` to `determineFieldsNeedingInput`. Keep `computedConfidence` (flat numbers) for the event payload and any downstream code that expects numbers.

**File 2**: `packages/evals/src/runners/issue-replay.ts` (line ~146)

Same pattern — extract flat `confidenceByField` for the result, pass the detail object to `determineFieldsNeedingInput`.

**Acceptance**: `pnpm typecheck` passes. Both callers compile and produce the same runtime behavior as before.

---

### Task 1.5: Extend eval output with confidence components

**File**: `packages/evals/src/runners/issue-replay.ts`

**Change**: Add `confidenceComponents` to `IssueReplayResult`:

```typescript
export interface IssueReplayResult {
  // ... existing fields ...
  readonly confidenceComponents?: Record<string, FieldConfidenceComponents>;
}
```

In `runIssueReplay`, populate it from the detail object:

```typescript
const componentsMap: Record<string, FieldConfidenceComponents> = {};
for (const [field, detail] of Object.entries(confidenceDetail)) {
  componentsMap[field] = detail.components;
}
```

**File**: `packages/evals/src/cli/run-eval.ts` (line ~306)

Add `confidenceComponents` to the per-result output:

```typescript
results: allResults.map((r) => ({
  example_id: r.example_id,
  status: r.status,
  classification: r.classification,
  confidenceByField: r.confidenceByField,
  confidenceComponents: r.confidenceComponents,  // NEW
  fieldsNeedingInput: r.fieldsNeedingInput,
  hierarchyValid: r.hierarchyValid,
  errors: r.errors,
})),
```

**Acceptance**: Next eval run produces `confidenceComponents` per result. Existing comparison/metrics code is unaffected (it doesn't read these fields).

---

### Task 1.6: Update unit tests for new return type

**File**: `packages/core/src/__tests__/classifier/confidence.test.ts`

All tests that call `computeAllFieldConfidences` and check the return value need updating:

Before: `expect(result.Category).toBeCloseTo(0.84, 2)`
After: `expect(result.Category.confidence).toBeCloseTo(0.84, 2)`

All tests that call `determineFieldsNeedingInput` and pass `confidenceByField` need updating:

Before: `confidenceByField: { Category: 0.9, ... }`
After: `confidenceByField: { Category: { confidence: 0.9, components: { ... } }, ... }`

Create a test helper to reduce boilerplate:

```typescript
function simpleDetail(confidence: number): FieldConfidenceDetail {
  return {
    confidence,
    components: {
      cueStrength: 0,
      completeness: 1,
      modelHint: 0.5,
      modelHintClamped: 0.5,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
    },
  };
}
```

**File**: `packages/core/src/__tests__/classifier/confidence-integration.test.ts`

Same pattern. Integration tests call `computeAllFieldConfidences` and then pass its output to `determineFieldsNeedingInput`. These should work without changes to the test flow (only assertions change from `result.field` to `result.field.confidence`).

**Acceptance**: `pnpm --filter @wo-agent/core test` passes with all existing tests green.

---

### Review checkpoint: Batch 1

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Batch 1 is a pure refactor — same runtime behavior, richer types. No policy changes. All existing tests should pass after mechanical assertion updates.

---

## Batch 2 — Resolved Medium Acceptance + Category Gating Threshold

### Task 2.1: Add new config fields to `ConfidenceConfig`

**File**: `packages/schemas/src/confidence-config.ts`

**Change**: Extend `ConfidenceConfig` with three new fields:

```typescript
export interface ConfidenceConfig {
  // ... existing fields ...
  readonly resolved_medium_threshold: number;
  readonly resolved_medium_max_ambiguity: number;
  readonly category_gating_threshold: number;
}
```

Update `DEFAULT_CONFIDENCE_CONFIG`:

```typescript
export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  high_threshold: 0.85,
  medium_threshold: 0.65,
  model_hint_min: 0.2,
  model_hint_max: 0.95,
  resolved_medium_threshold: 0.78,
  resolved_medium_max_ambiguity: 0.2,
  category_gating_threshold: 0.7,
  weights: {
    /* unchanged */
  },
} as const;
```

**Rationale for thresholds**:

- `resolved_medium_threshold: 0.78` — a field must be well above medium (0.65) with strong signals to be auto-accepted. Without constraint_implied, the formula max is 0.84, so 0.78 requires cue_strength ~0.8+ and model_hint ~0.7+ with no penalties.
- `resolved_medium_max_ambiguity: 0.20` — if top-2 cue candidates are within 20% of each other, the cue signal is too ambiguous for auto-acceptance.
- `category_gating_threshold: 0.70` — lower than resolved_medium because category pruning only removes obviously irrelevant cross-domain fields, not accepting a value. At 0.70 with disagreement=0 and low ambiguity, the cue and model agree on the category. This captures management cases at 0.68 when cues are strengthened (Task 3.1 brings management Category cue_strength from 0.6 to 1.0).

**Acceptance**: Types compile. Existing code that destructures config still works (new fields are additive).

---

### Task 2.2: Implement resolved-medium acceptance in `determineFieldsNeedingInput`

**File**: `packages/core/src/classifier/confidence.ts`

**Change**: In the main loop of `determineFieldsNeedingInput`, add a resolved-medium check for medium-band fields:

```typescript
for (const [field, detail] of Object.entries(opts.confidenceByField)) {
  const band = classifyConfidenceBand(detail.confidence, config);

  if (band === 'low') {
    needed.add(field);
  } else if (band === 'medium') {
    // Resolved medium: accept if field has strong, unambiguous signals
    const isResolvedMedium =
      detail.confidence >= config.resolved_medium_threshold &&
      detail.components.disagreement === 0 &&
      detail.components.ambiguityPenalty <= config.resolved_medium_max_ambiguity &&
      !isMissingField(field, opts.missingFields);

    // Priority=emergency is never auto-accepted from resolved medium
    const isEmergencyPriority =
      field === 'Priority' && opts.classificationOutput?.['Priority'] === 'emergency';

    if (isResolvedMedium && !isEmergencyPriority) {
      // Accepted — do not add to needed
    } else {
      // Original medium-band logic: ask if required OR risk-relevant
      const isRequired = fieldPolicy.requiredFields.includes(field);
      const isRiskRelevant = fieldPolicy.riskRelevantFields.includes(field);
      if (isRequired || isRiskRelevant) {
        needed.add(field);
      }
    }
  }
  // high band: accepted as-is (no change)
}
```

Add helper:

```typescript
function isMissingField(field: string, missingFields?: readonly string[]): boolean {
  return missingFields?.includes(field) ?? false;
}
```

**Resolved medium conditions** (all must be true):

1. `confidence >= resolved_medium_threshold` (0.78)
2. `disagreement === 0` (cue and model agree)
3. `ambiguityPenalty <= resolved_medium_max_ambiguity` (0.20) (cue signal is clear)
4. Field is not in `missingFields` (classifier produced a value)
5. Not `Priority=emergency` (must stay on strict path due to downstream escalation)

**What this does NOT change**:

- Low-confidence fields — always asked
- High-confidence fields — always accepted
- Missing fields — always asked (merged separately)
- Constraint-implied fields — still removed post-hoc
- Completeness gate results — still merged post-hoc

**Acceptance**: A field at 0.84 with disagreement=0 and ambiguity=0 is NOT added to `fieldsNeedingInput` even if it's required. A field at 0.84 with disagreement=1 IS added. Priority=emergency at 0.84 IS added.

---

### Task 2.3: Implement category gating threshold

**File**: `packages/core/src/classifier/confidence.ts`

**Change**: Replace the existing category-gating block (lines 182-200) with a two-tier gating system:

```typescript
// Category gating: when Category is confidently resolved, prune cross-domain fields.
// Two tiers:
//   1. category_gating_threshold (0.70) — sufficient for cross-domain pruning
//      (removes obviously irrelevant fields). Requires disagreement=0 AND low ambiguity.
//   2. resolved_medium_threshold (0.78) — also removes Category itself from
//      fieldsNeedingInput (handled above in resolved-medium logic).
if (opts.classificationOutput) {
  const categoryDetail = opts.confidenceByField['Category'];
  const category = opts.classificationOutput['Category'];

  const categoryGatable =
    categoryDetail &&
    categoryDetail.confidence >= config.category_gating_threshold &&
    categoryDetail.components.disagreement === 0 &&
    categoryDetail.components.ambiguityPenalty <= config.resolved_medium_max_ambiguity;

  if (categoryGatable && category) {
    const excludes =
      category === 'maintenance'
        ? MAINTENANCE_EXCLUDES
        : category === 'management'
          ? MANAGEMENT_EXCLUDES
          : [];
    const filtered = fields.filter((f) => !excludes.includes(f));

    if (category === 'management') {
      return filtered.filter((f) => f !== 'Location' && f !== 'Sub_Location');
    }

    return filtered;
  }
}

return fields;
```

**Key difference from before**: The old guard was `!fields.includes('Category')` — meaning Category had to be HIGH confidence (not in fieldsNeedingInput at all). The new guard requires three conditions:

1. `categoryDetail.confidence >= category_gating_threshold` (0.70) — above a minimum confidence floor
2. `categoryDetail.components.disagreement === 0` — cue and model agree on the category
3. `categoryDetail.components.ambiguityPenalty <= config.resolved_medium_max_ambiguity` (0.20) — the cue signal is not confused between maintenance and management

The ambiguity guard is critical because category gating prunes entire field groups. A mixed-domain text (e.g., "the intercom buzzer wiring is broken") might have high Category ambiguity — both maintenance and management cues fire. Without the ambiguity check, the pruning would remove potentially relevant fields. Reusing `resolved_medium_max_ambiguity` avoids adding a fourth config field for the same semantic concept.

**This means**: Even if Category is still in `fieldsNeedingInput` (e.g., it's at 0.72, required, not resolved-medium), cross-domain pruning can still fire — as long as the cue signal is clear. The tenant may still be asked about Category, but they won't be bothered with irrelevant maintenance fields on a management issue.

**Acceptance**:

- Management issue with Category=0.70, disagreement=0, ambiguity=0.10 → maintenance fields + Location/Sub_Location pruned
- Management issue with Category=0.70, disagreement=1, ambiguity=0 → no pruning (disagreement blocks)
- Management issue with Category=0.70, disagreement=0, ambiguity=0.25 → no pruning (ambiguity too high)
- Management issue with Category=0.60, disagreement=0, ambiguity=0 → no pruning (below threshold)
- Maintenance issue with Category=0.72, disagreement=0, ambiguity=0 → management fields pruned
- Existing tests for Category gating still pass (old behavior was a stricter subset)

---

### Task 2.4: Unit tests for resolved-medium acceptance

**File**: `packages/core/src/__tests__/classifier/confidence.test.ts`

**New test suite: "resolved medium acceptance"**:

1. **Field at 0.84, disagreement=0, ambiguity=0, required** → NOT in fieldsNeedingInput
2. **Field at 0.84, disagreement=1, ambiguity=0, required** → IN fieldsNeedingInput (disagreement blocks resolved medium)
3. **Field at 0.84, disagreement=0, ambiguity=0.21, required** → IN fieldsNeedingInput (ambiguity exceeds max)
4. **Field at 0.84, disagreement=0, ambiguity=0.20, required** → NOT in fieldsNeedingInput (boundary: exactly 0.20 is accepted)
5. **Field at 0.77, disagreement=0, ambiguity=0, required** → IN fieldsNeedingInput (below resolved_medium_threshold)
6. **Field at 0.78, disagreement=0, ambiguity=0, required** → NOT in fieldsNeedingInput (boundary: exactly 0.78 is accepted)
7. **Priority=emergency at 0.84, disagreement=0, ambiguity=0** → IN fieldsNeedingInput (emergency excluded)
8. **Priority=normal at 0.84, disagreement=0, ambiguity=0** → NOT in fieldsNeedingInput (non-emergency accepted)
9. **Priority=high at 0.84, disagreement=0, ambiguity=0** → NOT in fieldsNeedingInput
10. **Field at 0.84, disagreement=0, ambiguity=0, in missingFields** → IN fieldsNeedingInput (missing blocks resolved medium)
11. **Medium non-required non-risk-relevant at 0.70** → NOT in fieldsNeedingInput (unchanged from before — medium non-required was already silent)
12. **Low-confidence field at 0.60** → IN fieldsNeedingInput (unchanged)

**Acceptance**: All 12 tests pass.

---

### Task 2.5: Unit tests for category gating threshold

**File**: `packages/core/src/__tests__/classifier/confidence.test.ts`

**New test suite: "category gating threshold"**:

1. **Category=management at 0.70, disagreement=0, ambiguity=0** → Maintenance_Category, Maintenance_Object, Maintenance_Problem, Location, Sub_Location pruned
2. **Category=management at 0.70, disagreement=1, ambiguity=0** → no pruning (disagreement blocks gating)
3. **Category=management at 0.70, disagreement=0, ambiguity=0.25** → no pruning (ambiguity too high)
4. **Category=management at 0.70, disagreement=0, ambiguity=0.20** → pruning fires (boundary: exactly 0.20 is accepted)
5. **Category=management at 0.69, disagreement=0, ambiguity=0** → no pruning (below threshold)
6. **Category=management at 0.70, disagreement=0, ambiguity=0, boundary** → pruning fires (exactly at threshold)
7. **Category=maintenance at 0.72, disagreement=0, ambiguity=0** → Management_Category, Management_Object pruned
8. **Category=maintenance at 0.72, disagreement=0, ambiguity=0** → Location and Sub_Location NOT pruned (only management prunes location)
9. **Backwards compatibility: Category at 0.90 (high), ambiguity=0** → still prunes as before
10. **Mixed-domain text: Category=management at 0.72, disagreement=0, ambiguity=0.50** → no pruning (high ambiguity between maintenance and management cues blocks gating)

**Acceptance**: All 10 tests pass. Existing category-gating tests still pass.

---

### Task 2.6: Integration tests for resolved-medium + category gating

**File**: `packages/core/src/__tests__/classifier/confidence-integration.test.ts`

**New test suite: "live confidence drift regressions"**:

1. **reg-001 anchor**: Maintenance plumbing with cue_strength=0.6, model_hint=0.95, no disagreement, no ambiguity → Category at 0.84 is resolved-medium → category gating fires → Management_Category/Management_Object pruned → fieldsNeedingInput reduced from 8+ to ≤4
2. **reg-006 anchor**: Management rent-charge with Category cue*strength=1.0 (after cue strengthening), model_hint=0.95, no disagreement → Category confidence reaches 0.84 → resolved-medium fires → category gating fires → Location, Sub_Location, Maintenance*\* pruned
3. **reg-010 anchor**: Slow faucet drip, Priority=low at medium confidence → Priority NOT in fieldsNeedingInput (low/normal/high are resolved-medium eligible)
4. **reg-021 anchor**: No-heat HVAC with strong cue/model agreement → Maintenance_Category at resolved-medium → NOT asked
5. **Emergency priority strict path**: Priority=emergency at 0.84 with strong signals → STILL in fieldsNeedingInput

**Acceptance**: All 5 integration tests pass.

---

### Review checkpoint: Batch 2

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Batch 2 is the core policy change. All resolved-medium and category-gating behavior is deterministic and fully unit-tested. No LLM behavior changes yet.

---

## Batch 3 — Category Gating Threshold: Cue Dictionary Strengthening

### Task 3.1: Strengthen management Category cues

**File**: `packages/schemas/classification_cues.json`

**Problem**: Management Category currently has only 5 keywords (`rent`, `lease`, `move out`, `receipt`, `payment`). A single keyword match gives cue_strength=0.6. With the formula `0.40*0.6 + 0.25*1 + 0.20*0.95 = 0.68`, Category confidence is too low for resolved-medium (0.78) and barely reaches category_gating_threshold (0.70).

**Change**: Add keywords and regex patterns to the management Category cues:

```json
"management": {
  "keywords": [
    "rent", "lease", "move out", "receipt", "payment",
    "billing", "charges", "invoice", "account", "balance",
    "deposit", "renewal", "notice", "agreement", "amenity",
    "booking", "reservation", "parking", "storage", "key fob"
  ],
  "regex": [
    "\\b(rent|lease|billing|payment|invoice)\\s*(charge|question|issue|inquiry|receipt|increase)?\\b",
    "\\b(move\\s*(in|out)|lease\\s*(renewal|inquiry|question))\\b",
    "\\b(parking|storage|locker)\\s*(spot|unit|space|rental)\\b"
  ]
}
```

With 2+ keyword matches (e.g., "rent charges"), cue_strength reaches 1.0, pushing Category confidence to `0.40*1.0 + 0.25*1.0 + 0.20*0.95 = 0.84` — well above both thresholds.

**Scope**: This task is management-only. Do NOT modify maintenance Category cues in this plan. Maintenance cues already have 52 keywords + 2 regex patterns and were not a failure mode in the regression run. Any maintenance cue expansion should be a separate plan with its own regression anchors.

**Acceptance**: Management messages with words like "rent charges", "lease renewal", "billing inquiry" produce cue_strength >= 0.6 for Category=management. Messages with 2+ management keywords produce cue_strength=1.0.

---

### Task 3.2: Add booking_scheduling cues to Management_Object

**File**: `packages/schemas/classification_cues.json`

**Problem**: `booking_scheduling` has NO cues in the current dictionary (confirmed by exploration). This means any booking-related message gets zero cue signal for Management_Object.

**Change**: Add a new entry:

```json
"booking_scheduling": {
  "keywords": [
    "booking", "reservation", "schedule", "appointment",
    "amenity booking", "room booking", "party room",
    "common room", "meeting room", "reserve"
  ],
  "regex": [
    "\\b(book|reserve|schedule)\\s+(a\\s+)?(room|amenity|space|time)\\b"
  ]
}
```

**Acceptance**: "I want to book the party room" produces a non-zero cue score for Management_Object=booking_scheduling.

---

### Task 3.3: Bump CUE_VERSION

**File**: `packages/schemas/src/version-pinning.ts`

**Change**: `CUE_VERSION = '1.4.0'` → `CUE_VERSION = '1.5.0'`

**Rationale**: Cue dictionary content changed in Tasks 3.1-3.2. Version-pinned conversations retain their pinned cue_version, so existing sessions are unaffected.

**Acceptance**: `CUE_VERSION` exports as `'1.5.0'`. `resolveCurrentVersions()` returns `cue_version: '1.5.0'`.

---

### Review checkpoint: Batch 3

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Batch 3 is cue-dictionary-only. No code logic changes. Confidence scores for management cases should improve in integration tests.

---

## Batch 4 — reg-007 Classifier/Schema Fix

### Task 4.1: Strengthen intercom/building-access management cues

**File**: `packages/schemas/classification_cues.json`

**Problem**: reg-007 classifies intercom as maintenance/electrical. The intercom cue exists under Management_Object but the Category-level cue for management may not fire strongly enough, and there's no explicit negative signal for maintenance.

**Change**:

- Add intercom-related keywords to the **Management_Category=general** cues: `"intercom issue"`, `"buzzer issue"`, `"door entry"`
- Verify the **Management_Object=intercom** cues are strong: `"intercom"`, `"buzzer"`, `"door entry"`, `"visitor access"`, `"entry system"`, `"call box"`
- Add regex to Management_Object.intercom: `"\\b(intercom|buzzer|door\\s*entry|entry\\s*system)\\b"`

**Acceptance**: "The intercom at the front door isn't working" produces cue_strength >= 0.6 for Management_Object=intercom AND Management_Category=general.

---

### Task 4.2: Add classifier prompt guidance for intercom/building-access (version-gated)

**File**: `packages/core/src/llm/prompts/classifier-prompt.ts`

**Change**: Add a new version constant and gated domain-hint block:

```typescript
export const DOMAIN_HINTS_VERSION = '2.2.0';
```

In `buildClassifierSystemPrompt`, add a version-gated block (same pattern as `PRIORITY_GUIDANCE_VERSION`):

```typescript
if (compareSemver(promptVersion, DOMAIN_HINTS_VERSION) >= 0) {
  sections.push(DOMAIN_HINTS_BLOCK);
}
```

The hint text (added to both v1 and v2 prompt builders, but only when `promptVersion >= 2.2.0`):

```
DOMAIN ASSIGNMENT HINTS:
- Intercom, buzzer, door-entry, and visitor-access issues are management (general/intercom)
  unless the tenant describes a specific electrical repair (e.g., "wires exposed", "sparking").
- Key fob programming, lockout, and room-access issues are management (general/building_access).
- Lock/key issues involving physical damage ("broken lock", "key snapped off") are maintenance (locksmith).
```

**Version-pinning semantics**: Sessions pinned to 2.0.0 or 2.1.0 will NOT receive domain hints. Only new sessions (pinned to 2.2.0+) get the new text. This preserves version-pinning integrity — a resumed 2.1.0 session sees the exact same prompt it was created with.

**Do not**: Add the hints unconditionally or outside the version gate. The prior plan's "unconditional" approach was incorrect.

**Acceptance**:

- `buildClassifierSystemPromptV2('2.2.0', ...)` includes "intercom" and "buzzer" domain guidance
- `buildClassifierSystemPromptV1('2.2.0', ...)` includes the same
- `buildClassifierSystemPromptV2('2.1.0', ...)` does NOT include domain guidance
- `buildClassifierSystemPromptV1('2.0.0', ...)` does NOT include domain guidance

---

### Task 4.3: Bump PROMPT_VERSION

**File**: `packages/schemas/src/version-pinning.ts`

**Change**: `PROMPT_VERSION = '2.1.0'` → `PROMPT_VERSION = '2.2.0'`

**Verification checklist**:

- `classifier-prompt.ts` uses `compareSemver(promptVersion, PRIORITY_GUIDANCE_VERSION)` where `PRIORITY_GUIDANCE_VERSION = '2.1.0'`. Since `2.2.0 >= 2.1.0`, Priority guidance is still included.
- `classifier-prompt.ts` uses `compareSemver(promptVersion, DOMAIN_HINTS_VERSION)` where `DOMAIN_HINTS_VERSION = '2.2.0'`. Since `2.2.0 >= 2.2.0`, domain hints are included for new sessions.
- `classifier-prompt.ts` uses `compareSemver(promptVersion, EVIDENCE_BASED_PROMPT_VERSION)` where `EVIDENCE_BASED_PROMPT_VERSION = '2.0.0'`. Since `2.2.0 >= 2.0.0`, v2 prompt is used.

**Acceptance**: `PROMPT_VERSION` exports as `'2.2.0'`. `resolveCurrentVersions()` returns `prompt_version: '2.2.0'`. Existing tests that check for Priority guidance still pass. New sessions get domain hints; resumed 2.1.0 sessions do not.

---

### Task 4.4: Add prompt-level tests for domain hints and version gating

**File**: `packages/core/src/__tests__/classifier/classifier-prompt-constraints.test.ts`

**Add tests**:

1. V2 prompt at version 2.2.0 includes "intercom" domain guidance text
2. V1 prompt at version 2.2.0 includes "intercom" domain guidance text
3. V2 prompt at version 2.2.0 includes "key fob" / "building_access" guidance text
4. **V2 prompt at version 2.1.0 does NOT include domain guidance text** (version gate test)
5. **V1 prompt at version 2.0.0 does NOT include domain guidance text** (version gate test)
6. V2 prompt at version 2.1.0 still includes Priority guidance (no regression from gate addition)

**Acceptance**: All 6 tests pass. Tests 4-5 prove that the version gate works correctly — pinned sessions see only the prompt text they were created with.

---

### Task 4.5: Add reg-007 targeted regression test (issue-replay layer)

**File**: New file `packages/evals/src/__tests__/runners/intercom-domain-regression.test.ts`

**Rationale**: reg-007 is a classifier/schema-domain failure, not a confidence failure. The bug is that the classifier assigns intercom to maintenance/electrical instead of management/general. Testing at the confidence-integration layer would miss the actual failure site — the intercom must be tested through the issue-replay pipeline where taxonomy validation, constraint checking, and cross-domain normalization all run.

**Test setup**:

- Use `FixtureClassifierAdapter` with two fixture scenarios:
  1. Correct: `Category=management, Management_Category=general, Management_Object=intercom`
  2. Incorrect (regression guard): `Category=maintenance, Maintenance_Category=electrical, Maintenance_Object=intercom` — should produce `taxonomy_fail` because `intercom` is not a valid `Maintenance_Object`

**Test cases**:

1. **"The intercom at the front door isn't working"** with correct fixture → `runIssueReplay()` returns `status: 'ok'`, `hierarchyValid: true`, classification includes `Management_Object: 'intercom'`
2. **"The buzzer at the front entrance doesn't ring"** with correct fixture → same outcome (paraphrase stability)
3. **Regression guard**: Same text with incorrect maintenance/electrical fixture → `runIssueReplay()` returns `status: 'taxonomy_fail'` or `hierarchyValid: false` (proves the pipeline catches the misclassification)

**Acceptance**: Tests 1-2 pass (correct domain assignment accepted). Test 3 confirms the taxonomy validator rejects `Maintenance_Object=intercom`. These tests protect the actual failing layer (classifier + taxonomy validation), not the confidence layer.

---

### Review checkpoint: Batch 4

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Batch 4 addresses reg-007 independently from confidence drift. The intercom case should no longer schema-fail.

---

## Batch 5 — Spec + Gap Tracker + Final Validation

### Task 5.1: Update spec with resolved-medium rule

**File**: `docs/spec.md`

**Change**: In §14.3 (confidence heuristic), add the resolved-medium rule as a policy layer:

> **Resolved Medium Acceptance (§14.3.1)**: A field in the medium band (≥ medium_threshold, < high_threshold) is accepted without follow-up when ALL of the following hold:
>
> - confidence ≥ resolved_medium_threshold (default: 0.78)
> - disagreement = 0 (cue and model agree on the label)
> - ambiguity_penalty ≤ resolved_medium_max_ambiguity (default: 0.20)
> - field is not in missing_fields
> - field is not Priority=emergency
>
> This rule does not change the confidence formula or thresholds. It adds a policy gate in follow-up field selection.

> **Category Gating Threshold (§14.3.2)**: Cross-domain field pruning fires when ALL of the following hold:
>
> - Category confidence ≥ category_gating_threshold (default: 0.70)
> - Category disagreement = 0 (cue and model agree on the category)
> - Category ambiguity_penalty ≤ resolved_medium_max_ambiguity (default: 0.20)
>
> This is independent of whether Category is in fieldsNeedingInput. The lower confidence threshold (vs. resolved_medium_threshold) reflects that pruning removes obviously irrelevant fields, not accepting a value. The ambiguity guard prevents over-pruning on mixed-domain texts where both maintenance and management cues fire.

**Acceptance**: Spec text matches implementation. No contradictions with existing §14.3 content.

---

### Task 5.2: Update spec-gap-tracker

**File**: `docs/spec-gap-tracker.md`

**Changes**:

- Add new row S14-12: "Resolved medium acceptance rule (§14.3.1)" — status DONE
- Add new row S14-13: "Category gating threshold (§14.3.2)" — status DONE
- Update S14-01 through S14-11 evidence dates
- Verify S15-xx rows — follow-up precision should improve; note the policy change
- Recount dashboard totals
- Update `Last updated` date

**Acceptance**: Tracker reflects the new policy. Dashboard totals are correct.

---

### Task 5.3: Establish provider-backed baselines (first run only)

**Decision**: Provider-backed (Anthropic adapter) eval runs are compared against **provider-backed baselines**, NOT fixture baselines. Fixture and live runs measure different things: fixture baselines validate deterministic pipeline logic; provider baselines validate end-to-end behavior including LLM variance.

**Baseline strategy**:

- The existing fixture baselines (`*-baseline.json` files) are untouched and remain the gate for `--adapter fixture` runs.
- Provider-backed runs write to a separate baseline family: `<dataset>-anthropic-baseline.json`.
- **First run**: The regression run from this plan (`regression-run-1774528979119.json`) is the pre-hardening provider snapshot. The first successful provider run after Batches 1-4 becomes the **post-hardening provider baseline**. Save it explicitly:
  ```
  # Shell-agnostic pseudocode — use cp (bash) or Copy-Item (PowerShell)
  copy  baselines/regression-run-<timestamp>.json  baselines/regression-anthropic-baseline.json
  ```
- **Subsequent runs**: Compare against the provider baseline using `--baseline baselines/regression-anthropic-baseline.json`.
- **Gate semantics**: The release gate compares the new provider run against the provider baseline. A provider run must not regress relative to the provider baseline on any blocking metric.

**Rationale**: Comparing a live run against a fixture baseline would conflate LLM variance with pipeline regression. The fixture gate catches deterministic bugs; the provider gate catches prompt/cue/policy drift.

**Command** (first run — establishes baseline):

```bash
pnpm --filter @wo-agent/evals eval:run --dataset regression --adapter anthropic
```

**Post-run**: If success criteria are met, copy the output as the provider baseline:

```
# Shell-agnostic pseudocode — use cp (bash) or Copy-Item (PowerShell)
copy  baselines/regression-run-<timestamp>.json  baselines/regression-anthropic-baseline.json
```

**Success criteria**:

- `field_accuracy` ≥ 0.85 (was 0.8491 pre-hardening)
- `schema_invalid_rate` ≤ 0.037 (no increase from pre-hardening snapshot)
- `contradiction_after_retry_rate` ≤ 0.037 (no increase)
- `followup_precision` materially improved from 0 (pre-hardening)
- reg-007 status = ok (not schema_fail)
- reg-006 fieldsNeedingInput does NOT contain Location, Sub*Location, Maintenance*\*
- reg-001, reg-021, reg-022: fieldsNeedingInput reduced from 8-9 to ≤4

---

### Task 5.4: Run provider-backed hard eval

**Prerequisite**: Task 5.3 passes and provider baseline is established.

```bash
pnpm --filter @wo-agent/evals eval:run --dataset hard --adapter anthropic
```

**Post-run**: If first provider run for `hard`, save as `hard-anthropic-baseline.json`.

**Success criteria**: No blocking-metric regression from pre-hardening hard run (if one exists). If no prior provider hard run, this establishes the baseline.

---

### Task 5.5: Run provider-backed gold-v1 eval

**Prerequisite**: Task 5.4 passes.

```bash
pnpm --filter @wo-agent/evals eval:run --dataset gold-v1 --adapter anthropic
```

**Post-run**: If first provider run for `gold-v1`, save as `gold-v1-anthropic-baseline.json`.

**Success criteria**: No blocking-metric regression from pre-hardening gold-v1 run (if one exists). If no prior provider gold-v1 run, this establishes the baseline.

---

### Task 5.6: Re-run deployed smoke tests

**Prerequisite**: Tasks 5.3-5.5 all pass.

Only after all three provider-backed eval gates pass, re-enable and run deployed smoke tests.

---

## Dependency Graph

```
Batch 1 (sequential — each task builds on prior):
  Task 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6

Batch 2 (after Batch 1; tasks 2.1-2.3 sequential, then tests parallel):
  Task 2.1 → 2.2 → 2.3
  Task 2.4, 2.5, 2.6 (parallel, after 2.3)

Batch 3 (after Batch 2):
  Task 3.1, 3.2 (parallel)
  Task 3.3 (after 3.1 + 3.2)

Batch 4 (parallel with Batch 3 — independent fix):
  Task 4.1, 4.2 (parallel)
  Task 4.3 (after 4.2)
  Task 4.4 (after 4.3)
  Task 4.5 (after 4.3; lives in evals package, no dependency on 4.4)

Batch 5 (after Batches 3 + 4):
  Task 5.1, 5.2 (parallel)
  Task 5.3 → 5.4 → 5.5 → 5.6 (sequential — each gate must pass)
```

## Assumptions

- `ANTHROPIC_API_KEY` remains available for provider-backed evals
- This pass is intentionally policy-first, not a prompt-only tweak
- No threshold reduction (`high_threshold` stays at 0.85) unless peer review explicitly rejects the resolved-medium approach
- No release/merge decision is made until provider-backed `regression` is green
- The `category_gating_threshold` is strictly for cross-domain pruning — it does NOT auto-accept Category's value
- Prompt version bump to 2.2.0 requires a `DOMAIN_HINTS_VERSION = '2.2.0'` gate; domain hints are version-gated, not unconditional
- Provider-backed evals compare against provider-backed baselines, not fixture baselines; first successful run establishes the baseline
- Maintenance Category cues are out of scope for this plan; only management cues are expanded

## Risk Notes

- **Batch 1** is zero-risk — pure type refactor with no behavior change
- **Batch 2** changes follow-up selection behavior. All changes are deterministic and unit-tested. Risk: a field at 0.78 with disagreement=0 and ambiguity=0.19 could be incorrectly accepted. Mitigation: the conditions are conservative (require model/cue agreement + low ambiguity).
- **Batch 3** changes cue dictionary content. Risk: new keywords could cause false-positive cue matches for unrelated messages. Mitigation: keywords are domain-specific and tested.
- **Batch 4** changes classifier prompt (version-gated to 2.2.0+). Risk: prompt changes could cause unexpected classification shifts on non-intercom cases for new sessions. Mitigation: gold-v1 eval gates against broad regression. Existing pinned sessions (2.1.0 and below) are completely unaffected by the version gate.
- **Batch 5** is validation-only. Risk: eval gate might still fail if live model behavior has shifted further. Mitigation: if regression gate fails after Batches 1-4, investigate before retrying.
