# Implementation Plan: Bug-009 Phase 2 — Follow-Up Answer Pinning

> **Status:** Implemented in repo on 2026-03-30; see regression tests and verification notes from this execution pass.

> Phase 3 (stale descendant invalidation) addresses the case where pinned
> answers become invalid after a parent re-confirmation. Tracked in
> `2026-03-30-bug-009-phase3-stale-descendant-invalidation.md`.

**Date:** 2026-03-30
**Bug:** BUG-009 — Follow-up answers are not pinned across rounds; classifier can overwrite tenant-confirmed values
**Prereq:** Phase 1 (dependency-ordered question generation) is already implemented in `field-ordering.ts` and wired into `followup-generator.ts`.

## Problem

The `ANSWER_FOLLOWUPS` handler re-classifies each issue from scratch every round. Tenant answers are passed to the classifier as context (`followup_answers`), but the classifier can ignore them or produce different values. There is no mechanism to:

1. **Persist** which fields the tenant has already answered across rounds
2. **Pin** those values so the classifier cannot overwrite them
3. **Exclude** pinned fields from `fieldsNeedingInput` so they are not re-asked
4. **Reflect** pinned values consistently in confidence scores and confirmation payload

The existing this-round short-circuit (`answer-followups.ts:395-399`) only protects fields answered in the _current_ round. Fields answered in prior rounds have no protection.

## Design

**Minimal guard rail on the existing architecture — no new state machine, no stage planner.**

Add a per-issue `confirmed_followup_answers` map to the session. Each round, merge newly answered enum fields into this map. Inside the classification loop, overlay pinned values onto the classifier output, then rerun normalization, implication, and hierarchy validation on the merged result.

Because the overlay happens _before_ results are stored on the session, the confirmation payload builder (`payload-builder.ts`) reads the pinned values from `classifierOutput.classification` without needing any changes.

### Overlay Timing (within the per-issue classification loop)

The overlay must happen early enough for pinned parent values (e.g., `Maintenance_Object=toilet`) to drive downstream constraint implication (e.g., `Sub_Location=bathroom`). It must also be followed by a consistency pass so that cross-domain contradictions (e.g., a stale pinned management value after the classifier resolves `Category=maintenance`) are caught and routed to triage.

The revised pipeline restructures the existing Steps A → B → C into A → A2 → B' → C' → C2:

```
existing  │ 1. Classifier call
existing  │ 2. Step A: Hierarchy validation + retry on RAW classifier output
──────────┼──────────────────────────────────────────────────────────────
NEW       │ 3. Step A2: Merge pinned answers into classification
NEW       │            Remove pinned fields from missing_fields
──────────┼──────────────────────────────────────────────────────────────
MOVED     │ 4. Step B': Cross-domain normalization (was Step C in current code)
MOVED     │ 5. Step C': Implied-field resolution (was Step B in current code)
NEW       │ 6. Step C2: Post-overlay hierarchy validation
NEW       │            Violations → needs_human_triage (no retry — pins are authoritative)
──────────┼──────────────────────────────────────────────────────────────
existing  │ 7. Completeness gate
existing  │ 8. Confidence computation
──────────┼──────────────────────────────────────────────────────────────
NEW       │ 9. Override confidence to 1.0 for pinned fields
──────────┼──────────────────────────────────────────────────────────────
existing  │ 10. Determine fieldsNeedingInput
──────────┼──────────────────────────────────────────────────────────────
NEW       │ 11. Remove pinned fields from fieldsNeedingInput
──────────┼──────────────────────────────────────────────────────────────
existing  │ 12. This-round short-circuit (partially redundant, kept for defense-in-depth)
existing  │ 13. Implied-fields short-circuit
existing  │ 14. Merge completeness gate results
```

**Why this order:**

