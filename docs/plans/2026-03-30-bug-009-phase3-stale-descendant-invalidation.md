# Implementation Plan: Bug-009 Phase 3 — Stale Descendant Invalidation

> **Status:** Draft v3 — v2 fixes (DB routing, 2-way source, caps alignment) + v3 fixes (issue scoping, multi-parent accumulation, audit trail)
> **Prereqs:** Phase 1 (dependency ordering) and Phase 2 (answer pinning) are both implemented.

**Date:** 2026-03-30
**Bug:** BUG-009 — Stale descendant values survive parent re-confirmation, carrying contradictions into confirmation/review

## Problem

Phase 2 added answer pinning: enum follow-up answers are persisted in `confirmed_followup_answers` and overlaid onto classifier output each round. But pinning is additive-only — `mergeConfirmedFollowupAnswers()` merges, never removes. When a tenant confirms a parent field to a _different_ value than assumed by existing descendant pins or classifier guesses, those stale descendants persist.

**Concrete scenario:**

1. Round 1: Classifier guesses `Maintenance_Object=toilet`, `Sub_Location=bathroom`. Tenant confirms `Sub_Location=bathroom` (pinned).
2. Round 2: Tenant is asked about `Maintenance_Category`, answers `plumbing` (pinned).
3. Round 3: System asks `Maintenance_Object`. Tenant says `faucet` — but before that question, they correct `Sub_Location=kitchen`.
4. The pin `Sub_Location=kitchen` is added. But the prior pin `Maintenance_Category=plumbing` might still be valid for kitchen, while `Maintenance_Object=toilet` (classifier guess, not pinned) is now stale. The stale guess carries into confirmation.

**Root cause in code:** In [answer-followups.ts](packages/core/src/orchestrator/action-handlers/answer-followups.ts), Step A2 (lines 370–380) overlays all pins blindly. There is no step that checks whether descendant values are still valid under newly confirmed parent values.

## Design

### Invalidation Algorithm

Add a deterministic **cascading validation pass** after the pin overlay. For each parent field that changed this round, walk descendants in forward-hierarchy order and check validity using existing constraint maps.

```
function invalidateStaleDescendants(changedParentField, classification, pins, constraints):
  result = []
  workingClassification = { ...classification }

  for descendant in getForwardDescendants(changedParentField):
    currentValue = workingClassification[descendant]
    if !currentValue or isVague(currentValue):
      continue

    validOptions = resolveValidOptions(descendant, workingClassification, constraints)
    if validOptions === null:
      continue  // unconstrained

    if !validOptions.includes(currentValue):
      wasPinned = descendant in pins
      result.push({ field: descendant, oldValue: currentValue, wasPinned })
      workingClassification[descendant] = ''  // clear so downstream checks cascade

  return result
```

**Why cascading:** If `Maintenance_Category` is cleared because it's invalid under a new `Sub_Location`, then `Maintenance_Object` must also be checked against the now-empty `Maintenance_Category`. Since `resolveValidOptions` returns `null` for an empty parent, the object would be unconstrained — but that's wrong (it had a specific value that depended on the now-invalid category). The algorithm handles this by clearing the working classification as it goes, so `resolveValidOptions` for `Maintenance_Object` sees the cleared `Maintenance_Category` and returns `null` (unconstrained). To handle this correctly, we apply a stricter rule: **if a field's immediate parent was just cleared in this same pass, clear the field unconditionally** regardless of constraint check result.

### Source Attribution: Pinned vs Unpinned (2-Way)

The original draft proposed a 3-way source distinction (`pinned` / `classifier` / `constraint_implied`). This is **not implementable from current persisted state**: the session stores no provenance for previously constraint-implied fields. The `classification_constraint_resolution` events are logged but not queryable at the invalidation point without an async event query, and recomputing prior-round implied fields from the current round's raw classifier output is against the wrong baseline.

**Simplified to 2-way:** Each cleared field is either `pinned` (exists in `confirmed_followup_answers`) or `unpinned` (everything else — classifier guess or prior constraint implication). This is deterministic from session state alone.

| Source                                         | UX Treatment                                                                                                                                                                                                                                                 | Example                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `pinned` (was in `confirmed_followup_answers`) | Contradiction prompt with explicit wording                                                                                                                                                                                                                   | "You said toilet, but that doesn't apply in a kitchen. Which fixture?" |
| `unpinned` (classifier guess or prior implied) | Silent clear; field re-enters `fieldsNeedingInput` naturally via confidence pipeline; asked with neutral wording by normal follow-up generator. Constraint-implied values may silently re-derive in Step C' if the new ancestry still narrows to one option. | Standard follow-up question or silent re-derivation                    |

Only **stale pins** get the deterministic hierarchy-conflict question. Everything else is handled by the existing pipeline.

### Pipeline Placement

