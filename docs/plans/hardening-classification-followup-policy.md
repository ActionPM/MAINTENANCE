# Plan: Classification / Follow-Up Policy Hardening Pass

**Created**: 2026-03-25
**Trigger**: Post-infra-fix smoke testing (after 0b6cf6b) revealed 5 policy-correctness issues
**Status**: Executed; provider-backed eval follow-up required
**Goal**: Make the classification/follow-up pipeline trustworthy enough to call the migration operationally complete

---

## March 26 execution note

Provider-backed eval support was added to `packages/evals` via an Anthropic-backed classifier adapter and `run-eval.ts` now supports `--adapter anthropic`.

Live validation result:

- `regression` dataset run completed with `--adapter anthropic`
- artifact: `packages/evals/baselines/regression-run-1774528979119.json`
- comparison: `packages/evals/baselines/regression-comparison-1774528979136.md`
- gate: `FAILED`

Observed outcome:

- Priority-sensitive leak/emergency cases improved materially:
  - `reg-006` faucet drip -> `Priority: normal`
  - `reg-010` slow drip -> `Priority: low`
  - `reg-018` gas smell -> `Priority: emergency`
  - `reg-019` fire -> `Priority: emergency`
- The release gate still failed due broader live-model drift:
  - overall `field_accuracy` fell to `0.8491`
  - `schema_invalid_rate` rose to `0.0370`
  - `contradiction_after_retry_rate` rose to `0.0370`
  - one management/intercom example (`reg-007`) schema-failed after classifying `intercom` as a maintenance object
  - many otherwise-correct classifications still landed in `fieldsNeedingInput` because live confidences stayed in the medium band

Release decision:

- `Ready to merge/deploy`: `NO`
- `Narrow follow-up required`: `YES`

Because the live-model drift is broad enough to invalidate the release gate, deployed smoke tests were intentionally not run in this pass. The next hardening step should target live confidence behavior / schema robustness, not infrastructure or prompt-version wiring.

---

## Batch 1 — Confirmed root causes (no investigation needed)

### Task 1.1: Add RESUME entries to transition matrix for all resumable states

**Root cause**: `RESUMABLE_STATES` lists 7 states, but the transition matrix only has RESUME entries for `intake_started`, `submitted`, `llm_error_retryable`, `llm_error_terminal`, and `intake_abandoned`. The 5 remaining resumable states reject RESUME with INVALID_TRANSITION.

**File**: `packages/core/src/state-machine/transition-matrix.ts`

**Change**: Add `[ActionType.RESUME]: [ConversationState.<SELF>]` to each of these 5 states:

- `unit_selection_required` (line ~68)
- `split_proposed` (line ~92)
- `classification_in_progress` (line ~109)
- `needs_tenant_input` (line ~116)
- `tenant_confirmation_pending` (line ~123)

Each entry is a single-target self-transition (same as `intake_started` and `submitted`).

**Do not change**: The resume handler (`resume.ts`) — it is already correct (no-op returning current state).

**Acceptance**:

- Every state in `RESUMABLE_STATES` has a RESUME entry in the transition matrix
- `isValidTransition(state, ActionType.RESUME)` returns true for all 7 resumable states

---

### Task 1.2: Add transition matrix tests for new RESUME entries

**File**: `packages/core/src/__tests__/state-machine/transition-matrix.test.ts`

**Change**: Add 5 new rows to the `expectedTransitions` array (after line ~99):

```
['unit_selection_required', 'RESUME', ['unit_selection_required']],
['split_proposed', 'RESUME', ['split_proposed']],
['classification_in_progress', 'RESUME', ['classification_in_progress']],
['needs_tenant_input', 'RESUME', ['needs_tenant_input']],
['tenant_confirmation_pending', 'RESUME', ['tenant_confirmation_pending']],
```

**Acceptance**: `pnpm --filter @wo-agent/core exec vitest run src/__tests__/state-machine/transition-matrix.test.ts` passes.

---

### Task 1.3: Add integration tests for resume from each resumable state

**File**: New test file `packages/core/src/__tests__/orchestrator/resume-all-resumable-states.test.ts`