- **Step A stays on raw output:** The hierarchy check + constrained retry uses the LLM to fix violations. This must run against what the classifier actually produced, before we inject tenant overrides.
- **Step A2 (overlay) before normalization/implication:** Pinned parent values (e.g., `Maintenance_Object=toilet`) must be present when implication runs so they can drive downstream resolution (e.g., `Sub_Location=bathroom`). If overlay happened after implication, the pinned parent would not participate.
- **Step B' (normalization) before implication:** Normalization fills blank cross-domain fields with `not_applicable`. This prevents implication from trying to resolve cross-domain fields. Order between normalization and implication is safe because normalization only fills blanks and implication only resolves empty/vague values — neither overwrites the other's output.
- **Step C' (implication) after overlay:** The merged classification now includes pinned values, so `resolveConstraintImpliedFields` can use pinned parents to narrow downstream fields.
- **Step C2 (post-overlay hierarchy check):** Catches contradictions introduced by the overlay — e.g., a stale pinned `Management_Category=rent_issues` when `Category=maintenance`. No retry is attempted because pinned values are authoritative; the contradiction routes to `needs_human_triage` for human review.

### What Gets Pinned

Only **enum** answers from follow-up questions are pinned. These map directly to taxonomy field values. Boolean (`yes_no`) and free-text (`text`) answers provide context to the classifier but do not directly set a taxonomy field value.

### EDIT_ISSUE as Future Unpin Path

The `confirmed_followup_answers` map is a plain `Record` that a future `EDIT_ISSUE` handler can update or clear entries from. Not in this PR.

---

## Acceptance Criteria

1. A tenant-answered enum field is persisted in `confirmed_followup_answers` across rounds.
2. Reclassification cannot overwrite a tenant-confirmed field value.
3. A previously answered field does not reappear in follow-up questions.
4. Pinned fields show confidence 1.0 in classification results.
5. Confirmation reflects the effective pinned values.
6. Pinned parent values drive downstream implied-field resolution.
7. A stale pinned cross-domain value that contradicts the resolved category routes to `needs_human_triage`.
8. **The `classification_results` stored on the session after each round are post-overlay, post-normalization, post-implication, and post-validation values.** No downstream consumer (payload builder, confirmation panel, work-order creator) should need to re-derive pinned values — they are already baked into `classifierOutput.classification` and `computedConfidence` at storage time.
9. Existing dependency-ordering behavior remains intact.
10. All existing tests pass.

---

## Sequencing Overview

| Step | What                                                               | Files                                                     |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 1    | Add `confirmed_followup_answers` to session types                  | `session/types.ts`                                        |
| 2    | Initialize in `createSession()`, add merge helper                  | `session/session.ts`                                      |
| 3    | Export new helper from barrel                                      | `session/index.ts`                                        |
| 4    | Add `classification_pinned_answer_contradiction` to event contract | `classifier/classification-event.ts`                      |
| 5    | Restructure + wire pinning into `handleAnswerFollowups`            | `action-handlers/answer-followups.ts`                     |
| 6    | Add regression tests                                               | `__tests__/followup/bug-009-answer-pinning.test.ts` (new) |
| 7    | Run full test suite, fix breakage                                  | —                                                         |
| 8    | Update plan doc and trackers                                       | `docs/plans/`, `docs/bug-tracker.md`                      |

---

## Step 1 — Add `confirmed_followup_answers` to `ConversationSession`

**File:** `packages/core/src/session/types.ts`

Add a new field after `queued_messages` (line 75):

```typescript
/** Per-issue map of tenant-confirmed follow-up answers, accumulated across rounds.
 *  Keys are issue_id; values are field → tenant-answered value.
 *  Only enum answers are stored (yes_no and text answers inform the classifier
 *  but do not directly set taxonomy field values). */
readonly confirmed_followup_answers: Readonly<Record<string, Readonly<Record<string, string>>>>;
```

**Why after `queued_messages`:** Keeps follow-up–related fields grouped. The field is non-nullable with an empty-object default so that existing code can spread it safely without null checks.

**Backward compatibility for persisted sessions:** Sessions loaded from Postgres that predate this field will have `undefined`. All access sites use `session.confirmed_followup_answers ?? {}` or the merge helper handles the fallback.

---

## Step 2 — Initialize and add merge helper

**File:** `packages/core/src/session/session.ts`

### Task 2.1: Initialize in `createSession()` (line 54, before closing brace)

Add after `queued_messages: [],` (line 54):

```typescript
confirmed_followup_answers: {},
```

### Task 2.2: Add `mergeConfirmedFollowupAnswers()` helper

Add after `setEscalationState` (after line 291):

