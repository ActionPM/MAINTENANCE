# Implementation Plan: BUG-011 — Wrong Follow-Up Questions

> **Status:** Partially implemented — Fixes A-C coded and tested (1,379 tests pass), acceptance criterion 8 (Phase 0 live repro) and Fix D still open
> **Date:** 2026-03-31
> **Bug:** BUG-011 — Follow-up questions in wrong order, non-taxonomy options shown, no severity capture
>
> **Open items:**
>
> - **Phase 0 repro artifact not yet committed.** The plan requires a live LLM repro transcript proving which root-cause paths fire in the "I have a leak" scenario. Fixes A-C were implemented based on code-level root-cause analysis. Fix D (Priority gating relaxation) remains deferred until the repro confirms whether Priority is still unreachable after A-C. The repro requires `ANTHROPIC_API_KEY` (`.env.local`) and the dev server or eval replay framework.
> - **Fix C refinement:** `confirmedFields` parameter was added to `DetermineFieldsOptions` (not in original plan) so that Sub_Location is only blocked from resolved-medium on initial classification, not after the tenant has already confirmed it via a follow-up pin.

---

## 1. Deep Analysis: What Actually Happened

Replaying the screenshots against the code, the conversation went:

| Round | Agent Asked                                                                                                                                    | Tenant Answered       | Field                       | Taxonomy-Valid?                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | "Where is the leak located?" Options: In my apartment unit, Common area, Building exterior, Basement/garage, Other                             | In my apartment unit  | Location                    | **Options are LLM-paraphrased — "In my apartment unit" is not a taxonomy slug. Posted back as-is; pinned as `Location = "In my apartment unit"`, not `"suite"`.** |
| 2     | "What specific fixture or item is leaking?" Options: Toilet, Sink, Faucet, Drain, Pipe, Shower, Bathtub, Other                                 | Toilet                | Maintenance_Object          | Options are valid taxonomy values for `plumbing` objects                                                                                                          |
| 3     | "Where specifically in your apartment is the toilet leak occurring?" Options: Bathroom, Half bath/powder room, Master bathroom, Guest bathroom | Half bath/powder room | Sub_Location                | **"Half bath/powder room", "Master bathroom", "Guest bathroom" are NOT in taxonomy**                                                                              |
| 4     | (Not shown — but result is Object=Bathtub, Category=Management)                                                                                | Bathtub               | Maintenance_Object (re-ask) | Bathtub is valid but contradicts half-bath                                                                                                                        |
| End   | "Need a human" — Category=Management, Object=Bathtub, Problem=Leak                                                                             | —                     | —                           | Cross-domain contradiction triggers triage                                                                                                                        |

**Six distinct failures observed:**