**Test cases** (one per resumable state that was previously missing):

1. Session in `unit_selection_required` + RESUME → returns `unit_selection_required`, no error
2. Session in `split_proposed` + RESUME → returns `split_proposed`, no error
3. Session in `classification_in_progress` + RESUME → returns `classification_in_progress`, no error
4. Session in `needs_tenant_input` + RESUME → returns `needs_tenant_input`, no error
5. Session in `tenant_confirmation_pending` + RESUME → returns `tenant_confirmation_pending`, no error

Each test should go through the dispatcher (not just the handler) to confirm the full path works including transition validation.

**Acceptance**: All 5 tests pass. No INVALID_TRANSITION errors.

---

### Task 1.4: Fix management Location leak in confidence path

**Root cause**: `DEFAULT_FIELD_POLICY.requiredFields` in `confidence.ts:131` includes `'Location'` unconditionally. `determineFieldsNeedingInput()` flags Location as "required + medium confidence = needs input" for management issues. The completeness gate is already correct (`managementFollowupEligible: []`), but the confidence path doesn't respect category.

**File**: `packages/core/src/classifier/confidence.ts`

**Change**: No new parameters. `determineFieldsNeedingInput()` already receives `classificationOutput` — derive category internally from `classificationOutput?.['Category']`. Add management-specific Location/Sub_Location exclusion in the existing post-processing block (after the cross-domain pruning at lines 182-192), using the **same guard condition**: only apply the exclusion when Category itself is NOT in `fieldsNeedingInput`. This prevents suppressing Location follow-up when the category prediction itself is uncertain.

```typescript
// Management issues: Location and Sub_Location are not required (Decision 1).
// Only apply when Category is confidently resolved (same guard as cross-domain pruning).
if (opts.classificationOutput && !fields.includes('Category')) {
  const category = opts.classificationOutput['Category'];
  if (category === 'management') {
    return fields.filter((f) => f !== 'Location' && f !== 'Sub_Location');
  }
}
```

This integrates naturally with the existing category-gating block. No new interface surface, no callsite changes needed.

**Do not change**: `completeness-gate.ts` — already correct. `DEFAULT_FIELD_POLICY.requiredFields` — keep it as the default; the gating is post-hoc. No changes to callers in `start-classification.ts` or `answer-followups.ts` — they already pass `classificationOutput`.

**Acceptance**:

- Management issue with blank Location does not get Location in `fieldsNeedingInput` (when Category is confident)
- Management issue with voluntarily provided Location still accepted (no error, just not required)
- Management issue with uncertain Category still asks about Location (safety guard)
- Maintenance issues still require Location (no regression)

---

### Task 1.5: Add tests for management Location policy in confidence path

**File**: `packages/core/src/__tests__/classifier/confidence-integration.test.ts`

**Add test cases**:

1. Management issue with blank Location and medium confidence, Category confident → Location NOT in `fieldsNeedingInput`
2. Management issue with provided Location and high confidence → Location NOT in `fieldsNeedingInput`
3. Management issue with uncertain Category (Category in `fieldsNeedingInput`) → Location IS still in `fieldsNeedingInput` (safety guard)
4. Maintenance issue with blank Location and medium confidence → Location IS in `fieldsNeedingInput` (regression guard)

**Acceptance**: All 4 tests pass. Existing tests still pass.

---

### Review checkpoint: Batch 1

Run full test suite: `pnpm test && pnpm typecheck && pnpm lint`

All Batch 1 changes are deterministic code fixes with confirmed root causes. No LLM behavior involved. Should be clean.

---

## Batch 2 — Evidence-first investigations

### Task 2.1: Investigate needs_object divergence — inspect event payloads

**Goal**: Determine whether the divergent behavior (one run skipped follow-up, another triggered it) comes from LLM classifier variance or deterministic escape-hatch paths.

**Method**:

1. **Start with existing evidence.** Pull event payloads from the original divergent runs that triggered this plan item (the two "Something in my kitchen is broken" runs with different outcomes). These are stronger evidence than fresh runs because they explain the actual observed failure.
2. Compare the classifier output between the two runs: did `needs_object` appear in both, or did the classifier return a concrete value in one?
3. If classifier output differed → root cause is LLM non-determinism (address in prompt/cues)
4. If classifier output was consistent but follow-up decision differed → check for escape_hatch flags, caps exhaustion, or empty follow-up generation in the divergent run
5. **Then reproduce.** Run the same input 3 more times to test current reproducibility and confirm the root cause hypothesis holds

**Output**: Written determination of root cause with evidence from both original and fresh runs, informing Task 2.2.

---

### Task 2.2: Fix needs_object based on investigation findings

**If LLM variance (Task 2.1 finding A)**:

- Review classifier prompt v2 for `needs_object` guidance (already at `classifier-prompt.ts:112-114`)
- Check if cue dictionary has entries that would stabilize the classification
- Consider adding a cue for "something is broken" → `Maintenance_Object: needs_object`
- File: `packages/schemas/classification_cues.json`, possibly `classifier-prompt.ts`

**If escape-hatch divergence (Task 2.1 finding B)**:

- Trace the exact code path that skipped follow-up
- Check if caps were exhausted or follow-up generator returned empty
- Tighten the path so needs_object is never silently dropped
- Files: `packages/core/src/followup/caps.ts`, `packages/core/src/orchestrator/action-handlers/start-classification.ts`

**Acceptance**: When classification contains `needs_object`, the downstream follow-up decision is deterministic and correct across repeated runs.

---

### Task 2.3: Investigate priority drift — inspect faucet leak classifier output

**Goal**: Determine why "My kitchen faucet is leaking" received Priority: emergency.

**Method**:

1. **Start with existing evidence.** Pull the raw classifier output event payload from the faucet leak smoke run. Confirm whether Priority: emergency came from the LLM classification output directly.
2. Check the classifier prompt (`classifier-prompt.ts`) — neither v1 nor v2 has explicit Priority criteria. The prompt lists valid values but gives no guidance on when to use `emergency` vs `normal`. This is a leading hypothesis but not confirmed until we see the event payload.
3. Check the cue dictionary (`classification_cues.json`) for Priority-related cues — does "leak" have any priority cue signal? The cue dictionary does contain Priority entries, so check whether they biased toward or against emergency.
4. Check whether any deterministic path (risk scanner, answer mapping, default coercion) could have overridden the classifier's Priority output. (Prior analysis says no, but verify against the actual event chain.)
5. If fresh data is needed, re-run the faucet leak case and compare.

**Output**: Written determination with evidence from the original run, confirming root cause before choosing a fix direction. Informs Task 2.4.

---

### Task 2.4: Fix priority drift based on investigation findings

**Leading hypothesis** (prompt gap — confirm via Task 2.3 before implementing):

- Add Priority guidance to **both v1 and v2** classifier prompts in `classifier-prompt.ts`
- For v1: add to the RULES section
- For v2: add to the EVIDENCE-BASED CLASSIFICATION RULES section
- Example addition:
  ```
  PRIORITY GUIDANCE:
  - "emergency": immediate safety risk (fire, gas leak, flooding, no heat in winter, structural danger)
  - "high": significant disruption to habitability (no hot water, broken lock, major leak)
  - "normal": standard maintenance or management request (dripping faucet, appliance issue, document request)
  - "low": cosmetic or non-urgent (paint touch-up, minor wear)
  - Only classify as "emergency" when there is clear evidence of safety risk or uninhabitable conditions.
  ```

**Version-pinning decision (resolved):** Patch both v1 and v2. This is intentionally chosen to avoid legacy drift in pinned v1 sessions. The Priority guidance is factual criteria, not a structural prompt change, and fits naturally into both prompt styles. Resumed conversations pinned to v1 will benefit from the fix on their next classification call. If product requires a different version-pinning strategy, that should be an explicit revision to this plan.

**Tests**: Add test coverage for both prompt versions — verify that `buildClassifierSystemPromptV1()` and `buildClassifierSystemPromptV2()` both include Priority guidance text.

