# Implementation Plan: Bug-009 Phase 4 — Object-First Maintenance Enhancement

> **Status:** Outline only — do not start until Phase 3 is stable.
> **Prereqs:** Phase 3 (stale descendant invalidation) must be implemented and verified.

**Date:** 2026-03-30
**Type:** Enhancement (not a bug fix)
**Applies to:** New conversations only (prompt-version bump)

## Summary

Change the maintenance follow-up ordering from category-first to object-first:

**Current:** `Location → Sub_Location → Maintenance_Category → Maintenance_Object → Maintenance_Problem`

**Proposed:** `Location → Sub_Location → Maintenance_Object → Maintenance_Problem`

`Maintenance_Category` becomes a derived field — resolved deterministically from the confirmed object when unambiguous, deferred as a follow-up only when the object maps to multiple categories.

## Motivation

Tenants think in concrete terms: "the toilet is leaking", not "I have a plumbing issue with a toilet." Asking about the category before the object forces an abstraction that most tenants find unnatural. Object-first ordering better matches how tenants describe problems.

## Design Decisions

### 2-Hop Traversal (Not Schema Change)

Phase 4 v1 does NOT add a `Sub_Location_to_Maintenance_Object` constraint map. Instead, it computes valid objects through the existing maps:

```
validCategories = Sub_Location_to_Maintenance_Category[sub_location]
validObjects = union(Maintenance_Category_to_Maintenance_Object[cat] for cat in validCategories)
```

This avoids a second source of truth and keeps the constraint schema stable.

### Category Derivation

After `Maintenance_Object` is confirmed:

1. Compute `objectToCategories`: for each category in `Maintenance_Category_to_Maintenance_Object`, check if the confirmed object is in that category's list. Collect all matching categories.
2. Intersect with `validCategories` (from Sub_Location constraint).
3. If exactly 1 category remains → derive it deterministically (constraint-implied).
4. If multiple categories remain → `Maintenance_Category` stays in `fieldsNeedingInput` and is asked as a follow-up after the object.
5. If zero categories remain → flag as contradiction (should not happen if object was constrained correctly).

### Prompt Version Bump

- Bump `PROMPT_VERSION` so the new ordering only applies to **new conversations**.
- Existing conversations keep their pinned prompt version and the category-first ordering.
- The classifier prompt is updated to treat object/location consistency as validation, not inference.

## Files to Modify

| File                                    | Change                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `followup/field-ordering.ts`            | Change `MAINTENANCE_HIERARCHY_FIELDS` to `[Location, Sub_Location, Maintenance_Object, Maintenance_Problem]`. Add `Maintenance_Category` to a separate "deferred" set. Gate `Maintenance_Category` on `Maintenance_Object` resolution instead of the reverse. |
| `classifier/constraint-resolver.ts`     | Add `computeObjectCandidates(subLocation, constraints)` 2-hop traversal helper. Add `deriveCategory(object, subLocation, constraints)` reverse lookup.                                                                                                        |
| `followup/followup-generator.ts`        | When prompt version >= Phase 4, use the new hierarchy for frontier selection.                                                                                                                                                                                 |
| `llm/prompts/followup-prompt.ts`        | Update dependency-order guidance for new prompt version.                                                                                                                                                                                                      |
| `llm/prompts/classifier-prompt.ts`      | Add guidance: object/location consistency is validation, not inference of earlier fields.                                                                                                                                                                     |
| `classifier/confidence.ts`              | When `Maintenance_Category` is derived, set confidence to 1.0 (same as constraint-implied).                                                                                                                                                                   |
| `schemas/src/constants.ts` (or similar) | Bump `PROMPT_VERSION`.                                                                                                                                                                                                                                        |
| `followup/field-ordering.ts`            | Version-gate: old prompt version → old hierarchy; new → new hierarchy.                                                                                                                                                                                        |

## Test Plan

| Scenario                                                        | Assertion                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `suite → kitchen` asks `Maintenance_Object` next (not Category) | First follow-up after Sub_Location targets Maintenance_Object                |
| Object candidate set narrowed by location/sub-location          | Options for Maintenance_Object are the 2-hop union, not the full taxonomy    |
| Unambiguous object→category derives Category                    | `faucet` under `kitchen` → `plumbing` derived automatically                  |
| Ambiguous object→category asks Category after Object            | Object that maps to 2+ categories → Category appears in fieldsNeedingInput   |
| No reverse constraint auto-fills earlier hierarchy fields       | Confirming `toilet` does NOT auto-fill `Sub_Location=bathroom` during intake |
| Existing conversations use old hierarchy                        | Session with old prompt_version still asks Category before Object            |
| Confirmation payload shows derived Category                     | Category value present in confirmation even though tenant wasn't asked       |

## Risks

| Risk                                                      | Mitigation                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 2-hop traversal returns too many objects (noisy question) | Cap options at 10 (existing behavior). If > 10, use LLM ranking with constraint hints.                        |
| Category derivation ambiguity is common                   | Analyze taxonomy: most objects map to 1 category. Only `other_*` values map to multiple. Acceptable fallback. |
| Prompt version gating adds complexity                     | Single version check in field-ordering.ts. Clean separation.                                                  |
| Phase 3 invalidation logic assumes current hierarchy      | Phase 3's `MAINTENANCE_FORWARD_CHAIN` must be version-aware. Add this when implementing Phase 4.              |

## Scope Boundaries

**In scope:** Object-first ordering, 2-hop traversal, category derivation, prompt version bump, version-gated field ordering, updated classifier prompt guidance, new conversation only.

**Out of scope:** Schema changes to `taxonomy_constraints.json`, changes to the state machine, changes to the confirmation panel, changes to existing conversation behavior.