1. **Location options are LLM paraphrases, not taxonomy slugs**: "In my apartment unit" gets pinned as `Location`, breaking downstream constraint lookups (pinned value doesn't match `suite` key in constraint maps)
2. **Wrong question order**: Object asked before Sub_Location (round 2 before round 3)
3. **Hallucinated Sub_Location options**: LLM inventions, not taxonomy values
4. **Inconsistent combination accepted**: Half-bath + Bathtub passed through
5. **Object asked twice**: Round 2 and again after round 3
6. **No Priority/severity question ever asked**: Conversation ended at triage before reaching Priority

---

## 2. Root Cause Analysis (Code-Level)

### Verified Root Cause 1 (Critical): Constraint hint threshold excludes Sub_Location

**Code path:** `followup-prompt.ts` lines 94-98

```typescript
if (valid && valid.length <= 10) {
  constraintHints.push(`  ${field}: valid options are [${valid.join(', ')}]`);
}
```

`Location_to_Sub_Location['suite']` has **12 values**. Threshold is `<= 10`. **No constraint hints are sent to the LLM for Sub_Location when Location=suite.**

**Verified:** Counted directly from `taxonomy_constraints.json`. 12 > 10. No ambiguity.

### Verified Root Cause 2 (Critical): Post-LLM fallback preserves hallucinated options

**Code path:** `followup-generator.ts` lines 228-236

```typescript
const opts = q.options.filter((opt) => valid.includes(opt));
return { ...q, options: opts.length > 0 ? opts : q.options };
```

When constraint filtering removes all LLM options, the fallback `q.options` **preserves the original hallucinated options**. Intent was to prevent empty option lists. Effect is a permanent hallucination leak.

**Verified:** Read the code directly; no alternative path.

### Verified Root Cause 3 (Critical): Unconstrained fields have no option guard at all

**Code path:** `followup-generator.ts` line 234

```typescript
if (valid === null) return q;
```

When `resolveValidOptions` returns null (no parent constraint applies — e.g., Location has no parent), the LLM's options pass through with **zero filtering**. The LLM generates "In my apartment unit" instead of `suite`, and this paraphrased string is:

1. Rendered as a radio button option (`followup-form.tsx` line 44)
2. Posted back as the raw answer value (`followup-form.tsx` line 50)
3. Pinned as `Location = "In my apartment unit"` (`answer-followups.ts` line 225)
4. Used in downstream constraint lookups where the key is `suite`

This is NOT cosmetic. The pinned value `"In my apartment unit"` does not match any constraint map key. `Location_to_Sub_Location["In my apartment unit"]` is undefined. Downstream constraint resolution, hierarchy validation, and option filtering all break silently because the value looks populated but doesn't exist in any map.

**What this does and does not explain about ordering:** An invalid Location pin corrupts all downstream constraint behavior — `resolveValidOptions('Sub_Location', ...)` returns null, constraint hints are absent, option filtering has nothing to filter against. However, it does **not** by itself explain object-first frontier selection. The frontier selector in `field-ordering.ts` does not require constraint lookups to succeed — it checks `isResolvedOrImpliedField`, which only tests whether the value is non-empty and non-vague. A paraphrased Location like `"In my apartment unit"` passes that check, so Sub_Location's parent gate is satisfied, and Sub_Location should still appear before Object in the frontier.

Object-first ordering requires Sub_Location to have dropped out of `fieldsNeedingInput` earlier in the pipeline — either via resolved-medium auto-accept (Root Cause addressed by Fix C) or via a confidence/cue path not fully traceable without live LLM outputs. **Phase 0 is what proves this link.** The invalid Location pin is a necessary precondition for the cascade of downstream failures, but the exact mechanism that removes Sub_Location from `fieldsNeedingInput` must be confirmed in repro.

**Verified:** Read `followup-form.tsx` (line 50 posts raw option string), `answer-followups.ts` (line 225 pins raw string), `constraint-resolver.ts` (map lookup uses pinned value as key).

### Verified Root Cause 4 (Important): Priority gated on full hierarchy resolution

**Code path:** `field-ordering.ts` lines 56-59

Priority requires ALL 5 maintenance hierarchy fields to be resolved. When upstream failures cause contradictions and early triage, Priority is never surfaced.

**Verified:** Read the code directly.

### Derived Root Cause 5: Category drift and premature triage

Downstream consequence of Root Causes 1-3. Corrupted Location pin → broken constraint chain → classifier receives contradictory signals → reclassifies as management → cross-domain contradiction → `needs_human_triage`. Fix upstream causes and this disappears.

---

## 3. Assessment: Second-Pass LLM Review

### Verdict: No new LLM pass needed for this bug

Every `ANSWER_FOLLOWUPS` action already re-runs the full classifier. The problem is that inputs to re-classification are corrupted by non-taxonomy option values the tenant selected from. Fixing taxonomy enforcement upstream eliminates the corruption.

### Future enhancement (separate tracker item)

A lightweight coherence check before the confirmation panel could catch classification drift in multi-round follow-ups even with correct inputs. This is a separate enhancement, not part of BUG-011.

---

## 4. Solution Design

### Phase 0 — Repro & Parity Checkpoint (Required before implementation)

Before implementing fixes, establish a baseline:

1. **Reproduce the exact bug** using the eval/replay framework or a manual test against the live LLM with `"I have a leak"` as input.
2. **Capture the raw LLM outputs** at each stage: classifier output, follow-up generator output, posted answers, pinned values.
3. **Verify which root cause(s) are active in the repro**: Is Location paraphrased? Is Sub_Location's hint missing? Does the fallback preserve hallucinated options?
4. **Confirm the frontier selector behavior**: Log `fieldsNeedingInput`, `capsCheck.eligibleFields`, and `frontierFields` at each round.

This resolves Root Cause 4's "Explanation B" (stale classifier behavior) by establishing whether the production session matches current code behavior.

**Deliverable:** A test transcript with raw state at each round, confirming which code paths are hit.

### Fix A — Enforce taxonomy-only options for ALL enum questions (Critical)

**Problem:** Two separate leaks let non-taxonomy options through:

1. Unconstrained fields (`valid === null`): LLM options pass unfiltered
2. Constrained fields where all options are hallucinated: fallback preserves LLM options

**Fix:** Replace the entire constraint filtering block with a two-tier guard:

```typescript
const constraintFiltered = filteredQuestions
  .map((q) => {
    if (q.answer_type !== 'enum') return q;

    const valid = resolveValidOptions(
      q.field_target,
      narrowedInput.classification,
      taxonomyConstraints,
    );

    if (valid !== null) {
      // Constrained field: filter to constraint-valid options only.
      const opts = q.options.filter((opt) => valid.includes(opt));
      if (opts.length > 0) return { ...q, options: opts };
      // All LLM options invalid → replace with constraint-valid taxonomy values.
      return { ...q, options: valid.slice(0, 10) };
    }

    // Unconstrained field: filter to full-taxonomy defaults.
    // This prevents LLM paraphrases (e.g., "In my apartment unit" for Location)
    // from being posted back as answers and pinned as non-taxonomy values.
    const taxonomyDefaults = DEFAULT_FALLBACK_OPTIONS[q.field_target];
    if (taxonomyDefaults) {
      const opts = q.options.filter((opt) => taxonomyDefaults.includes(opt));
      if (opts.length > 0) return { ...q, options: opts };
      return { ...q, options: [...taxonomyDefaults].slice(0, 10) };
    }

    // No taxonomy defaults for this field — drop the question entirely.
    // An enum question with no canonical option source cannot produce a
    // taxonomy-valid answer. The deterministic fallback mechanism downstream
    // will generate a replacement question for this field if it remains in
    // fieldsNeedingInput.
    return null;
  })
  .filter((q): q is NonNullable<typeof q> => q !== null);
```

**Key properties:**

- Enum questions ALWAYS have taxonomy-valid options. Never empty, never hallucinated.
- Constrained fields use constraint-filtered options, falling back to the full constraint-valid set.
- Unconstrained fields use the full-taxonomy defaults for that field, falling back to the defaults list.
- Text/yes_no questions are unaffected (no option filtering needed).
- `DEFAULT_FALLBACK_OPTIONS` covers all 9 taxonomy fields: Category, Location, Sub_Location, Maintenance_Category, Maintenance_Object, Maintenance_Problem, Management_Category, Management_Object, and Priority. `buildFallbackQuestion()` has a matching `case` for each field, returning an enum question with the constraint-resolved or taxonomy-default options.
- If an enum field has no canonical option source (no constraint map AND no taxonomy defaults), the question is dropped and rebuilt per-field from `buildFallbackQuestion()`. If all questions are dropped, the `buildDeterministicFallbackQuestions` path rebuilds from the frontier.

**Closed contract:** No enum question with raw LLM options ever reaches the tenant. The only paths are: constraint-valid options, taxonomy defaults, or the question is dropped and rebuilt deterministically per-field. Dropped questions are individually replaced (not only when all questions are dropped), so a surviving question in the same turn does not suppress the rebuild for a dropped field.

**Fallback coverage audit (completed):** `DEFAULT_FALLBACK_OPTIONS` now covers all enum fields. `Category` and `Sub_Location` were added alongside the filtering logic change. `buildFallbackQuestion()` has a `case 'Category'` returning "Is this a maintenance issue or a management issue?" with taxonomy.Category options.

### Fix B — Raise the constraint hint threshold (Critical)

**Problem:** `<= 10` threshold excludes Sub_Location for `Location=suite` (12 values).

**Fix:** Raise to 25. Covers all current taxonomy constraint maps. Prevents the LLM from inventing options in the first place (defense-in-depth; Fix A catches them regardless).

### Fix C — Exclude Sub_Location from resolved-medium auto-accept (Important)

**Problem:** Sub_Location could be auto-accepted by the resolved-medium gate, causing downstream fields to be asked first.

**Fix:** Add Sub_Location to an `alwaysConfirmFields` set that bypasses resolved-medium. Sub_Location always requires tenant confirmation in the medium band.

### Fix D — Relax Priority gating (Conditional)

**Problem:** Priority requires all 5 hierarchy fields to be resolved.

**Fix:** Relax to require only Location + Category.

**Condition:** This fix is deferred to a follow-up if Phase 0 repro shows that fixing A-C already allows Priority to be reached naturally (because the upstream ordering is correct once Location is taxonomy-valid). If Phase 0 confirms Priority is still unreachable after A-C, implement D.

**Acceptance rule for D if implemented:** Priority may only surface after the current frontier field has been asked. It does not jump ahead of the hierarchy — it only becomes _eligible_ with a lower gate. The frontier selector still picks the first unresolved hierarchy field before Priority.

---

## 5. BUG-009 Cross-Verification (Required)

The existing Phase 2 (answer pinning) and Phase 3 (stale descendant invalidation) machinery must be verified under BUG-011's repro scenario:

1. **Pin integrity with taxonomy-valid options:** After Fix A, all pinned values will be taxonomy slugs. Verify that `mergeConfirmedFollowupAnswers` and `removeConfirmedFollowupAnswers` work correctly with these values.
2. **Descendant invalidation under real hierarchy:** When Sub_Location changes (e.g., tenant corrects from `kitchen` to `bathroom`), verify invalidation clears stale Maintenance_Object and Problem pins.
3. **No regression in contradiction questions:** The hierarchy-conflict question builder uses `resolveValidOptions` with constraint maps. With taxonomy-valid pins, constraint lookups succeed.

**Deliverable:** Add 2-3 test cases to `bug-009-stale-pin-invalidation.test.ts` that use the BUG-011 repro scenario (Location=suite, Sub_Location answered, Object changes).

---

## 6. Acceptance Criteria

1. Every enum follow-up question reaches the tenant with `options.length > 0`, and every option is a valid taxonomy slug for that field.
2. When `resolveValidOptions` returns null (unconstrained field), enum options are filtered against full-taxonomy defaults. LLM paraphrases never survive.
3. When `resolveValidOptions` returns a list and all LLM options are invalid, the constraint-valid taxonomy values replace them.
4. Constraint hints are included in the LLM prompt for all fields with up to 25 valid options.
5. Sub_Location is never auto-accepted via resolved-medium.
6. Pinned follow-up answers are always taxonomy slugs (verified by the enum option source being taxonomy-only).
7. If Fix D is implemented: Priority is eligible once Location + Category are resolved, but the frontier selector still picks hierarchy fields before Priority.
8. Phase 0 repro confirms which root causes are active and that fixes address them.
9. BUG-009 cross-verification tests pass under BUG-011 scenario.
10. All existing tests pass.

---

## 7. Sequencing

| Step | What                                                                            | Files                                    | Depends On |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------- | ---------- |
| 0    | Phase 0: Repro & parity checkpoint                                              | eval framework or manual test            | —          |
| 1    | Enforce taxonomy-only options for all enum questions                            | `followup-generator.ts`                  | Phase 0    |
| 2    | Raise constraint hint threshold from 10 to 25                                   | `followup-prompt.ts`                     | —          |
| 3    | Exclude Sub_Location from resolved-medium auto-accept                           | `confidence.ts`                          | —          |
| 4    | (Conditional) Relax Priority gating to Location + Category                      | `field-ordering.ts`                      | Phase 0    |
| 5    | Unit tests: enum options are always taxonomy-valid                              | `followup-generator.test.ts`             | Step 1     |
| 6    | Unit tests: constraint hint threshold covers Sub_Location                       | new or existing prompt test              | Step 2     |
| 7    | Unit tests: Sub_Location not auto-accepted at resolved-medium                   | confidence test                          | Step 3     |
| 8    | Unit tests: Priority gating (if Step 4 implemented)                             | `field-ordering.test.ts`                 | Step 4     |
| 9    | BUG-009 cross-verification: pin integrity + invalidation under BUG-011 scenario | `bug-009-stale-pin-invalidation.test.ts` | Steps 1-3  |
| 10   | Integration test: leak scenario end-to-end                                      | new test file                            | Steps 1-3  |
| 11   | Run full test suite, fix breakage                                               | —                                        | Steps 1-10 |
| 12   | Update bug tracker and spec gap tracker                                         | docs                                     | Step 11    |

**Parallelizable:** Steps 1-3 are independent. Step 4 is conditional on Phase 0 findings.

---

## Phase 0 — Repro & Parity Checkpoint

**Goal:** Establish which root causes are active in the current codebase against the live LLM.

**Method:**

1. Set up a test session using the dev server or eval replay with input `"I have a leak"`.
2. At each follow-up round, capture:
   - `fieldsNeedingInput` (from classification result)
   - `capsCheck.eligibleFields`
   - `frontierFields` (from `selectFollowUpFrontierFields`)
   - LLM raw response (follow-up generator output before filtering)
   - Post-filter options (after constraint filtering)
   - Pinned answer values
3. Verify:
   - Does Location get paraphrased options? (Root Cause 3)
   - Does Sub_Location miss constraint hints? (Root Cause 1)
   - Does the fallback preserve hallucinated options? (Root Cause 2)
   - Is Sub_Location in `fieldsNeedingInput` after Location is answered? (Root Cause 4)
   - Does the frontier selector return Sub_Location before Object? (Root Cause 4)

**Pass criteria:** At least Root Causes 1-3 are reproduced. Root Cause 4 is confirmed or explained.

**Deliverable:** Annotated test transcript with raw state at each round. Added to `docs/plans/` or committed as a test fixture.

---

## Step 1 — Enforce Taxonomy-Only Enum Options

**File:** `packages/core/src/followup/followup-generator.ts`

Replace the constraint filtering block (lines 228-237):

```typescript
// Before
const constraintFiltered = filteredQuestions.map((q) => {
  const valid = resolveValidOptions(
    q.field_target,
    narrowedInput.classification,
    taxonomyConstraints,
  );
  if (valid === null) return q;
  const opts = q.options.filter((opt) => valid.includes(opt));
  return { ...q, options: opts.length > 0 ? opts : q.options };
});
```

```typescript
// After (actual implementation — includes per-field rebuild of dropped questions)
const droppedFields: string[] = [];
const constraintFiltered = filteredQuestions
  .map((q) => {
    if (q.answer_type !== 'enum') return q;

    const valid = resolveValidOptions(
      q.field_target,
      narrowedInput.classification,
      taxonomyConstraints,
    );

    if (valid !== null) {
      const opts = q.options.filter((opt) => valid.includes(opt));
      if (opts.length > 0) return { ...q, options: opts };
      return { ...q, options: valid.slice(0, 10) };
    }

    const taxonomyDefaults = DEFAULT_FALLBACK_OPTIONS[q.field_target];
    if (taxonomyDefaults) {
      const opts = q.options.filter((opt) => taxonomyDefaults.includes(opt));
      if (opts.length > 0) return { ...q, options: opts };
      return { ...q, options: [...taxonomyDefaults].slice(0, 10) };
    }

    droppedFields.push(q.field_target);
    return null;
  })
  .filter((q): q is NonNullable<typeof q> => q !== null);

// Rebuild deterministic questions for any dropped fields still in the frontier.
const survivingFields = new Set(constraintFiltered.map((q) => q.field_target));
for (const field of droppedFields) {
  if (!survivingFields.has(field)) {
    constraintFiltered.push(buildFallbackQuestion(field, narrowedInput));
    survivingFields.add(field);
  }
}
```

**Invariant:** Every enum question reaching the tenant has `options.length > 0` with taxonomy-valid slugs. No raw LLM options survive. Dropped questions are rebuilt per-field, not only when all questions are dropped.

---

## Step 2 — Raise Constraint Hint Threshold

**File:** `packages/core/src/llm/prompts/followup-prompt.ts`

```typescript
// Before
if (valid && valid.length <= 10) {

// After
if (valid && valid.length <= 25) {
```

---

## Step 3 — Exclude Sub_Location from Resolved-Medium Auto-Accept

**File:** `packages/core/src/classifier/confidence.ts`

```typescript
// Before
if (isResolvedMedium && !isEmergencyPriority) {

// After (actual implementation — includes confirmedFields bypass)
// DetermineFieldsOptions now has: readonly confirmedFields?: ReadonlySet<string>;
const alwaysConfirmFields = new Set(['Sub_Location']);
const requiresConfirmation =
  alwaysConfirmFields.has(field) && !opts.confirmedFields?.has(field);

if (isResolvedMedium && !isEmergencyPriority && !requiresConfirmation) {
```

**Implementation note:** The original plan did not include the `confirmedFields` bypass. Without it, Sub_Location was blocked from resolved-medium on every re-classification round — including after the tenant had already confirmed it via a follow-up pin. This caused cascading test failures: the confidence formula gives Sub_Location a max score of ~0.84 (below the 0.85 high threshold) without constraint implication, so it can never escape the medium band. The `confirmedFields` parameter (passed as `pinnedFieldSet` from `answer-followups.ts`) ensures Fix C only blocks Sub_Location on initial classification, not after the tenant has already confirmed it.

---

## Step 4 — Relax Priority Gating (Conditional on Phase 0)

**File:** `packages/core/src/followup/field-ordering.ts`

Only implement if Phase 0 confirms Priority is unreachable after Fixes A-C.

```typescript
// Before
if (field === 'Priority') {
  return activeHierarchy.every((parentField) =>
    isResolvedOrImpliedField(parentField, classification, impliedFields),
  );
}

// After
if (field === 'Priority') {
  const priorityGateFields = ['Location', 'Category'];
  return priorityGateFields.every((gateField) =>
    isResolvedOrImpliedField(gateField, classification, impliedFields),
  );
}
```

**Constraint:** Priority only becomes _eligible_. The frontier selector still returns the first unresolved hierarchy field before Priority. Priority cannot jump the queue.

---

## Step 5 — Unit Tests: Taxonomy-Only Enum Options

**File:** `packages/core/src/__tests__/followup/followup-generator.test.ts`

```
it('replaces all-hallucinated options with constraint-valid taxonomy values')
  // Mock LLM returns Sub_Location question with options:
  //   ["half bath", "master bathroom", "powder room"]
  // Classification: Location=suite
  // Assert: returned options are from Location_to_Sub_Location['suite']
  // Assert: "half bath" NOT in options

it('filters LLM paraphrases for unconstrained fields against taxonomy defaults')
  // Mock LLM returns Location question with options:
  //   ["In my apartment unit", "Common area", "suite"]
  // Assert: returned options = ["suite"] (only the taxonomy-valid one)
  // Assert: "In my apartment unit" NOT in options

it('replaces all-paraphrased unconstrained options with full taxonomy defaults')
  // Mock LLM returns Location question with options:
  //   ["In my apartment unit", "Common area", "Outside"]
  // Assert: returned options = taxonomy.Location (full defaults)
  // Assert: none of the LLM paraphrases survive

it('does not filter text or yes_no questions')
  // Mock LLM returns text question with arbitrary prompt
  // Assert: options unchanged (no filtering applied)

it('keeps valid LLM options when some pass constraint filter')
  // Mock LLM returns: ["bathroom", "master bathroom"]
  // Assert: returned options = ["bathroom"]

it('enum options are never empty')
  // For every taxonomy field with DEFAULT_FALLBACK_OPTIONS:
  //   Mock LLM returns all-invalid enum options
  //   Assert: options.length > 0
```

---

## Step 6 — Unit Tests: Constraint Hint Threshold

```
it('includes constraint hints for Sub_Location when Location=suite (12 values)')
  // Assert: user message contains "Sub_Location: valid options are [kitchen, bathroom, ..."
```

---

## Step 7 — Unit Tests: Sub_Location Resolved-Medium

```
it('Sub_Location in medium band is NOT auto-accepted via resolved-medium')
  // Sub_Location conf in resolved-medium range, no disagreement/ambiguity
  // Assert: Sub_Location IS in fieldsNeedingInput

it('Maintenance_Category in same conditions CAN be auto-accepted')
  // Assert: Maintenance_Category NOT in fieldsNeedingInput
```

---

## Step 8 — Unit Tests: Priority Gating (Conditional)

Only if Step 4 implemented:

```
it('Priority eligible when Location + Category resolved but Sub_Location is not')
it('Priority NOT eligible when Category is unresolved')
it('Priority still comes after hierarchy fields in frontier selection')
```

---

## Step 9 — BUG-009 Cross-Verification

**File:** `packages/core/src/__tests__/followup/bug-009-stale-pin-invalidation.test.ts`

Add:

```
it('BUG-011 scenario: taxonomy-valid pins work with descendant invalidation')
  // Prior pins: { Location: 'suite', Sub_Location: 'kitchen', Maintenance_Object: 'fridge' }
  // This round: tenant answers Sub_Location = 'bathroom'
  // Assert: Maintenance_Object 'fridge' invalidated (kitchen-only object)
  // Assert: invalidation event logged
  // Assert: all pins are taxonomy slugs after invalidation

it('BUG-011 scenario: hierarchy-conflict question uses taxonomy-valid options')
  // After invalidation clears stale Object pin
  // Assert: contradiction question options are from taxonomy constraint map
  // Assert: no LLM paraphrases in options
```

---

## Step 10 — Integration Test: Leak Scenario

**File:** `packages/core/src/__tests__/followup/bug-011-followup-ordering.test.ts` (new)

```
describe('BUG-011: leak scenario follows correct ordering with taxonomy-valid options')

  it('after Location=suite confirmed, next question targets Sub_Location')
    // Assert: pending_followup_questions[0].field_target === 'Sub_Location'
    // Assert: all options are valid taxonomy Sub_Location slugs for suite

  it('Location question options are taxonomy slugs, not LLM paraphrases')
    // Mock LLM returns paraphrased Location options
    // Assert: options filtered to taxonomy.Location values

  it('full flow: Location → Sub_Location → Object → Problem with valid options at each step')
    // Multi-round test simulating the exact BUG-011 scenario
    // Each round: verify question field, verify options are taxonomy-valid
```

---

## Step 11 — Full Test Suite

```bash
pnpm test
pnpm typecheck
pnpm lint
```

**Expected breakage:**

- `followup-generator.test.ts`: Tests that assert "keep original options" fallback → update to expect taxonomy defaults
- `field-ordering.test.ts`: Priority tests (if Step 4 implemented)
- Confidence tests: If any assert Sub_Location auto-accepted

---

## Step 12 — Update Trackers

### docs/bug-tracker.md

Add BUG-011 row:

- Status: IN PROGRESS
- Severity: High
- Fix: Taxonomy-only enum options, hint threshold, Sub_Location confirmation, (conditional) Priority gating

### docs/spec-gap-tracker.md

Update rows for follow-up taxonomy enforcement, option validation.

---

## Risk Assessment

| Risk                                          | Likelihood | Mitigation                                                                                                                                                                                                                |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enum question dropped for unknown field       | Very Low   | Only hits fields with no `DEFAULT_FALLBACK_OPTIONS` entry AND no constraint map. No current taxonomy field matches. Dropped questions trigger the deterministic fallback rebuild (`buildDeterministicFallbackQuestions`). |
| Location paraphrase filtering too aggressive  | Low        | `DEFAULT_FALLBACK_OPTIONS['Location']` = `taxonomy.Location` = `['suite', 'building_interior', 'building_exterior']`. LLM options that match these pass; others are replaced. Deterministic fallback covers the gap.      |
| Hint threshold 25 makes prompts too long      | Very Low   | 25 × ~15 chars = ~375 chars. Trivial vs 4K+ prompt.                                                                                                                                                                       |
| Sub_Location always-ask adds one question     | Expected   | Desired behavior per bug report.                                                                                                                                                                                          |
| Fix D changes Priority ordering for all flows | Medium     | Conditional on Phase 0. If implemented, Priority still follows hierarchy in frontier selection — it only becomes eligible earlier, doesn't jump ahead.                                                                    |

---

## Scope Boundaries

**In scope:**

- Taxonomy-only enum option enforcement (constrained + unconstrained fields)
- Constraint hint threshold adjustment
- Sub_Location confidence treatment
- Priority gating relaxation (conditional)
- Phase 0 repro & parity checkpoint
- BUG-009 cross-verification
- Unit + integration tests
- Tracker updates

**Out of scope:**

- Second-pass LLM coherence review (separate enhancement, file as new tracker item)
- UI-side option rendering changes (beyond what's fixed by sending valid options)
- Classifier prompt changes (classifier behavior is not the root cause)
- Taxonomy expansion (adding "half bath" as a taxonomy value)
- State machine or transition matrix changes