The invalidation step slots into the existing per-issue classification loop as Step A3, between overlay (A2) and normalization (B'):

```
1. Classifier call → raw output
2. Step A:  Hierarchy validation + retry on RAW output         [UNCHANGED]
3. Step A2: Overlay ALL pinned answers into classification      [UNCHANGED]
4. Step A3: Descendant invalidation                             [NEW]
            - Detect parent changes (this round's new pins vs prior classification)
            - Cascade-validate descendants
            - Remove invalidated pins from session
            - Clear invalidated values from classification
            - Record invalidation event
5. Step B': Cross-domain normalization                          [UNCHANGED]
6. Step C': Implied-field resolution                            [UNCHANGED]
7. Step C2: Post-overlay hierarchy check                        [UNCHANGED]
...rest unchanged...
```

### Follow-Up Integration

After the per-issue loop, in the follow-up generation section:

1. Collect all invalidation results from the loop (across issues).
2. If any cleared fields have `source: 'pinned'`, build a deterministic hierarchy-conflict question for the **earliest** one in the hierarchy (one contradiction prompt per round).
3. Insert that question at the front of the generated question list.
4. The remaining follow-up questions come from the normal LLM generator.
5. If the contradiction question is the ONLY question needed and the LLM generator would otherwise produce nothing, the contradiction question alone is sufficient — no LLM call needed.

### Pin Removal

Add `removeConfirmedFollowupAnswers()` to `session.ts` — mirrors the existing `mergeConfirmedFollowupAnswers()` but removes specified fields from the per-issue map.

### Caps Behavior

Invalidated fields use existing budgets:

- `previous_questions` counts are NOT reset for invalidated fields
- If an invalidated field has already been asked the maximum number of times, the normal escape hatch applies (caps exhausted → route to confirmation)
- The hierarchy-conflict question counts as a new ask against `previous_questions`

---

## Acceptance Criteria

1. When a newly confirmed parent makes a pinned descendant invalid, that pin is removed from `confirmed_followup_answers`.
2. When a newly confirmed parent makes an unpinned descendant invalid (classifier guess or prior constraint implication), the value is cleared from the effective classification. Previously constraint-implied values may silently re-derive in Step C' if the new ancestry still narrows to one option.
3. Invalidated pinned fields produce a follow-up question with explicit contradiction wording.
4. Invalidated unpinned fields are cleared silently and re-enter `fieldsNeedingInput` via the normal confidence pipeline.
5. Multi-level cascade works: changing `Location` can clear `Sub_Location`, `Maintenance_Category`, `Maintenance_Object`, and `Maintenance_Problem` in one pass.
6. A `classification_descendant_invalidation` event is recorded with parent change details, cleared fields, and `was_pinned` flags. The event routes through `insertClassification()` in `pg-event-store.ts` (not the generic fallback).
7. Invalidated fields use existing `previous_questions` counts (no reset).
8. If an invalidated field is maxed on re-asks, the existing escape hatch applies — the contradiction question is NOT generated for that field.
9. The contradiction question consumes budget from `capsCheck.remainingQuestionBudget` and its field is removed from `capsCheck.eligibleFields` before the LLM generator runs.
10. The contradiction question targets `targetResult.issue_id` (the issue selected for follow-up generation), not `targetIssueId` (the issue whose answers were received). Eligible fields passed to the LLM generator are intersected with `targetResult.fieldsNeedingInput` so only fields belonging to the targeted issue reach the generator. This scoping applies to both the contradiction question path and the normal LLM generator call, since `adjustedEligibleFields` is initialized from the intersection and is the value that flows into `followUpInput.fields_needing_input`.
11. When multiple parent fields change in one round, invalidation results are accumulated (not overwritten). The merged `earliestClearedPin` reflects the true earliest pin across all parent changes.
12. The `classification_descendant_invalidation` event's `parent_old_value` uses the prior round's stored effective classification (`session.classification_results`) when available, falling back to the current round's raw classifier output only as a last resort.
13. Re-pinning: if a tenant re-confirms the same value after invalidation, the flow stabilizes without looping.
14. All existing tests pass.

---

## Sequencing Overview

| Step | What                                                                 | Files                                                              | Depends On |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| 1    | Add `removeConfirmedFollowupAnswers()` session helper                | `session/session.ts`, `session/index.ts`                           | —          |
| 2    | Add `classification_descendant_invalidation` event type + DB routing | `classifier/classification-event.ts`, `db/repos/pg-event-store.ts` | —          |
| 3    | Create descendant invalidation module                                | `classifier/descendant-invalidation.ts` (new)                      | —          |
| 4    | Create hierarchy-conflict question builder                           | `followup/hierarchy-conflict-questions.ts` (new)                   | —          |
| 5    | Wire invalidation into `answer-followups.ts`                         | `orchestrator/action-handlers/answer-followups.ts`                 | Steps 1–4  |
| 6    | Update barrel exports                                                | `classifier/index.ts`, `followup/index.ts`                         | Steps 1–4  |
| 7    | Unit tests: descendant invalidation                                  | `__tests__/classifier/descendant-invalidation.test.ts` (new)       | Step 3     |
| 8    | Unit tests: hierarchy-conflict questions                             | `__tests__/followup/hierarchy-conflict-questions.test.ts` (new)    | Step 4     |
| 9    | Integration tests: stale pin invalidation in handler                 | `__tests__/followup/bug-009-stale-pin-invalidation.test.ts` (new)  | Step 5     |
| 10   | Run full test suite, fix breakage                                    | —                                                                  | Steps 1–9  |
| 11   | Update bug tracker and spec gap tracker                              | `docs/bug-tracker.md`, `docs/spec-gap-tracker.md`                  | Step 10    |

**Parallelizable:** Steps 1–4 are independent. Steps 7–8 can run after their respective source files. Step 9 requires Step 5.

---

## Step 1 — Add `removeConfirmedFollowupAnswers()` Session Helper

**File:** `packages/core/src/session/session.ts`

Add after `mergeConfirmedFollowupAnswers` (after line 310):

```typescript
/**
 * Remove specified fields from the confirmed follow-up answers for a given issue.
 * Used when descendant invalidation clears stale pins after a parent re-confirmation.
 *
 * Returns the session unchanged if no fields match or the issue has no pins.
 */
export function removeConfirmedFollowupAnswers(
  session: ConversationSession,
  issueId: string,
  fieldsToRemove: readonly string[],
): ConversationSession {
  const existing = session.confirmed_followup_answers ?? {};
  const issuePins = existing[issueId];
  if (!issuePins || fieldsToRemove.length === 0) return session;

  const updated = { ...issuePins };
  let changed = false;
  for (const field of fieldsToRemove) {
    if (field in updated) {
      delete updated[field];
      changed = true;
    }
  }
  if (!changed) return session;

  return {
    ...session,
    confirmed_followup_answers: {
      ...existing,
      [issueId]: updated,
    },
  };
}
```

**File:** `packages/core/src/session/index.ts`

Add `removeConfirmedFollowupAnswers` to the named export block from `./session.js`.

---

## Step 2 — Add `classification_descendant_invalidation` Event Type

### Task 2.1: Update the TypeScript union

**File:** `packages/core/src/classifier/classification-event.ts`

Add to the `event_type` union:

```typescript
  readonly event_type:
    | 'classification_hierarchy_violation_unresolved'
    | 'classification_constraint_resolution'
    | 'classification_pinned_answer_contradiction'
    | 'classification_descendant_invalidation';
```

### Task 2.2: Update the Postgres event store routing set

**File:** `packages/db/src/repos/pg-event-store.ts`

The `CLASSIFICATION_EVENT_TYPES` set (lines 22–26) is a **runtime allowlist** that routes events through `insertClassification()` — which stores `issue_id` inside the JSONB payload for query optimization. If the new event type is not in this set, it falls through to the generic insert path and loses classification-specific handling.

Add to the set:

```typescript
const CLASSIFICATION_EVENT_TYPES = new Set<ClassificationEvent['event_type']>([
  'classification_hierarchy_violation_unresolved',
  'classification_constraint_resolution',
  'classification_pinned_answer_contradiction',
  'classification_descendant_invalidation',
]);
```

### Expected payload shape (not enforced by type, documented here):

```typescript
{
  parent_field: string;
  parent_old_value: string;
  parent_new_value: string;
  cleared_fields: Array<{
    field: string;
    old_value: string;
    was_pinned: boolean;
  }>;
}
```

---

## Step 3 — Create Descendant Invalidation Module

**File:** `packages/core/src/classifier/descendant-invalidation.ts` (new)

```typescript
import type { TaxonomyConstraints } from '@wo-agent/schemas';
import { resolveValidOptions, isConstraintResolvedValue } from './constraint-resolver.js';

/**
 * Forward hierarchy for maintenance issues.
 * Each entry maps a parent field to its immediate child in the dependency chain.
 */
const MAINTENANCE_FORWARD_CHAIN: ReadonlyArray<readonly [string, string]> = [
  ['Location', 'Sub_Location'],
  ['Sub_Location', 'Maintenance_Category'],
  ['Maintenance_Category', 'Maintenance_Object'],
  ['Maintenance_Object', 'Maintenance_Problem'],
];

export interface ClearedField {
  readonly field: string;
  readonly oldValue: string;
  /** Whether this field was a tenant-confirmed pin (true) or an unpinned value
   *  from the classifier or constraint implication (false). Determined solely
   *  from `confirmed_followup_answers` — no prior-round provenance needed. */
  readonly wasPinned: boolean;
}

export interface InvalidationResult {
  /** Fields that were cleared, in hierarchy order. */
  readonly clearedFields: readonly ClearedField[];
  /** Field names of cleared pins (subset of clearedFields where wasPinned). */
  readonly clearedPinFields: readonly string[];
  /** The earliest cleared field that was a prior pin (for contradiction prompt). */
  readonly earliestClearedPin: ClearedField | null;
}

/**
 * Get all descendant fields of a given parent in the forward maintenance hierarchy.
 * Returns fields in hierarchy order (immediate child first).
 * Exported for use in follow-up generation (finding trigger parent for a cleared field).
 */
export function getForwardDescendants(parentField: string): string[] {
  const descendants: string[] = [];
  let current = parentField;
  for (const [parent, child] of MAINTENANCE_FORWARD_CHAIN) {
    if (parent === current) {
      descendants.push(child);
      current = child;
    }
  }
  return descendants;
}

/**
 * After a parent field is confirmed to a new value, cascade-validate all
 * descendant fields in the forward hierarchy. Any descendant whose current
 * value is no longer valid under the updated ancestry is marked for clearing.
 *
 * The algorithm walks descendants in order. When a field is cleared, its
 * children are also cleared unconditionally (their validity depended on the
 * now-cleared parent).
 *
 * Source attribution is 2-way (pinned vs unpinned), determined solely from
 * `confirmed_followup_answers`. The session does not persist per-field
 * provenance for constraint-implied vs classifier values, so we do not
 * attempt to distinguish them. Unpinned values that were previously
 * constraint-implied will silently re-derive in Step C' if the new ancestry
 * still narrows to one option.
 *
 * @param changedParentField - The field that was just re-confirmed
 * @param classification - The effective classification AFTER pin overlay (Step A2)
 * @param pins - The confirmed_followup_answers for this issue (BEFORE removal)
 * @param constraints - Taxonomy constraint maps
 */
export function invalidateStaleDescendants(
  changedParentField: string,
  classification: Record<string, string>,
  pins: Readonly<Record<string, string>>,
  constraints: TaxonomyConstraints,
): InvalidationResult {
  const descendants = getForwardDescendants(changedParentField);
  if (descendants.length === 0) {
    return { clearedFields: [], clearedPinFields: [], earliestClearedPin: null };
  }

  const working = { ...classification };
  const cleared: ClearedField[] = [];
  let parentJustCleared = false;

  for (const descendant of descendants) {
    const currentValue = working[descendant];

    // Nothing to invalidate if the field is empty or vague
    if (!isConstraintResolvedValue(currentValue, { treatNeedsObjectAsUnresolved: true })) {
      // If parent was cleared, even an unresolved descendant resets the cascade flag
      // so we don't blindly clear everything below a gap
      if (parentJustCleared) {
        parentJustCleared = false;
      }
      continue;
    }

    let shouldClear = false;

    if (parentJustCleared) {
      // Immediate parent was just cleared in this pass — clear unconditionally
      shouldClear = true;
    } else {
      // Check if current value is still valid under updated ancestry
      const validOptions = resolveValidOptions(descendant, working, constraints);
      if (validOptions !== null && !validOptions.includes(currentValue)) {
        shouldClear = true;
      }
    }

    if (shouldClear) {
      const wasPinned = descendant in pins;
      cleared.push({ field: descendant, oldValue: currentValue, wasPinned });
      working[descendant] = '';
      parentJustCleared = true;
    } else {
      parentJustCleared = false;
    }
  }

  const clearedPinFields = cleared.filter((c) => c.wasPinned).map((c) => c.field);
  const earliestClearedPin = cleared.find((c) => c.wasPinned) ?? null;

  return { clearedFields: cleared, clearedPinFields, earliestClearedPin };
}
```

---

## Step 4 — Create Hierarchy-Conflict Question Builder

**File:** `packages/core/src/followup/hierarchy-conflict-questions.ts` (new)

```typescript
import type { TaxonomyConstraints } from '@wo-agent/schemas';
import type { FollowUpQuestion } from '@wo-agent/schemas';
import { resolveValidOptions } from '../classifier/constraint-resolver.js';
import type { ClearedField } from '../classifier/descendant-invalidation.js';

/** Human-readable labels for taxonomy field names. */
const FIELD_LABELS: Record<string, string> = {
  Sub_Location: 'location in the unit',
  Maintenance_Category: 'type of maintenance issue',
  Maintenance_Object: 'specific fixture or item',
  Maintenance_Problem: 'problem',
};

function formatValue(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Build a deterministic follow-up question for a hierarchy-invalidated field
 * that was previously pinned by the tenant.
 *
 * Returns null if the cleared field was not a pin (unpinned values are handled
 * by the normal follow-up pipeline after re-entering fieldsNeedingInput).
 *
 * @param cleared - The cleared field info (from invalidation result)
 * @param parentField - The parent field that changed
 * @param parentValue - The new parent value
 * @param classification - Current effective classification (after clearing)
 * @param constraints - Taxonomy constraint maps
 * @param idGenerator - ID generator function
 */
export function buildHierarchyConflictQuestion(
  cleared: ClearedField,
  parentField: string,
  parentValue: string,
  classification: Record<string, string>,
  constraints: TaxonomyConstraints,
  idGenerator: () => string,
): FollowUpQuestion | null {
  // Only build contradiction prompts for stale pins
  if (!cleared.wasPinned) return null;

  const validOptions = resolveValidOptions(cleared.field, classification, constraints);
  if (!validOptions || validOptions.length === 0) return null;

  const fieldLabel = FIELD_LABELS[cleared.field] ?? formatValue(cleared.field);
  const oldLabel = formatValue(cleared.oldValue);
  const parentLabel = formatValue(parentValue);

  return {
    question_id: idGenerator(),
    field_target: cleared.field,
    prompt: `You previously mentioned "${oldLabel}", but that doesn't apply for "${parentLabel}". Which ${fieldLabel} applies instead?`,
    options: validOptions.slice(0, 10), // cap at 10 to match existing constraint hint behavior
    answer_type: 'enum' as const,
  };
}
```

---

## Step 5 — Wire Invalidation into `answer-followups.ts`

**File:** `packages/core/src/orchestrator/action-handlers/answer-followups.ts`

This is the core wiring step. Changes are organized by location in the file.

### Task 5.1: Add imports

Add to existing import blocks:

```typescript
import {
  removeConfirmedFollowupAnswers,
  mergeConfirmedFollowupAnswers,
  // ... existing imports
} from '../../session/session.js';