```typescript
/**
 * Merge newly confirmed follow-up answers for a specific issue into the
 * session's cumulative confirmed-answers map.
 *
 * Only string values are stored (enum answers). The caller is responsible
 * for filtering out non-enum answers before calling this.
 */
export function mergeConfirmedFollowupAnswers(
  session: ConversationSession,
  issueId: string,
  newAnswers: Readonly<Record<string, string>>,
): ConversationSession {
  const existing = session.confirmed_followup_answers ?? {};
  return {
    ...session,
    confirmed_followup_answers: {
      ...existing,
      [issueId]: { ...(existing[issueId] ?? {}), ...newAnswers },
    },
  };
}
```

**Design notes:**

- Follows the immutable-return pattern used by every other session helper
- Does not touch `last_activity_at` — the caller (handler) manages timestamps via other session mutations in the same flow
- Accepts pre-filtered answers; the handler decides what qualifies as pinnable

---

## Step 3 — Export from barrel

**File:** `packages/core/src/session/index.ts`

Add `mergeConfirmedFollowupAnswers` to the named export block from `./session.js` (after `setBuildingId`, line 25):

```typescript
mergeConfirmedFollowupAnswers,
```

---

## Step 4 — Add `classification_pinned_answer_contradiction` to the event contract

The post-overlay hierarchy check (Step C2 in the handler) emits a new event type. The `ClassificationEvent` union in `classification-event.ts` currently only allows two event types. The new type must be added to the union.

**File:** `packages/core/src/classifier/classification-event.ts`

Replace the `event_type` union (lines 8–10):

```typescript
  readonly event_type:
    | 'classification_hierarchy_violation_unresolved'
    | 'classification_constraint_resolution';
```

With:

```typescript
  readonly event_type:
    | 'classification_hierarchy_violation_unresolved'
    | 'classification_constraint_resolution'
    | 'classification_pinned_answer_contradiction';
```

**File:** `packages/db/src/__tests__/pg-event-store.test.ts`

Add a test case in the ClassificationEvent describe block (after the existing hierarchy violation test, ~line 284):

```typescript
it('insert() routes ClassificationEvent (pinned answer contradiction) with issue_id in payload', async () => {
  const e = {
    event_id: 'evt-pin-1',
    conversation_id: 'conv-1',
    event_type: 'classification_pinned_answer_contradiction' as const,
    issue_id: 'issue-1',
    payload: {
      violations: ['Management_Category is not valid for maintenance'],
      pinned_fields: { Management_Category: 'rent_issues' },
    },
    created_at: new Date().toISOString(),
  };
  await store.insert(e);
  const events = await store.queryByConversation('conv-1');
  expect(events).toHaveLength(1);
  expect(events[0].event_type).toBe('classification_pinned_answer_contradiction');
  expect(events[0].issue_id).toBe('issue-1');
});
```

---

## Step 5 — Restructure and wire pinning into `handleAnswerFollowups`

**File:** `packages/core/src/orchestrator/action-handlers/answer-followups.ts`

This step has both additive insertions and one structural reorder of existing code within the per-issue classification loop.

### Task 5.1: Add imports

Add `mergeConfirmedFollowupAnswers` to the import from `../../session/session.js` (line 36):

```typescript
import {
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
  setConfirmationTracking,
  mergeConfirmedFollowupAnswers,
} from '../../session/session.js';
```

Add `FieldConfidenceDetail` to the import from `../../classifier/confidence.js`:

```typescript
import {
  computeAllFieldConfidences,
  extractFlatConfidence,
  determineFieldsNeedingInput,
  type FieldConfidenceDetail,
} from '../../classifier/confidence.js';
```

### Task 5.2: Accumulate confirmed answers (after line 201, before line 203)

After the `followupAnswers` conversion and before the `intermediateStep` definition, merge this round's enum answers into the session's confirmed map:

```typescript
// Pin enum answers from this round onto the session (Bug-009 Phase 2).
// Only enum answers map directly to taxonomy field values; yes_no and text
// provide classifier context but do not pin a field.
const newPinnedAnswers: Record<string, string> = {};
for (const ans of tenantInput.answers) {
  const question = pendingQuestions.find((q) => q.question_id === ans.question_id);
  if (
    question &&
    question.answer_type === 'enum' &&
    typeof ans.answer === 'string' &&
    ans.answer.trim() !== ''
  ) {
    newPinnedAnswers[question.field_target] = ans.answer;
  }
}
if (Object.keys(newPinnedAnswers).length > 0) {
  updatedSession = mergeConfirmedFollowupAnswers(updatedSession, targetIssueId, newPinnedAnswers);
}
```