**Also consider**: Adding Priority cues to `classification_cues.json` so the confidence heuristic can flag disagreement when the LLM assigns emergency to a non-emergency case.

**Acceptance**: Priority only escalates to emergency when supported by actual safety-risk evidence in the tenant's text. A faucet leak classifies as normal or high, not emergency.

---

### Task 2.5: Audit over-asking on clear maintenance cases

**Goal**: Determine why "My kitchen faucet is leaking" triggers redundant follow-ups for fields that should be high-confidence.

**Method**:

1. Run the confidence formula manually for "kitchen faucet leaking" with realistic inputs:
   - Check cue scores: does `classification_cues.json` have entries for "faucet" → `Maintenance_Object: faucet`, "kitchen" → `Sub_Location: kitchen`, "leaking" → `Maintenance_Problem: leak`?
   - With `high_threshold: 0.85` and weights `{cue: 0.40, completeness: 0.25, model_hint: 0.20, constraint_implied: 0.25}`, can obvious fields reach 0.85?
   - Without constraint_implied (=0), max is: 0.40×1.0 + 0.25×1.0 + 0.20×0.95 = 0.84 — just under high_threshold
   - WITH constraint_implied (=1, when constraints narrow to one value), max is: 0.84 + 0.25×1.0 = 1.09 → clamped to 1.0 — clearly high

2. So the question is: for "kitchen faucet leaking", do hierarchical constraints imply any fields? Check `constraint-resolver.ts` and `taxonomy-constraints.json`.

3. If cue coverage is the gap (no "faucet" cue, no "kitchen" cue), add cue entries.

4. If the issue is that non-constraint-implied fields structurally can't reach high without perfect cue alignment, consider:
   - Lowering `high_threshold` from 0.85 to 0.80
   - Or adjusting weights to give more credit to strong cue + high model confidence alignment

5. Also explicitly review `DEFAULT_FIELD_POLICY.requiredFields` in `confidence.ts` — the required-field list drives the medium-confidence escalation path. If too many fields are marked required, medium-confidence results trigger follow-up even when they shouldn't.

**Files**: `packages/schemas/classification_cues.json`, `packages/schemas/src/confidence-config.ts`, `packages/core/src/classifier/confidence.ts` (required-field policy), `packages/core/src/classifier/constraint-resolver.ts`

**Acceptance**: "My kitchen faucet is leaking" does not ask follow-up for Category, Location, Sub_Location, Maintenance_Category, or Maintenance_Problem when the classifier and cues agree on the values.

---

### Review checkpoint: Batch 2

Run full test suite. Also manually re-run the 4 smoke test scenarios:

1. "Something in my kitchen is broken" — needs_object follow-up behavior
2. "My kitchen faucet is leaking" — no redundant follow-ups, no emergency priority
3. "Need help with lease renewal paperwork" — no Location follow-up
4. Resume an existing draft from any mid-flow state

---

## Batch 3 — Regression coverage and hygiene

**Important**: Batch 3 test placement depends on the actual fix layer determined in Batch 2. The tests listed below are the minimum required regressions. Each Batch 2 behavior fix must have at least one **orchestrator-level** regression test (going through the dispatcher or full handler path), not just helper-layer tests, to protect the real bug site.

### Task 3.1: Add needs_object regression tests

**Helper-layer tests** (extend `packages/core/src/__tests__/classifier/completeness-gate.test.ts`):

1. Classification with `Maintenance_Object: 'needs_object'` → `incompleteFields` contains `Maintenance_Object`, follow-up type is `OBJECT_CLARIFICATION`
2. Classification with `Management_Object: 'needs_object'` → same behavior (already exists, verify)
3. Classification with NO `needs_object` and all fields populated → complete

These already partially exist (lines 40-55, 123-134). Verify coverage is sufficient; add if gaps found.

**Orchestrator-level test** (placement depends on Task 2.1/2.2 findings):