import {
  invalidateStaleDescendants,
  getForwardDescendants,
  type InvalidationResult,
} from '../../classifier/descendant-invalidation.js';

import { buildHierarchyConflictQuestion } from '../../followup/hierarchy-conflict-questions.js';
```

### Task 5.2: Track parent changes before classification loop

After pinning new answers (~line 222) and before the per-issue classification loop (~line 231), detect which parent fields changed this round:

```typescript
// Detect which fields were newly pinned this round (for invalidation triggers).
// A field is a "changed parent" if it was pinned this round AND either:
//   (a) it had no prior pin, OR
//   (b) the prior pin value was different.
// Compare against the PRE-merge session pins (the original `session`, not
// `updatedSession` which already has this round's merges).
const priorPinsForTarget = session.confirmed_followup_answers?.[targetIssueId] ?? {};
const changedParentFields: Array<{ field: string; newValue: string }> = [];
for (const [field, value] of Object.entries(newPinnedAnswers)) {
  const priorPinValue = priorPinsForTarget[field];
  if (priorPinValue !== value) {
    changedParentFields.push({ field, newValue: value });
  }
}
```

### Task 5.3: Hoist invalidation results map before classification loop

```typescript
// Collect per-issue invalidation results for use in follow-up generation.
const invalidationResults = new Map<string, InvalidationResult>();
```

### Task 5.4: Add Step A3 inside the per-issue classification loop

Insert after Step A2 (pin overlay, ~line 380) and before Step B' (normalization).

**Note:** `classifierRawClassification` must be captured before Step A2. Add this line right before Step A2:

```typescript
const classifierRawClassification = { ...output.classification };
```

Then insert Step A3:

```typescript
// Step A3: Descendant invalidation (Bug-009 Phase 3).
// When a newly confirmed parent makes descendant values invalid,
// clear those descendants and remove stale pins.
//
// Source attribution is 2-way (pinned vs unpinned). The session does not
// persist per-field provenance for constraint-implied vs classifier values,
// so we check only `confirmed_followup_answers`. Unpinned values that were
// previously constraint-implied will silently re-derive in Step C' if the
// new ancestry still narrows to one option.
if (issue.issue_id === targetIssueId && changedParentFields.length > 0) {
  // Accumulate cleared fields across all changed parents for this issue.
  // Multiple parents can change in one round (e.g., tenant answers both
  // Location and Sub_Location). Each parent's invalidation runs against
  // the progressively-cleared classification, so later parents see the
  // effects of earlier clears. Results are merged, not replaced.
  const allCleared: ClearedField[] = [];
  const allClearedPinFields: string[] = [];

  for (const { field: parentField, newValue } of changedParentFields) {
    const result = invalidateStaleDescendants(
      parentField,
      output.classification,
      pinnedForIssue,
      taxonomyConstraints,
    );

    if (result.clearedFields.length > 0) {
      // Remove invalidated pins from session
      if (result.clearedPinFields.length > 0) {
        updatedSession = removeConfirmedFollowupAnswers(
          updatedSession,
          issue.issue_id,
          result.clearedPinFields,
        );
        // Update the pinnedForIssue/pinnedFieldSet for remaining pipeline steps
        for (const f of result.clearedPinFields) {
          pinnedFieldSet.delete(f);
        }
        allClearedPinFields.push(...result.clearedPinFields);
      }

      // Clear invalidated values from effective classification.
      // This mutates `output` so subsequent parents in the loop see
      // the cleared state (correct: later parents validate against
      // already-cleared descendants).
      const clearedClassification = { ...output.classification };
      for (const cleared of result.clearedFields) {
        clearedClassification[cleared.field] = '';
      }
      output = { ...output, classification: clearedClassification };

      allCleared.push(...result.clearedFields);

      // Record per-parent invalidation event (one event per parent change
      // for audit clarity; the merged result is used for question building).
      const priorResult = session.classification_results?.find(
        (r) => r.issue_id === issue.issue_id,
      );
      const priorEffectiveValue =
        priorResult?.classifierOutput.classification[parentField] ??
        priorPinsForTarget[parentField] ??
        classifierRawClassification[parentField] ??
        '';
      await deps.eventRepo.insert({
        event_id: deps.idGenerator(),
        event_type: 'classification_descendant_invalidation',
        conversation_id: session.conversation_id,
        issue_id: issue.issue_id,
        payload: {
          parent_field: parentField,
          parent_old_value: priorEffectiveValue,
          parent_new_value: newValue,
          cleared_fields: result.clearedFields,
        },
        created_at: deps.clock(),
      });
    }
  }

  // Build merged invalidation result for follow-up generation.
  // Deduplicate by field name (a field can only appear once in the
  // hierarchy, but two parent changes could theoretically touch it
  // if one parent is an ancestor of the other).
  if (allCleared.length > 0) {
    const seenFields = new Set<string>();
    const deduped = allCleared.filter((c) => {
      if (seenFields.has(c.field)) return false;
      seenFields.add(c.field);
      return true;
    });
    const mergedPinFields = [...new Set(allClearedPinFields)];
    const earliestPin = deduped.find((c) => c.wasPinned) ?? null;

    invalidationResults.set(issue.issue_id, {
      clearedFields: deduped,
      clearedPinFields: mergedPinFields,
      earliestClearedPin: earliestPin,
    });
  }
}
```

### Task 5.5: Integrate hierarchy-conflict questions into follow-up generation (caps-aligned)

The original draft placed the contradiction question after the caps check but did not route it through cap enforcement. This created two bugs: (a) a maxed-out field could be asked via the contradiction path, and (b) in multi-issue conversations the contradiction question could attach to the wrong issue.

**Fix:** The contradiction question must target the same issue selected for follow-up generation (`targetResult.issue_id`, line 616 — the first issue with `fieldsNeedingInput.length > 0`), and its field must pass the caps eligibility filter.

Insert between the caps check (~line 586) and the follow-up generator call (~line 635):

```typescript
// Scope eligible fields to the target issue.
// capsCheck.eligibleFields is conversation-wide (flatMap across all issues).
// The FollowUpGenerator receives a single issue's classification, so feeding
// it fields from other issues would produce nonsensical questions.
// Intersect with targetResult.fieldsNeedingInput to restrict to the target issue.
const targetScopedFields = capsCheck.eligibleFields.filter((f) =>
  targetResult.fieldsNeedingInput.includes(f),
);

