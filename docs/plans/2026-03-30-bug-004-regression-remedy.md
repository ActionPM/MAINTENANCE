# Remedy Plan: March 30 Plumbing-Issue Regression (BUG-004)

**Date:** 2026-03-30
**Bug:** BUG-004 regression — "I have a plumbing issue" goes straight to confirmation with five missing fields
**Root cause:** `needs_human_triage=true` short-circuits both the completeness gate and confidence-based field analysis in both classification handlers, producing `fieldsNeedingInput=[]` even when the partial classification has a usable domain

## Sequencing Overview

| Step | Fixes          | What it does                               |
| ---- | -------------- | ------------------------------------------ |
| 1    | Fix 1 + Fix 2  | Unblock gates + make blank fields visible  |
| 2    | Fix 3          | Three-way routing branch                   |
| 3    | Fix 7a + 7b    | Lock P0 logic with regression tests        |
| 4    | Fix 4          | Remove prompt version gate (both handlers) |
| 5    | Fix 5          | Honest confirmation copy                   |
| 6    | Fix 7c + Fix 6 | Eval row + two-tier triage reasons         |
| 7    | Fix 8          | Deployment parity verification             |

---

## Step 1 — Fix 1 + Fix 2: Unblock field-needs analysis

### Task 1.1: Remove `needs_human_triage` guard from completeness gate in `start-classification.ts`

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Line 239**

Change:

```typescript
if (isEvidenceBasedPrompt && !output.needs_human_triage) {
```

To:

```typescript
if (isEvidenceBasedPrompt) {
```

The completeness gate (blank fields, `needs_object`) must run regardless of the triage flag. The `needs_human_triage` flag on `IssueClassifierOutput` is never cleared or mutated — it remains the classifier's original audit signal.

### Task 1.2: Remove `needs_human_triage` ternary from field-needs analysis in `start-classification.ts`

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Lines 282–289**

Change:

```typescript
let fieldsNeedingInput = output.needs_human_triage
  ? []
  : determineFieldsNeedingInput({
      confidenceByField: confidenceDetail,
      config: confidenceConfig,
      missingFields: output.missing_fields,
      classificationOutput: output.classification,
    });
```

To:

```typescript
const fieldsNeedingInput = determineFieldsNeedingInput({
  confidenceByField: confidenceDetail,
  config: confidenceConfig,
  missingFields: output.missing_fields,
  classificationOutput: output.classification,
});
```

Note: the variable changes to `const` here because the reassignment to `[]` is removed, but downstream (lines 291–294 implied-field filter, lines 297–301 completeness merge) still mutate it via `filter` and `push`, so keep it as `let`.

### Task 1.3: Mirror both changes in `answer-followups.ts`

**File:** `packages/core/src/orchestrator/action-handlers/answer-followups.ts`

**Line 301** — same completeness gate guard fix:

```typescript
// Change:
if (isEvidenceBasedPrompt && !output.needs_human_triage) {
// To:
if (isEvidenceBasedPrompt) {
```

**Lines 339–346** — same ternary removal:

```typescript
// Change:
let fieldsNeedingInput = output.needs_human_triage
  ? []
  : determineFieldsNeedingInput({
// To:
let fieldsNeedingInput = determineFieldsNeedingInput({
```

### Task 1.4: Add blank-aware field check in `determineFieldsNeedingInput()`

**File:** `packages/core/src/classifier/confidence.ts`
**Lines 202–206** — insert new block after line 205 (`const needed = new Set<string>();`), before the confidence band loop at line 207.

Insert:

```typescript
// Blank-field safety net: required and risk-relevant fields that are blank,
// undefined, or 'needs_object' in the classification output are always needed,
// regardless of confidence band. These fields may be absent from confidenceByField
// entirely (no cue result, no model confidence entry), making them invisible to
// the band loop below.
if (opts.classificationOutput) {
  const policyFields = new Set([...fieldPolicy.requiredFields, ...fieldPolicy.riskRelevantFields]);
  for (const field of policyFields) {
    const value = opts.classificationOutput[field];
    if (!value || value === '' || value === 'needs_object') {
      needed.add(field);
    }
  }
}
```

This catches the two fields invisible to every other gate:

| Field               | Completeness gate                    | Confidence loop          | **With this fix**                     |
| ------------------- | ------------------------------------ | ------------------------ | ------------------------------------- |
| Priority            | not in `maintenanceFollowupEligible` | absent from map if blank | **caught (required + risk-relevant)** |
| Maintenance_Problem | not in `maintenanceFollowupEligible` | absent from map if blank | **caught (risk-relevant)**            |

### Task 1.5: Run tests

```bash
pnpm --filter @wo-agent/core test
pnpm typecheck
```

Existing tests should still pass. Any that asserted `fieldsNeedingInput=[]` when `needs_human_triage=true` will need updating — those tests encoded the bug.

---

## Step 2 — Fix 3: Three-way routing branch

### Task 2.1: Add `recoverable_via_followup` to `IssueClassificationResult`

**File:** `packages/core/src/session/types.ts`
**Lines 16–24**

Add the new field:

```typescript
export interface IssueClassificationResult {
  readonly issue_id: string;
  readonly classifierOutput: IssueClassifierOutput;
  readonly computedConfidence: Record<string, number>;
  readonly fieldsNeedingInput: readonly string[];
  readonly shouldAskFollowup: boolean;
  readonly followupTypes: Record<string, string>;
  readonly constraintPassed: boolean;
  readonly recoverable_via_followup: boolean; // new — handler routing decision
}
```

This field lives on the handler/session-side result object, NOT on `IssueClassifierOutput` (which is schema-locked LLM I/O). The classifier doesn't know about routing.

### Task 2.2: Add recoverability helper function

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts` (or a shared utility if both handlers need it)

Create a helper:

```typescript
/**
 * Determine whether a triaged classification is recoverable via follow-ups.
 * Both conditions must hold:
 * 1. Valid Category AND valid domain category (Maintenance_Category or
 *    Management_Category) that is NOT a placeholder (not blank, not
 *    'not_applicable', not 'needs_object'). This establishes the domain
 *    anchor — the system knows which set of follow-up qualifiers to ask.
 * 2. No unresolved cross-domain contradiction remains after normalization.
 *    All fields belonging to the opposite domain must be 'not_applicable'
 *    or absent. A lingering contradiction means the domain anchor is
 *    unreliable and follow-ups would target the wrong field set.
 */
function isRecoverableViaFollowup(
  classification: Record<string, string>,
  needsHumanTriage: boolean,
  fieldsNeedingInput: readonly string[],
): boolean {
  if (!needsHumanTriage) return false; // only applies to triaged cases
  if (fieldsNeedingInput.length === 0) return false; // nothing to recover

  const category = classification['Category'];
  if (!category || category === 'not_applicable') return false;

  // Check domain category is real, not placeholder
  if (category === 'maintenance') {
    const mc = classification['Maintenance_Category'];
    if (!mc || mc === 'not_applicable' || mc === 'needs_object') return false;

    // Check no unresolved cross-domain contradiction
    const mgmtCat = classification['Management_Category'];
    const mgmtObj = classification['Management_Object'];
    if (mgmtCat && mgmtCat !== 'not_applicable') return false;
    if (mgmtObj && mgmtObj !== 'not_applicable') return false;
  } else if (category === 'management') {
    const mc = classification['Management_Category'];
    if (!mc || mc === 'not_applicable' || mc === 'needs_object') return false;

    const maintCat = classification['Maintenance_Category'];
    const maintObj = classification['Maintenance_Object'];
    const maintProb = classification['Maintenance_Problem'];
    if (maintCat && maintCat !== 'not_applicable') return false;
    if (maintObj && maintObj !== 'not_applicable') return false;
    if (maintProb && maintProb !== 'not_applicable') return false;
  } else {
    return false; // unknown category
  }

  return true;
}
```

### Task 2.3: Wire recoverability into classification result construction

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Lines 307–315** — update the `classificationResults.push()` call:

```typescript
const recoverable = isRecoverableViaFollowup(
  output.classification,
  output.needs_human_triage,
  fieldsNeedingInput,
);