**Why here:** This runs once before the classification loop. By the time we enter the per-issue loop, `updatedSession.confirmed_followup_answers` contains all prior rounds plus the current round's answers.

### Task 5.3: Restructure Steps A/B/C — overlay, normalization, implication, post-overlay validation

Replace the current Step A → Step B → Step C block (lines 293–376) with the restructured pipeline. The diff is described below by section.

**Step A (lines 293–346): UNCHANGED.** Hierarchy validation + retry on raw classifier output stays as-is.

**Step A2 (NEW, insert after line 346, before current Step B):**

Overlay pinned answers and remove pinned fields from missing_fields:

```typescript
// Step A2: Overlay tenant-confirmed answers (Bug-009 Phase 2).
// This runs BEFORE normalization and implication so that pinned parent
// values (e.g., Maintenance_Object=toilet) drive downstream constraint
// resolution (e.g., Sub_Location=bathroom).
const pinnedForIssue = updatedSession.confirmed_followup_answers?.[issue.issue_id] ?? {};
const pinnedFieldSet = new Set(Object.keys(pinnedForIssue));
if (pinnedFieldSet.size > 0) {
  output = {
    ...output,
    classification: { ...output.classification, ...pinnedForIssue },
    missing_fields: output.missing_fields.filter((f) => !pinnedFieldSet.has(f)),
  };
}
```

**Step B' (MOVED, was Step C at lines 369–372):**

Cross-domain normalization moves to immediately after the overlay, before implication:

```typescript
// Step B': Cross-domain normalization (moved before implication).
// Runs on the merged classification so that cross-domain blanks introduced
// by the overlay are filled with 'not_applicable' before implication runs.
output = {
  ...output,
  classification: normalizeCrossDomainClassification(output.classification),
};
```

**Step C' (MOVED, was Step B at lines 349–363):**

Implied-field resolution moves to after normalization, so pinned parents participate:

```typescript
// Step C': Implied-field resolution (moved after overlay + normalization).
// Pinned parent values now participate in constraint narrowing.
const impliedFields = output.needs_human_triage
  ? {}
  : resolveConstraintImpliedFields(output.classification, taxonomyConstraints, taxonomyVersion);
if (Object.keys(impliedFields).length > 0) {
  output = { ...output, classification: { ...output.classification, ...impliedFields } };
  await deps.eventRepo.insert({
    event_id: deps.idGenerator(),
    event_type: 'classification_constraint_resolution',
    conversation_id: session.conversation_id,
    issue_id: issue.issue_id,
    payload: { resolved_fields: impliedFields },
    created_at: deps.clock(),
  });
}
```