- If fix was in classifier prompt/cues: add test in `packages/core/src/__tests__/classifier/` using fixture adapter that returns `needs_object`, verifying the full start-classification handler routes to `needs_tenant_input` with follow-up questions
- If fix was in escape-hatch/caps path: add test in `packages/core/src/__tests__/orchestrator/` or `packages/core/src/__tests__/followup/` covering the specific escape path that was tightened
- Either way: one test must prove that a classification containing `needs_object` produces a follow-up question through the handler, not just that the completeness gate flags it

---

### Task 3.2: Add priority regression test

**Helper-layer test** (extend `packages/core/src/__tests__/classifier/confidence-integration.test.ts`):

- Classification with `Priority: 'emergency'` but cue scores indicate non-emergency text ("faucet leaking") → Priority confidence should be penalized by disagreement if Priority cues are added in Task 2.4
- If Priority cues are NOT added (decision deferred), add a simpler test: "Kitchen faucet leaking" with Priority: normal → Priority NOT in `fieldsNeedingInput` when confidence is medium+ and no risk triggers match

**Prompt-level test** (if Task 2.4 adds Priority guidance):

- Verify both `buildClassifierSystemPromptV1()` and `buildClassifierSystemPromptV2()` include Priority guidance text (string assertion, not LLM call)

---

### Task 3.3: Add clear-case over-asking regression test

**Helper-layer test** (extend `packages/core/src/__tests__/classifier/confidence-integration.test.ts`):

- "My kitchen faucet is leaking" with strong cue scores + high model confidence + constraint agreement → Category, Location, Sub_Location, Maintenance_Category, Maintenance_Problem should all be high-confidence and NOT in `fieldsNeedingInput`
- This test may initially fail before Task 2.5 threshold/cue adjustments. That's fine — it documents the desired behavior and becomes the acceptance criterion.

**Orchestrator-level test** (if Task 2.5 fix touches orchestrator post-processing or required-field policy):

- A start-classification handler test using fixture adapter with a "faucet leak" classification that has strong confidence → handler should route to `tenant_confirmation_pending` (not `needs_tenant_input`) without follow-up questions for already-identified fields

---

### Task 3.4: Update spec-gap-tracker

**File**: `docs/spec-gap-tracker.md`

**Changes**:

- Verify S11-xx rows covering RESUME transitions — update status/evidence if any were marked as complete but the matrix was actually incomplete
- Verify S14-xx rows covering confidence/follow-up — update evidence for the management-Location fix
- Verify S15-xx rows covering follow-up generation — update evidence for needs_object determinism fix
- Update `Last updated` date
- Recount dashboard totals if any status changed

---

### Review checkpoint: Batch 3

Final gate: `pnpm test && pnpm typecheck && pnpm lint`

Re-run all 4 deployed smoke scenarios. All should pass.

---

## Dependency graph

```
Batch 1 (parallel within batch):
  Task 1.1 → Task 1.2 → Task 1.3  (resume matrix fix + tests)
  Task 1.4 → Task 1.5             (management Location fix + tests; no callsite changes needed)

Batch 2 (sequential — investigation informs fix):
  Task 2.1 → Task 2.2  (needs_object)
  Task 2.3 → Task 2.4  (priority drift — patch both v1 and v2)
  Task 2.5              (over-asking — can run parallel with 2.1-2.4)

Batch 3 (after Batch 2 — test placement depends on fix layer):
  Task 3.1, 3.2, 3.3    (regression tests — each requires at least one orchestrator-level test)
  Task 3.4               (spec-gap-tracker — after all fixes)
```

## Risk notes

- Batch 1 is low-risk — purely deterministic code changes with clear acceptance criteria
- Batch 2 may require judgment calls on threshold tuning (Task 2.5) and prompt wording (Task 2.4); these should be reviewed before merging
- Changing `high_threshold` or confidence weights (Task 2.5) affects all classification flows — run the full eval suite (`pnpm --filter @wo-agent/evals eval:run`) after any threshold change to check for regressions against gold sets
- Priority prompt guidance (Task 2.4) changes LLM behavior in both v1 and v2 — test against gold sets for both prompt versions before merging
- Version-pinning decision for Task 2.4 is resolved: patch both v1 and v2 to avoid legacy drift in pinned sessions