classificationResults.push({
  issue_id: issue.issue_id,
  classifierOutput: output,
  computedConfidence,
  fieldsNeedingInput,
  shouldAskFollowup: fieldsNeedingInput.length > 0,
  followupTypes: completenessFollowupTypes,
  constraintPassed: !output.needs_human_triage,
  recoverable_via_followup: recoverable,
});
```

Also add a per-issue tracking flag:

```typescript
if (recoverable) anyRecoverableTriageIssue = true;
if (output.needs_human_triage && !recoverable) anyUnrecoverableTriageIssue = true;
```

### Task 2.4: Replace two-way branch with explicit three-way branch

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Lines 338–571** — restructure the main branching logic.

Current structure:

```
if (anyFieldsNeedInput) → follow-ups
else → confirmation
```

New structure:

```
if (anyUnrecoverableTriageIssue) {
  // Path A: Unrecoverable triage — direct to confirmation with human-review copy.
  // Even though fieldsNeedingInput may be non-empty (Fix 1 + Fix 2 ensure blank
  // fields are always visible), we do NOT route to follow-ups because the
  // classification lacks a usable domain anchor. Asking follow-ups about
  // maintenance qualifiers makes no sense if the system doesn't even know
  // whether this is maintenance or management.
  → tenant_confirmation_pending with human-review copy
}
else if (anyFieldsNeedInput) {
  // Path B: Fields need input (covers both normal AND recoverable-triage cases).
  // Recoverable triage issues have a valid domain anchor, so follow-ups
  // target the right domain qualifiers. The triage flag stays on the output
  // as audit state.
  → existing follow-up generation logic (needs_tenant_input)
}
else {
  // Path C: All fields resolved, no triage
  → existing confirmation logic (tenant_confirmation_pending)
}
```

**Why Path A branches on `anyUnrecoverableTriageIssue` alone, not `&& !anyFieldsNeedInput`:** After Fix 1 + Fix 2, unrecoverable triage cases _will_ have non-empty `fieldsNeedingInput` (blank fields are now visible). If Path A required `!anyFieldsNeedInput`, those cases would fall through to Path B and get follow-ups despite having no usable domain anchor. The branch must be: unrecoverable triage → always Path A, regardless of field-needs state.

**Product decision for multi-issue conversations:** If ANY issue is unrecoverable, the entire conversation goes to Path A (confirmation with human-review copy). Rationale: the confirmation UI is conversation-level, not per-issue. Presenting follow-ups for issue #2 while issue #1 is flagged for human review creates a confusing mixed state — the tenant would be answering questions for one issue while being told another needs manual attention. The simpler, more honest product behavior is: if the system can't fully handle any part of the request, send the whole batch for review. Recoverable issues in the set will still carry their partial classification, which gives the human reviewer a head start.

For Path A, use dedicated human-review messaging:

```typescript
uiMessages: [{
  role: 'agent',
  content: "I wasn't able to fully classify your issue(s). A team member will review your submission.",
}],
```

For Path B (existing follow-up logic), no change to the follow-up generation path itself — it already works correctly once `fieldsNeedingInput` is populated.

For Path C, keep existing "I've classified your issue(s)." message.

### Task 2.5: Mirror three-way branch in `answer-followups.ts`

Apply the same structural change to the answer-followups handler's branching logic. The recoverability helper should be shared — extract to a utility file if needed (e.g., `packages/core/src/orchestrator/action-handlers/triage-recovery.ts`).

### Task 2.6: Update all call sites that construct `IssueClassificationResult`

Search for all `classificationResults.push({` and ensure each provides `recoverable_via_followup`. Existing non-triage paths should set it to `false`. Escape-hatch paths that force `needs_human_triage: true` (caps exhausted, follow-up generation failed) should also set `recoverable_via_followup: false`.

Known locations:

- `start-classification.ts` line 307 (main classification loop)
- `start-classification.ts` line 353 (caps escape hatch)
- `answer-followups.ts` line 368 (reclassification loop)
- `answer-followups.ts` line 395 (caps escape hatch)
- `answer-followups.ts` line 458 (follow-up generation failure)

### Task 2.7: Run tests

```bash
pnpm --filter @wo-agent/core test
pnpm typecheck
```

---

## Step 3 — Fix 7a + 7b: Regression tests

### Task 3.1: Test A — Recoverable triage regression test

**File:** `packages/core/src/__tests__/followup/bug-004-regression-mar30.test.ts` (new file)

Test case:

- Set up a session with a single issue: "I have a plumbing issue"
- Stub the classifier to return `needs_human_triage=true` with:
  - `Category: 'maintenance'`
  - `Maintenance_Category: 'plumbing'`
  - `Management_Category: 'not_applicable'`
  - `Management_Object: 'not_applicable'`
  - `Location: ''` (blank)
  - `Sub_Location: ''` (blank)
  - `Maintenance_Object: 'needs_object'`
  - `Maintenance_Problem: ''` (blank)
  - `Priority: ''` (blank)
- Call `START_CLASSIFICATION` via the dispatcher
- Assert:
  - `result.newState === ConversationState.NEEDS_TENANT_INPUT`
  - `classificationResults[0].fieldsNeedingInput` includes `Location`, `Sub_Location`, `Maintenance_Object`, `Maintenance_Problem`, `Priority`
  - `classificationResults[0].classifierOutput.needs_human_triage === true` (audit signal preserved)
  - `classificationResults[0].recoverable_via_followup === true`
  - Follow-up questions were generated (not empty)

### Task 3.2: Test B — Unrecoverable triage test

**File:** Same test file

Test case:

- Stub the classifier to return `needs_human_triage=true` with:
  - `Category: ''` (blank — no valid category)
  - All fields blank or contradictory
- Call `START_CLASSIFICATION`
- Assert:
  - `result.newState === ConversationState.TENANT_CONFIRMATION_PENDING`
  - `classificationResults[0].recoverable_via_followup === false`
  - Agent message uses human-review copy (not "I've classified your issue(s)")

### Task 3.3: Run tests

```bash
pnpm --filter @wo-agent/core exec vitest run src/__tests__/followup/bug-004-regression-mar30.test.ts
pnpm --filter @wo-agent/core test
```

---

## Step 4 — Fix 4: Make completeness gate unconditional

### Task 4.1: Remove version guard in `start-classification.ts`

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Lines 233–239**

Change:

```typescript
// Step C: Completeness gate (v2+ only) — check for blank meaningful fields
const isEvidenceBasedPrompt =
  compareSemver(session.pinned_versions.prompt_version, EVIDENCE_BASED_PROMPT_VERSION) >= 0;
let completenessIncomplete: string[] = [];
let completenessFollowupTypes: Record<string, string> = {};

if (isEvidenceBasedPrompt) {
```

To:

```typescript
// Step C: Completeness gate — check for blank meaningful fields
let completenessIncomplete: string[] = [];
let completenessFollowupTypes: Record<string, string> = {};

{
```

Remove the `isEvidenceBasedPrompt` variable if no longer used elsewhere in the function. Keep the cross-domain auto-normalization block inside — it is harmless on all prompt versions.

### Task 4.2: Mirror in `answer-followups.ts`

**File:** `packages/core/src/orchestrator/action-handlers/answer-followups.ts`
**Lines 295–301**

Same change: remove the `isEvidenceBasedPrompt` guard, make the completeness gate unconditional.

### Task 4.3: Clean up unused imports

If `EVIDENCE_BASED_PROMPT_VERSION` and `compareSemver` are no longer used in either handler after this change, remove their imports. Check both files.

### Task 4.4: Run tests

```bash
pnpm --filter @wo-agent/core test
pnpm typecheck
```

---

## Step 5 — Fix 5: Honest confirmation copy

### Task 5.1: Update confirmation-panel.tsx for panel-level copy rule

**File:** `apps/web/src/components/confirmation-panel.tsx`

**Panel-level copy rule:** If ANY issue in the payload has `needs_human_triage=true` AND does NOT have `recoverable_via_followup=true` (i.e., it's unrecoverable), switch the panel heading and button to review language.

This requires the `ConfirmationIssue` interface to include `recoverable_via_followup`:

```typescript
interface ConfirmationIssue {
  // ... existing fields ...
  recoverable_via_followup?: boolean; // new
}
```

Add a derived flag at the top of the component:

```typescript
const hasUnrecoverableTriage = payload.issues.some(
  (issue) => issue.needs_human_triage && !issue.recoverable_via_followup,
);
```

Three copy changes:

- **Heading (line 37):** `hasUnrecoverableTriage ? 'Partial classification — a team member will review:' : 'Please review before submitting:'`
- **Button (line 69):** `hasUnrecoverableTriage ? 'Submit for review' : 'Submit work order(s)'`
- **Badge (line 60):** Keep existing "Review needed" per-issue badge as-is

### Task 5.2: Update agent message in start-classification.ts

**File:** `packages/core/src/orchestrator/action-handlers/start-classification.ts`

The unrecoverable-triage path (Path A from Fix 3) already has its own message. The normal confirmation path (Path C) keeps "I've classified your issue(s). Please review and confirm."

No additional changes needed here if Fix 3 was implemented correctly.

### Task 5.3: Wire `recoverable_via_followup` through to confirmation payload

**File:** `packages/core/src/confirmation/payload-builder.ts`

The `buildConfirmationPayload` function needs to pass `recoverable_via_followup` from `IssueClassificationResult` to the `ConfirmationIssue` output:

```typescript
return {
  // ... existing fields ...
  recoverable_via_followup: result.recoverable_via_followup,
};
```

Update the `ConfirmationIssue` interface in `payload-builder.ts` to include the field.

### Task 5.4: Run tests

```bash
pnpm --filter @wo-agent/core test
pnpm --filter @wo-agent/web test
pnpm typecheck
```

---

## Step 6 — Fix 7c + Fix 6: Eval row + triage reasons

### Task 6.1: Add eval row to examples.jsonl

**File:** `packages/evals/datasets/regression/examples.jsonl`

Add a new line (next available `reg-XXX` ID) with:

```json
{
  "example_id": "reg-026",
  "dataset_type": "regression",
  "conversation_text": "I have a plumbing issue",
  "split_issues_expected": [{ "issue_text": "plumbing issue" }],
  "expected_classification_by_issue": [
    {
      "Category": "maintenance",
      "Maintenance_Category": "plumbing"
    }
  ],
  "expected_missing_fields": [
    "Location",
    "Sub_Location",
    "Maintenance_Object",
    "Maintenance_Problem",
    "Priority"
  ],
  "expected_followup_fields": [
    "Location",
    "Sub_Location",
    "Maintenance_Object",
    "Maintenance_Problem",
    "Priority"
  ],
  "expected_needs_human_triage": true,
  "expected_risk_flags": [],
  "slice_tags": ["regression", "BUG-004", "triage_recovery", "maintenance_plumbing"],
  "taxonomy_version": "2.0.0",
  "schema_version": "1.0.0",
  "review_status": "approved_for_gate",
  "reviewed_by": "plan-review",
  "created_at": "2026-03-30T00:00:00Z"
}
```

This row does NOT assert conversation state — state assertions live in Tests A/B. It asserts classification, missing fields, follow-up fields, and triage expectation.

### Task 6.2: Add typed `triage_reason` to `ClassifierResult` wrapper

**File:** `packages/core/src/classifier/issue-classifier.ts`
**Lines 22–28**

Add the enum and the field to the wrapper type that the classifier already owns:

```typescript
export const ClassifierTriageReason = {
  CATEGORY_GATING_RETRY_FAILED: 'category_gating_retry_failed',
  SCHEMA_VALIDATION_RETRY_FAILED: 'schema_validation_retry_failed',
  CONSTRAINT_RETRY_FAILED: 'constraint_retry_failed',
} as const;
export type ClassifierTriageReason =
  (typeof ClassifierTriageReason)[keyof typeof ClassifierTriageReason];

export interface ClassifierResult {
  readonly status: 'ok' | 'llm_fail' | 'needs_human_triage';
  readonly output?: IssueClassifierOutput;
  readonly conflicting?: readonly IssueClassifierOutput[];
  readonly error?: string;
  readonly triage_reason?: ClassifierTriageReason; // new — typed, set at decision point
}
```

Set the reason at each return site inside `callIssueClassifier()`:

- **Line 154** (LLM call failed on gating retry): `triage_reason: ClassifierTriageReason.CATEGORY_GATING_RETRY_FAILED`
- **Line 172** (retry failed schema validation): `triage_reason: ClassifierTriageReason.SCHEMA_VALIDATION_RETRY_FAILED`
- **Line 186** (still contradictory after retry): `triage_reason: ClassifierTriageReason.CATEGORY_GATING_RETRY_FAILED`

Handler-level triage decisions (hierarchy violation at `start-classification.ts` line 204) use `CONSTRAINT_RETRY_FAILED` — this is set directly on `IssueClassificationResult` by the handler, not by the classifier. Including it in the same enum avoids a second enum for what is semantically the same question: "why did the classifier pipeline escalate to triage?"

This is the correct home for classifier-level reasons — the classifier sets them at the point of decision, typed, no string parsing in handlers.

### Task 6.3: Add handler-level `routing_reason` and copy `classifier_triage_reason` onto `IssueClassificationResult`

**File:** `packages/core/src/session/types.ts`

Add both fields:

```typescript
export const RoutingReason = {
  CAPS_EXHAUSTED: 'caps_exhausted',
  FOLLOWUP_GENERATION_FAILED: 'followup_generation_failed',
  UNRECOVERABLE_CLASSIFICATION: 'unrecoverable_classification',
  RECOVERED_VIA_FOLLOWUP: 'recovered_via_followup',
} as const;
export type RoutingReason = (typeof RoutingReason)[keyof typeof RoutingReason];

export interface IssueClassificationResult {
  // ... existing fields ...
  readonly recoverable_via_followup: boolean;
  readonly classifier_triage_reason?: ClassifierTriageReason; // copied from ClassifierResult
  readonly routing_reason?: RoutingReason; // set by handler
}
```

**IMPORTANT:** `IssueClassifierOutput` is schema-locked LLM I/O and is NOT modified. `ClassifierResult` (the wrapper in `issue-classifier.ts`) owns the classifier-level reason. The handler copies it onto `IssueClassificationResult` and adds its own `routing_reason`.

**Files:** `start-classification.ts`, `answer-followups.ts`

In the handlers, when constructing `IssueClassificationResult`:

- Copy `classifierResult.triage_reason` → `classifier_triage_reason` (for classifier-originated triage)
- Handler-level escalation sites (hierarchy violation at `start-classification.ts` line 204) set `classifier_triage_reason: ClassifierTriageReason.CONSTRAINT_RETRY_FAILED` directly on `IssueClassificationResult`

### Task 6.4: Set `routing_reason` in handlers

**Files:** `start-classification.ts`, `answer-followups.ts`

Set at the point where the handler makes its routing decision:

- Path A (unrecoverable triage → confirmation): `routing_reason: 'unrecoverable_classification'`
- Path B (recoverable triage → follow-ups): `routing_reason: 'recovered_via_followup'`
- Caps escape hatch: `routing_reason: 'caps_exhausted'`
- Follow-up generation failure: `routing_reason: 'followup_generation_failed'`
- Normal paths: `routing_reason` remains `undefined`

### Task 6.5: Include reasons in event payloads

Update the `eventPayload` construction in both handlers to include `classifier_triage_reason` and `routing_reason` in the classification results array.

### Task 6.6: Run tests

```bash
pnpm --filter @wo-agent/core test
pnpm typecheck
```

---

## Step 7 — Fix 8: Deployment parity verification

### Task 7.1: Check deployed commit pair

After all fixes are merged to `main`, verify Vercel is actually serving the fix:

```bash
# List recent Vercel deployments with commit SHAs and status
vercel ls --app wo-agent-web

# Or inspect the current production deployment directly
vercel inspect --app wo-agent-web
```

Compare the deployed commit SHA against the merge commit on `main`. If the Vercel CLI is not available, check the Vercel dashboard at https://vercel.com (project → Deployments tab) for the production deployment's commit SHA and build status.

The March 30 screenshot shows the old tag-based confirmation layout (`<span>` labels), but the current `confirmation-panel.tsx` already renders `display_fields` rows. If the deployed build predates the fix commit, the bug will persist regardless of what's on `main`.

### Task 7.2: Live verification

After deployment is confirmed current:

1. Open the deployed app
2. Say "I have a plumbing issue"
3. Confirm the split
4. Verify: follow-up questions are asked (not straight to confirmation)
5. Verify: questions target Location, Sub_Location, Maintenance_Object, Maintenance_Problem, Priority

### Task 7.3: Close BUG-004

Update `docs/bug-tracker.md` with the fix commit, verification date, and status change.

---

## Assumptions

- No taxonomy changes needed
- No confidence weight retuning in this pass
- `needs_human_triage` on `IssueClassifierOutput` is never mutated by handler logic
- `recoverable_via_followup` lives on `IssueClassificationResult`, not classifier output
- `classifier_triage_reason` lives on `IssueClassificationResult`, not `IssueClassifierOutput` (schema-locked LLM I/O)
- The intended product behavior: once the system knows maintenance/plumbing, ask targeted maintenance follow-ups rather than showing broken confirmation or handing off to human review prematurely