// Build contradiction question if invalidation cleared a stale pin for
// the issue we're about to generate follow-ups for.
const targetInvalidation = invalidationResults.get(targetResult.issue_id) ?? null;
let conflictQuestion: FollowUpQuestion | null = null;
let adjustedBudget = capsCheck.remainingQuestionBudget;
let adjustedEligibleFields = [...targetScopedFields];

if (targetInvalidation?.earliestClearedPin) {
  const cleared = targetInvalidation.earliestClearedPin;

  // The contradiction question's field_target MUST be in the scoped eligible set.
  // If it's maxed on re-asks, the field is ineligible and the normal escape
  // hatch will handle it — no contradiction question generated.
  const fieldIsEligible = adjustedEligibleFields.includes(cleared.field);

  if (fieldIsEligible) {
    // Find the parent that triggered this invalidation
    const triggerParent = changedParentFields.find((p) => {
      const descendants = getForwardDescendants(p.field);
      return descendants.includes(cleared.field);
    });

    if (triggerParent) {
      conflictQuestion = buildHierarchyConflictQuestion(
        cleared,
        triggerParent.field,
        triggerParent.newValue,
        targetResult.classifierOutput.classification,
        taxonomyConstraints,
        deps.idGenerator,
      );
    }

    if (conflictQuestion) {
      // Consume 1 from the budget so the LLM generator gets the correct remainder
      adjustedBudget = Math.max(0, adjustedBudget - 1);
      // Remove the field from eligible set so the LLM doesn't also ask about it
      adjustedEligibleFields = adjustedEligibleFields.filter((f) => f !== cleared.field);
    }
  }
}
```

Then modify the `followUpInput` construction to use `adjustedEligibleFields`:

```typescript
const followUpInput: FollowUpGeneratorInput = {
  // ... existing fields ...
  fields_needing_input: [...adjustedEligibleFields],
  // ... rest unchanged ...
};
```

**Note on existing handler behavior:** The current handler at line 623 passes `capsCheck.eligibleFields` (conversation-wide) into a single-issue `FollowUpGeneratorInput`. The `targetScopedFields` intersection above fixes this: `adjustedEligibleFields` is initialized from the intersection, and that value is what flows into `followUpInput.fields_needing_input` for both the contradiction path and the normal LLM generator call. This makes single-issue scoping explicit at the call site rather than relying on the downstream `selectFollowUpFrontierFields` filter.

And pass `adjustedBudget` to the generator:

```typescript
const followUpResult = await callFollowUpGenerator(
  followUpInput,
  deps.followUpGenerator,
  adjustedBudget, // reduced by 1 if contradiction question consumed a slot
  deps.metricsRecorder,
  obsCtx,
);
```

After receiving the LLM-generated questions, combine them:

```typescript
if (followUpResult.status === 'ok') {
  const llmQuestions = followUpResult.output!.questions;
  // Prepend contradiction question, then LLM questions
  nextQuestions = conflictQuestion ? [conflictQuestion, ...llmQuestions] : llmQuestions;
}
```

If `adjustedBudget === 0` (contradiction question consumed the entire budget), skip the LLM call and use the contradiction question alone:

```typescript
if (adjustedBudget === 0 && conflictQuestion) {
  nextQuestions = [conflictQuestion];
} else {
  // ... existing LLM call with adjustedBudget ...
}
```

**Edge case: contradiction question's field not in `fieldsNeedingInput`.**
After invalidation, the cleared field's value is `''`. In the confidence computation (Step D), a blank field gets low completeness → low confidence → enters `fieldsNeedingInput`. So by the time we reach follow-up generation, the invalidated field SHOULD be in `fieldsNeedingInput` and therefore in `capsCheck.eligibleFields` (unless maxed). No special handling needed.

---

## Step 6 — Update Barrel Exports

**File:** `packages/core/src/classifier/index.ts`

Add:

```typescript
export {
  invalidateStaleDescendants,
  getForwardDescendants,
  type InvalidationResult,
  type ClearedField,
} from './descendant-invalidation.js';
```

**File:** `packages/core/src/followup/index.ts`

Add:

```typescript
export { buildHierarchyConflictQuestion } from './hierarchy-conflict-questions.js';
```

---

## Step 7 — Unit Tests: Descendant Invalidation

**File:** `packages/core/src/__tests__/classifier/descendant-invalidation.test.ts` (new)

```
describe('invalidateStaleDescendants', () => {

  it('clears Maintenance_Object when Sub_Location changes to an incompatible value')
    // classification: Sub_Location=kitchen, Maintenance_Category=plumbing,
    //   Maintenance_Object=toilet, Maintenance_Problem=leak
    // pins: { Maintenance_Object: 'toilet' }
    // changedParent: Sub_Location
    // toilet is valid for plumbing, so Maintenance_Object is NOT cleared
    // (Sub_Location→Maintenance_Category is the direct edge, not Sub_Location→Object)
    // BUT: if Maintenance_Category becomes invalid first...

  it('cascades: clearing Maintenance_Category also clears Object and Problem')
    // classification: Sub_Location=kitchen, Maintenance_Category=pest_control,
    //   Maintenance_Object=rodent, Maintenance_Problem=infestation
    // Change Sub_Location from kitchen to parking_garage
    // pest_control is not valid for parking_garage → clear Category
    // Since Category cleared, Object and Problem clear unconditionally
    // Assert: 3 cleared fields in order

  it('does not clear valid descendants')
    // classification: Sub_Location=kitchen, Maintenance_Category=plumbing,
    //   Maintenance_Object=faucet
    // Change Location from suite to suite (same value — no-op detected upstream)
    // OR: Change Sub_Location from bathroom to kitchen, plumbing is still valid
    // Assert: Maintenance_Category NOT cleared (plumbing valid for kitchen)

  it('attributes wasPinned correctly: pinned vs unpinned')
    // pins: { Maintenance_Category: 'pest_control' }
    // classifier/implied: Maintenance_Object = 'rodent', Maintenance_Problem = 'infestation'
    // Clear all three
    // Assert: Maintenance_Category.wasPinned === true
    // Assert: Maintenance_Object.wasPinned === false
    // Assert: Maintenance_Problem.wasPinned === false

  it('returns earliestClearedPin as the first pin in hierarchy order')
    // pins: { Maintenance_Category: 'X', Maintenance_Object: 'Y' }
    // Both cleared
    // Assert: earliestClearedPin.field === 'Maintenance_Category'

  it('returns null earliestClearedPin when only classifier guesses are cleared')
    // No pins, only classifier values
    // Assert: earliestClearedPin === null

  it('handles empty descendants (changedParent is Maintenance_Problem)')
    // Maintenance_Problem has no descendants
    // Assert: clearedFields is empty

  it('skips vague/unresolved descendants without clearing')
    // Maintenance_Object = 'general' (vague)
    // Assert: NOT in clearedFields

  it('full cascade from Location change clears 4 descendants')
    // Change Location, all descendants are invalid
    // Assert: Sub_Location, Maintenance_Category, Maintenance_Object,
    //   Maintenance_Problem all cleared

end
```

---

## Step 8 — Unit Tests: Hierarchy-Conflict Questions

**File:** `packages/core/src/__tests__/followup/hierarchy-conflict-questions.test.ts` (new)

```
describe('buildHierarchyConflictQuestion', () => {

  it('builds contradiction prompt for a cleared pin')
    // cleared: { field: 'Maintenance_Object', oldValue: 'toilet', source: 'pinned' }
    // parentField: 'Sub_Location', parentValue: 'kitchen'
    // Assert: prompt contains "toilet" and "kitchen"
    // Assert: options are constraint-valid objects for the current classification
    // Assert: answer_type === 'enum'

  it('returns null for unpinned source')
    // wasPinned: false (classifier guess or prior implied)
    // Assert: returns null

  it('returns null when no valid options exist')
    // resolveValidOptions returns empty array
    // Assert: returns null

  it('caps options at 10')
    // A field with > 10 valid options
    // Assert: options.length <= 10

  it('uses human-readable labels in prompt text')
    // Maintenance_Object → "specific fixture or item"
    // toilet → "toilet" (underscores replaced with spaces)

end
```

---

## Step 9 — Integration Tests: Stale Pin Invalidation in Handler

**File:** `packages/core/src/__tests__/followup/bug-009-stale-pin-invalidation.test.ts` (new)

Follow the same test pattern as `bug-009-answer-pinning.test.ts`:

- Build session with prior pins and classification results
- Wire stub classifier and follow-up generator
- Call `handleAnswerFollowups(ctx)` with answers that change a parent field
- Assert on session state, events, and returned questions

```
describe('Bug-009 Phase 3: stale descendant invalidation', () => {

  // --- Core invalidation ---

  it('clears stale pinned Maintenance_Object when tenant re-confirms Sub_Location')
    // Prior pins: { Sub_Location: 'bathroom', Maintenance_Object: 'toilet' }
    // This round: tenant answers Sub_Location = 'kitchen'
    // Classifier returns the old values
    // Assert: Maintenance_Object removed from confirmed_followup_answers
    // Assert: Maintenance_Problem also cleared from classification
    // Assert: invalidation event logged with parent=Sub_Location, cleared=[Object, Problem]

  it('clears stale classifier guess without removing pins')
    // Prior pins: { Sub_Location: 'bathroom' }
    // Classifier guesses Maintenance_Object = 'toilet'
    // This round: tenant re-confirms Sub_Location = 'kitchen'
    // Assert: Maintenance_Object cleared from classification (was classifier guess)
    // Assert: no pin removal (toilet was never pinned)
    // Assert: Maintenance_Object re-enters fieldsNeedingInput

  it('produces contradiction prompt for cleared pin, neutral re-ask for cleared unpinned value')
    // Prior pins: { Maintenance_Category: 'pest_control' }
    // Classifier guess (unpinned): Maintenance_Object: 'rodent'
    // This round: Sub_Location changes → pest_control invalid → cascade
    // Assert: first pending question targets Maintenance_Category with contradiction wording
    // Assert: Maintenance_Object has no contradiction prompt (wasPinned=false)
    // Assert: Maintenance_Object re-enters fieldsNeedingInput via normal pipeline

  it('silently clears unpinned descendants — prior implied values may re-derive')
    // Prior: Maintenance_Problem was unpinned (classifier or constraint-implied)
    // Parent changes → Problem is now invalid
    // Assert: Problem cleared from effective classification
    // Assert: no contradiction question generated for Problem
    // Assert: if new ancestry still narrows to one option, Step C' re-derives it

  // --- Cascade ---

  it('multi-level cascade: Location change clears Sub_Location through Problem')
    // Prior pins: { Location: 'suite', Sub_Location: 'bathroom',
    //   Maintenance_Category: 'plumbing', Maintenance_Object: 'toilet' }
    // This round: Location = 'building_exterior'
    // Assert: all 4 descendants cleared
    // Assert: 4 entries in invalidation event cleared_fields

  // --- Caps behavior ---

  it('invalidated field uses existing previous_questions count')
    // Maintenance_Object was asked 2 times already (previous_questions)
    // Gets invalidated and needs re-ask
    // Assert: previous_questions still shows 2 for Maintenance_Object
    // Assert: conflict question increments to 3

  it('maxed invalidated pin field does NOT get a contradiction question')
    // Maintenance_Object was asked max times (e.g., 3) in previous_questions
    // Gets invalidated (wasPinned=true)
    // Assert: capsCheck.eligibleFields does NOT include Maintenance_Object
    // Assert: no contradiction question generated
    // Assert: if all remaining fields are maxed, routes to confirmation with caps_exhausted

  it('contradiction question consumes budget — LLM generator gets reduced remainder')
    // Budget is 3. Invalidation produces a contradiction question.
    // Assert: LLM generator called with remainingBudget=2
    // Assert: final question list = [contradiction question] + [up to 2 LLM questions]

  it('contradiction question field removed from eligibleFields before LLM call')
    // Invalidation clears Maintenance_Category (pinned)
    // Assert: followUpInput.fields_needing_input does NOT include Maintenance_Category
    // Assert: LLM does not also generate a question for Maintenance_Category

  // --- Re-pinning stability ---

  it('re-pinning same value after invalidation stabilizes without looping')
    // Round N: Maintenance_Object = toilet, invalidated because Sub_Location changed
    // Round N+1: contradiction question asked, tenant re-answers toilet
    //   (Sub_Location was corrected back, so toilet is now valid again)
    // Assert: toilet is re-pinned
    // Assert: no further invalidation (parent didn't change)
    // Assert: flow continues to next field

  // --- Edge cases ---

  it('no invalidation when parent value does not actually change')
    // Tenant answers Sub_Location = 'bathroom' but it was already 'bathroom'
    // Assert: no invalidation triggered
    // Assert: no invalidation event logged

  it('no invalidation when changed parent has no descendants')
    // Tenant re-confirms Maintenance_Problem (leaf field)
    // Assert: no invalidation (no descendants)

  it('invalidation does not affect other issues')
    // Multi-issue conversation: invalidation for issue-1 does not touch issue-2 pins
    // Assert: issue-2 confirmed_followup_answers unchanged

  // --- Multi-parent accumulation ---

  it('accumulates cleared fields when two parents change in one round')
    // Tenant answers both Location = 'building_exterior' and Sub_Location = 'parking_garage'
    // Prior pins: { Location: 'suite', Sub_Location: 'bathroom',
    //   Maintenance_Category: 'plumbing', Maintenance_Object: 'toilet' }
    // First parent (Location): clears Sub_Location (but it gets re-pinned to parking_garage),
    //   Maintenance_Category, Maintenance_Object, Maintenance_Problem
    // Second parent (Sub_Location): validates against already-cleared descendants
    // Assert: merged result contains all cleared fields from both passes
    // Assert: earliestClearedPin is the true earliest across both passes
    // Assert: two separate invalidation events (one per parent change)

  // --- Targeting alignment ---

  it('eligible fields scoped to target issue, not conversation-wide')
    // Multi-issue: issue-1 needs [Maintenance_Object], issue-2 needs [Management_Category]
    // Invalidation targets issue-1
    // Assert: followUpInput.fields_needing_input does NOT include Management_Category
    // Assert: only issue-1's fields reach the LLM generator

  it('contradiction question targets targetResult.issue_id, not targetIssueId')
    // Multi-issue: targetIssueId (answers received) = issue-1
    //   targetResult.issue_id (first with fieldsNeedingInput) = issue-1 (same in practice)
    // Assert: contradiction question's issue context matches targetResult
    // Assert: invalidation event is for issue-1

  // --- Audit trail ---

  it('invalidation event parent_old_value uses prior stored classification')
    // Prior round stored classification_results with Sub_Location = 'bathroom'
    // This round: classifier returns Sub_Location = 'kitchen' (different from stored)
    // Tenant pins Sub_Location = 'kitchen'
    // Assert: invalidation event parent_old_value = 'bathroom' (from session.classification_results)
    //   NOT 'kitchen' (from current round's raw classifier output)

end
```

---

## Step 10 — Run Full Test Suite

```bash
pnpm test
pnpm typecheck
pnpm lint
```

**Expected impact on existing tests:**

- Tests that construct `ActionHandlerContext` for `answer-followups` will need `resolveConstraintImpliedFields` to be available via the existing import (already imported).
- The new `classifierRawClassification` capture and `invalidationResults` map are additive — existing control flow is unchanged when `changedParentFields` is empty.
- Tests in `bug-009-answer-pinning.test.ts` should pass because they don't change parent values across rounds (no invalidation triggered).
- Tests in `bug-009-followup-ordering.test.ts` should pass because they use `handleStartClassification` (no prior pins).

---

## Step 11 — Update Trackers

### Task 11.1: Update `docs/bug-tracker.md`

Update the BUG-009 row:

- **Status:** `IN PROGRESS`
- **Fix:** Phase 1 (ordering) + Phase 2 (pinning) + Phase 3 (stale descendant invalidation)
- **Evidence:** Tests in `bug-009-stale-pin-invalidation.test.ts`, `descendant-invalidation.test.ts`, `hierarchy-conflict-questions.test.ts`

### Task 11.2: Update `docs/spec-gap-tracker.md`

Check for rows related to:

- Follow-up constraint enforcement
- Hierarchy validation
- Answer handling / pinning

Update evidence and status as appropriate.

### Task 11.3: Update Phase 2 plan doc

**File:** `docs/plans/2026-03-30-bug-009-phase2-answer-pinning.md`

Add a note:

```markdown
> Phase 3 (stale descendant invalidation) addresses the case where pinned
> answers become invalid after a parent re-confirmation. Tracked in
> `2026-03-30-bug-009-phase3-stale-descendant-invalidation.md`.
```

---

## Risk Assessment

| Risk                                                        | Likelihood | Mitigation                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalidation fires when it shouldn't (false positive)       | Low        | `resolveValidOptions` is well-tested; invalidation only triggers when a NEW pin differs from prior value. Step 5.2 compares explicitly.                                                                                                                                                           |
| Cascade clears too aggressively                             | Medium     | The `parentJustCleared` flag ensures only _direct_ descendants of a cleared field are force-cleared. Valid intermediates stop the cascade. Unit tests cover this (Step 7).                                                                                                                        |
| Contradiction prompt wording confuses tenants               | Low        | Only fires for stale pins (tenant explicitly answered before). The wording references their prior answer and explains why it changed.                                                                                                                                                             |
| Previous_questions count blocks re-ask of invalidated field | Low        | By design — invalidation doesn't reset caps. If maxed, the contradiction question is suppressed. Test in Step 9 covers this.                                                                                                                                                                      |
| Performance: extra `resolveValidOptions` calls per round    | Negligible | At most 4 descendant checks per changed parent, using in-memory constraint maps. No LLM calls.                                                                                                                                                                                                    |
| Conflict with Step C2 (post-overlay hierarchy check)        | Low        | Invalidation runs before C2. By the time C2 runs, stale descendants are already cleared. C2 catches remaining contradictions (e.g., cross-domain).                                                                                                                                                |
| DB event routing miss                                       | Eliminated | Step 2 explicitly adds the new event type to both the TypeScript union (`classification-event.ts`) and the runtime routing set (`CLASSIFICATION_EVENT_TYPES` in `pg-event-store.ts`).                                                                                                             |
| Source attribution for prior constraint-implied values      | Eliminated | Simplified to 2-way (pinned/unpinned). No prior-round provenance needed. Unpinned values that were previously constraint-implied will silently re-derive in Step C' if the new ancestry narrows to one option.                                                                                    |
| Contradiction question bypasses caps                        | Eliminated | Task 5.5 checks `capsCheck.eligibleFields` before building the contradiction question. The field is removed from the eligible set and the budget is decremented.                                                                                                                                  |
| Cross-issue field leakage in follow-up generation           | Eliminated | Task 5.5 intersects `capsCheck.eligibleFields` with `targetResult.fieldsNeedingInput` into `targetScopedFields`, which initializes `adjustedEligibleFields`. This scoped value flows into `followUpInput.fields_needing_input` for both the contradiction path and the normal LLM generator call. |
| Multi-parent invalidation overwrites earlier results        | Eliminated | Task 5.4 accumulates `allCleared` across the parent loop and builds a merged `InvalidationResult` with deduplication.                                                                                                                                                                             |
| parent_old_value audit accuracy                             | Improved   | Task 5.4 reads from `session.classification_results` (prior round's stored effective classification) first, falling back to raw classifier output and then empty string.                                                                                                                          |

## Scope Boundaries

**In scope:**

- Descendant invalidation after parent re-confirmation
- Pin removal for invalidated descendants
- Source-aware follow-up behavior (contradiction prompt for stale pins only)
- Invalidation event logging
- Cap-aware re-ask (no budget reset)
- Unit + integration tests

**Out of scope:**

- Changes to `start-classification.ts` (no prior pins at initial classification)
- Object-before-category hierarchy change (Phase 4)
- Prompt version bump (Phase 4)
- EDIT_ISSUE unpin mechanism
- Changes to confirmation panel or payload builder
- Changes to the state machine or transition matrix