**Step C2 (NEW, insert after Step C'):**

Post-overlay hierarchy validation to catch contradictions introduced by pinned answers. No retry — pinned values are authoritative; contradictions route to triage.

```typescript
// Step C2: Post-overlay hierarchy validation (Bug-009 Phase 2).
// Catches contradictions introduced by pinned answers (e.g., a stale
// pinned Management_Category after Category resolved to maintenance).
// No retry — pinned values are authoritative. Contradictions route to
// needs_human_triage for human review.
if (!output.needs_human_triage && pinnedFieldSet.size > 0) {
  const postOverlayHierarchy = validateHierarchicalConstraints(
    output.classification,
    taxonomyConstraints,
    taxonomyVersion,
  );
  if (!postOverlayHierarchy.valid) {
    output = { ...output, needs_human_triage: true };
    classifierTriageReason = ClassifierTriageReason.CONSTRAINT_RETRY_FAILED;
    await deps.eventRepo.insert({
      event_id: deps.idGenerator(),
      event_type: 'classification_pinned_answer_contradiction',
      conversation_id: session.conversation_id,
      issue_id: issue.issue_id,
      payload: {
        violations: postOverlayHierarchy.violations,
        pinned_fields: pinnedForIssue,
      },
      created_at: deps.clock(),
    });
  }
}
```

**Completeness gate (was part of Step C, lines 365–376):**

The completeness gate stays in its current position relative to the rest of the pipeline, but now runs on the fully merged + normalized + implied classification:

```typescript
// Completeness gate
let completenessIncomplete: string[] = [];
let completenessFollowupTypes: Record<string, string> = {};

const category = output.classification.Category ?? '';
const completenessResult = checkCompleteness(output.classification, category);
completenessIncomplete = [...completenessResult.incompleteFields];
completenessFollowupTypes = { ...completenessResult.followupTypes };
```

Note: the normalization line that was between the `completenessFollowupTypes` declaration and the `category` extraction is no longer here — it moved to Step B'.

### Task 5.4: Override confidence for pinned fields (after confidence computation, before line 388)

Replace lines 379–386:

```typescript
// Step D: Confidence with constraint boost (C2)
const confidenceDetail = computeAllFieldConfidences({
  classification: output.classification,
  modelConfidence: output.model_confidence,
  cueResults: cueScoreMap,
  config: confidenceConfig,
  impliedFields,
});
const computedConfidence = extractFlatConfidence(confidenceDetail);
```

With:

```typescript
// Step D: Confidence with constraint boost (C2)
const rawConfidenceDetail = computeAllFieldConfidences({
  classification: output.classification,
  modelConfidence: output.model_confidence,
  cueResults: cueScoreMap,
  config: confidenceConfig,
  impliedFields,
});

// Override confidence for pinned fields to 1.0 (Bug-009 Phase 2).
// Prevents pinned fields from entering fieldsNeedingInput via the
// confidence gate. Downstream consumers see consistent scores.
const confidenceDetail: Record<string, FieldConfidenceDetail> = { ...rawConfidenceDetail };
for (const field of pinnedFieldSet) {
  if (field in confidenceDetail) {
    confidenceDetail[field] = {
      confidence: 1.0,
      components: confidenceDetail[field].components,
    };
  }
}

const computedConfidence = extractFlatConfidence(confidenceDetail);
```

### Task 5.5: Remove pinned fields from fieldsNeedingInput (after line 393, before line 395)

After `determineFieldsNeedingInput` and before the existing this-round short-circuit:

```typescript
// Remove pinned fields from fieldsNeedingInput (Bug-009 Phase 2).
// Tenant-confirmed values are authoritative and should not be re-asked.
if (pinnedFieldSet.size > 0) {
  fieldsNeedingInput = fieldsNeedingInput.filter((f) => !pinnedFieldSet.has(f));
}
```

**Why keep the existing short-circuit (lines 395–399):** It's partially redundant for enum answers (already in `pinnedFieldSet`), but still covers `yes_no` and `text` answers that are not pinned. No changes to those lines.

### Summary of handler changes

**Before the loop (Task 5.2):** Accumulate this round's enum answers into the session's confirmed map.

**Inside the loop (Tasks 5.3–5.5):** For each issue:

- Step A: Hierarchy check on raw classifier output (unchanged)
- Step A2: Overlay pinned answers (new)
- Step B': Normalization (moved earlier)
- Step C': Implication (moved later — after overlay)
- Step C2: Post-overlay hierarchy check (new)
- Completeness gate (unchanged, but normalization line removed since it moved)
- Confidence computation + pinned override (modified)
- fieldsNeedingInput + pinned exclusion (modified)
- Existing short-circuits (unchanged)

Variables `pinnedForIssue` and `pinnedFieldSet` are defined once in Step A2 and used through the rest of the loop iteration.

---

## Step 6 — Regression tests

**File:** `packages/core/src/__tests__/followup/bug-009-answer-pinning.test.ts` (new)

### Test fixture pattern

Follow the same pattern as `answer-followups.test.ts` and `bug-009-followup-ordering.test.ts`:

- Build a `ConversationSession` with `classification_results`, `pending_followup_questions`, `split_issues`, and `confirmed_followup_answers` set
- Wire stub LLM functions (`issueClassifier`, `followUpGenerator`) via `ActionHandlerContext.deps`
- Call `handleAnswerFollowups(ctx)` and assert on the returned result and updated session

### Test cases

```
describe('Bug-009 Phase 2: follow-up answer pinning', () => {

  // --- Core pinning behavior ---

  it('pins an enum answer from round 1 so it is not re-asked in round 2')
    // Round 1: pending question for Location (enum), tenant answers 'suite'
    // Classifier on re-classify returns Location with low confidence
    // Assert: Location not in fieldsNeedingInput
    // Assert: session.confirmed_followup_answers has { [issueId]: { Location: 'suite' } }

  it('overwrites classifier value with pinned tenant answer')
    // Round 1: tenant answered Maintenance_Object = 'toilet'
    // Round 2: classifier returns Maintenance_Object = 'faucet'
    // Assert: classifierOutput.classification.Maintenance_Object === 'toilet'
    // Assert: confirmation payload shows 'toilet', not 'faucet'

  it('sets confidence to 1.0 for pinned fields')
    // Tenant answered Location = 'suite' in prior round
    // Classifier returns Location with model_confidence 0.3
    // Assert: computedConfidence.Location === 1.0

  it('accumulates pinned answers across multiple rounds')
    // Round 1: pin Location = 'suite'
    // Round 2: pin Sub_Location = 'bathroom'
    // Assert: confirmed_followup_answers has both Location and Sub_Location
    // Assert: neither is re-asked

  // --- Answer type filtering ---

  it('does not pin yes_no answers as taxonomy field values')
    // Pending question with answer_type='yes_no', tenant answers true
    // Assert: confirmed_followup_answers does not contain that field
    // Assert: field can still appear in fieldsNeedingInput

  it('does not pin text answers as taxonomy field values')
    // Pending question with answer_type='text', tenant answers 'my faucet is dripping'
    // Assert: confirmed_followup_answers does not contain that field

  // --- Constraint integration ---

  it('pinned parent value drives implied-field resolution')
    // Prior round pinned Maintenance_Object = 'toilet' (via enum answer)
    // Classifier returns Sub_Location = '' (unresolved)
    // After overlay + implication: Sub_Location is implied as 'bathroom'
    //   via Maintenance_Object_to_Sub_Location constraint
    // Assert: classifierOutput.classification.Sub_Location === 'bathroom'
    // Assert: classification_constraint_resolution event is logged
    //   with resolved_fields including Sub_Location

  it('routes to triage when pinned answer contradicts resolved category')
    // Prior round pinned Management_Category = 'rent_issues'
    //   (category was ambiguous at the time)
    // This round: classifier resolves Category = 'maintenance' confidently
    // After overlay: classification has Category='maintenance' AND
    //   Management_Category='rent_issues' (contradiction)
    // Post-overlay hierarchy check catches the violation
    // Assert: output.needs_human_triage === true
    // Assert: eventRepo contains a 'classification_pinned_answer_contradiction' event
    //   with violations array and pinned_fields: { Management_Category: 'rent_issues' }

  // --- Stored results integrity ---

  it('classification_results on session are post-overlay, post-normalization, post-implication values')
    // Classifier returns Maintenance_Object = 'faucet' with low confidence
    // Prior round pinned Maintenance_Object = 'toilet'
    // Assert: session.classification_results[0].classifierOutput.classification.Maintenance_Object === 'toilet'
    // Assert: session.classification_results[0].computedConfidence.Maintenance_Object === 1.0
    // This proves downstream consumers (payload builder, work-order creator)
    //   see the effective pinned values without re-derivation

  // --- Edge cases ---

  it('pinned field is not re-added by completeness gate')
    // Completeness gate would flag Location as incomplete if blank
    // But Location is pinned to 'suite'
    // Assert: Location not in fieldsNeedingInput after completeness merge

  it('pinned field is removed from missing_fields')
    // Classifier reports Location in missing_fields
    // But Location is pinned
    // Assert: classificationResult.classifierOutput.missing_fields does not include Location

  it('existing dependency-ordering behavior is preserved')
    // Verify that field-ordering frontier filtering still works
    // with pinned answers present

})
```

**Run:** `pnpm --filter @wo-agent/core exec vitest run src/__tests__/followup/bug-009-answer-pinning.test.ts`

---

## Step 7 — Run full test suite

```bash
pnpm test
pnpm typecheck
pnpm lint
```

**Expected impact on existing tests:**

- Tests in `answer-followups.test.ts` that check `fieldsNeedingInput` content should still pass — pinning only affects fields that were answered via enum questions, and existing test fixtures either don't set `confirmed_followup_answers` (defaults to `{}`) or use sessions created via `createSession()` (which now initializes it to `{}`).
- Tests that construct `ConversationSession` object literals without `confirmed_followup_answers` will get a TypeScript error. These need the new field added. Search for `ConversationSession` object literals in test files and add `confirmed_followup_answers: {}`.
- The reorder of normalization and implication (Steps B' and C') does not change their outputs when there are no pinned answers, because normalization only fills blanks and implication only resolves empty/vague values. Existing tests that assert on classification outputs should pass unchanged.

**Key test files to check for missing `confirmed_followup_answers: {}`:**

- `answer-followups.test.ts`
- `reclassification.test.ts`
- `remaining-handlers.test.ts`
- `bug-009-followup-ordering.test.ts`
- `e2e-toilet-leak.test.ts`
- `followup-integration.test.ts`

---

## Step 8 — Update trackers

### Task 7.1: Update the Phase 1 plan doc

**File:** `docs/plans/2026-03-30-bug-009-followup-question-ordering.md`

Add a note at the top:

```markdown
> **Status:** Phase 1 (dependency ordering) is DONE. Phase 2 (answer pinning) is
> tracked in `2026-03-30-bug-009-phase2-answer-pinning.md`.
```

### Task 7.2: Update `docs/bug-tracker.md`

Update the BUG-009 row:

- **Status:** `IN PROGRESS` → `DONE` (after implementation)
- **Fix:** Dependency-order gating (Phase 1) + follow-up answer pinning (Phase 2)
- **Evidence:** Tests in `bug-009-followup-ordering.test.ts` (Phase 1), `bug-009-answer-pinning.test.ts` (Phase 2)

---

## Risk Assessment

| Risk                                                                   | Likelihood         | Mitigation                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing tests fail due to new required field on `ConversationSession` | High (known)       | Add `confirmed_followup_answers: {}` to all test fixtures that construct session literals. Mechanical change.                                                                                                  |
| Pinned parent value not driving implication                            | Eliminated         | Overlay runs BEFORE implication (Step A2 before Step C'). Verified by dedicated test case "pinned parent value drives implied-field resolution".                                                               |
| Stale cross-domain pin contradicts resolved category                   | Caught             | Post-overlay hierarchy check (Step C2) detects violation and routes to `needs_human_triage`. Verified by dedicated test case "routes to triage when pinned answer contradicts resolved category".              |
| Reorder of normalization/implication breaks existing behavior          | Low                | Normalization only fills blanks; implication only resolves empty/vague. Neither overwrites the other. When no pinned answers exist, the pipeline produces identical output. Full test suite (Step 7) verifies. |
| Completeness gate re-adds a pinned field                               | Low                | Overlay runs BEFORE completeness gate, so the gate sees the pinned value as filled. Task 5.5 removes pinned fields from `fieldsNeedingInput` as a safety net after the completeness merge.                     |
| Postgres sessions missing the field                                    | Low                | `?? {}` fallback at access sites. `mergeConfirmedFollowupAnswers` handles missing field defensively.                                                                                                           |
| EDIT_ISSUE needs to unpin a field (future)                             | N/A (out of scope) | The map is a plain Record — a future handler can delete or overwrite entries. No structural blocker.                                                                                                           |

## Scope Boundaries

**In scope:**

- Session-persisted per-issue confirmed answers map
- Event contract update: `classification_pinned_answer_contradiction` added to `ClassificationEvent` union (`classification-event.ts`) with corresponding `pg-event-store.test.ts` coverage
- Restructured pipeline: overlay → normalization → implication → post-overlay hierarchy check
- Post-overlay consistency pass routing contradictions to triage
- Confidence override to 1.0 for pinned fields
- Exclusion from `fieldsNeedingInput` and `missing_fields`
- Regression tests for all pinning behaviors including constraint integration, contradiction detection, and stored-results integrity
- Tracker updates

**Out of scope:**

- New conversation stages or state machine changes
- Replacing the re-classification loop
- Changes to `start-classification.ts` (first round has no prior answers)
- EDIT_ISSUE as an unpin mechanism
- Changes to `payload-builder.ts` (reads from already-overlaid `classifierOutput`)
- Changes to the frontend `confirmation-panel.tsx`
- Prompt or LLM behavior changes
- New `ClassifierTriageReason` values (reuses `CONSTRAINT_RETRY_FAILED`; the distinct event type `classification_pinned_answer_contradiction` provides specificity in the audit log)
