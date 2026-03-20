# BUG-001 Fix: No Heat Follow-Up Questions

**Date**: 2026-03-19
**Bug**: BUG-001 — No-heat follow-ups ask for maintenance confirmation and miss whole-unit coverage options
**Severity**: P2 (systemic)
**Tracker**: `docs/bug-tracker.md` row BUG-001

---

## Root Cause (validated against code)

Three layers fail together:

1. **Category cue gap** — `classification_cues.json` → `Category.maintenance` keywords are `[leak, broken, repair, not working, clog]`. No HVAC terms. For "no heat" text, `cue_strength` = 0.0. Confidence formula: `0.40*0 + 0.25*completeness + 0.20*model_hint` maxes at ~0.44 — below the 0.65 `medium_threshold`. Result: Category gets pushed into follow-up even though no-heat is unambiguously maintenance.

2. **Sub_Location cue gap** — `Sub_Location.general` keywords are `[apartment, unit, suite, my place]`. No heat/cold/freezing terms. For "I haven't had heat in over a week", no cue boost. Result: Sub_Location confidence also too low, but the real problem is that when Claude generates Sub_Location follow-up options, it picks room-specific values and omits `general` — even though `resolveValidOptions` includes `general` in the constraint-valid set.

3. **Follow-up option gap** — The follow-up prompt (Rule 13) tells Claude to use only constraint-valid options. `general` is valid, but the prompt doesn't instruct Claude to surface it as a whole-unit option for HVAC issues. Claude picks kitchen/bathroom/bedroom — room-specific options that don't match how tenants experience heating failures.

**Bonus (P3 cosmetic)**: `followup-form.tsx` renders raw taxonomy slugs (`common_living_dining`) instead of display labels ("Living / Dining Room").

**Gold evidence**: `gold-016` and `gold-019` expect Category=maintenance, Sub_Location=general, **zero followup fields**, contradicting current runtime behavior.

---

## Design Decisions

1. **Cue additions are additive** — add keywords to existing cue entries, don't restructure the cue format. This is the lowest-risk change.

2. **Follow-up prompt gets a `general` hint** — add a rule telling Claude to include `general` (labeled "Entire apartment") when generating Sub_Location options for HVAC/heating issues, rather than restructuring the constraint resolver.

3. **Display labels live in schemas** — create `packages/schemas/taxonomy-labels.json` with `slug → human-readable` mappings, exported via the schemas barrel. This keeps the label source next to the taxonomy source.

4. **No multi-select** — per the bug note's own guidance: the answer contract is `string | boolean`, the UI is radio buttons, and the handler casts to `string | boolean`. Adding "Entire Apartment" and "Multiple Rooms" as single enum values fits the architecture. True multi-select does not.

5. **Regression cases before VERIFIED** — per `bug-management.md`, P2 regression coverage is recommended. Since the gold examples already define expected behavior, adding regression cases is low-effort and high-value.

---

## Batch 1: Cue Coverage Fix

> **Purpose**: Make Category and Sub_Location confidence clear the follow-up threshold for HVAC/no-heat text.

### Task 1.1: Add HVAC keywords to Category.maintenance cues

**File**: `packages/schemas/classification_cues.json`

Add heat-related keywords to the `Category.maintenance` entry:

```json
"Category": {
  "maintenance": {
    "keywords": ["leak", "broken", "repair", "not working", "clog", "heat", "no heat", "cold", "freezing", "heater", "hvac", "radiator", "thermostat", "ac", "air conditioning"],
    "regex": []
  },
```

These keywords already exist under `Maintenance_Category.hvac` — adding them to Category.maintenance creates the cross-field cue signal needed to boost Category confidence above 0.65.

**Acceptance**: For text "I haven't had heat in over a week", `computeCueStrengthForField("...", "Category", cues)` returns `score > 0` with `topLabel === "maintenance"`.

---

### Task 1.2: Add heat keywords to Sub_Location.general cues

**File**: `packages/schemas/classification_cues.json`

Add whole-unit/heating keywords to the `Sub_Location.general` entry:

```json
"Sub_Location": {
  ...
  "general": {
    "keywords": ["apartment", "unit", "suite", "my place", "no heat", "heat", "cold", "freezing", "whole", "everywhere", "entire"],
    "regex": []
  }
}
```

This ensures that no-heat messages without room-specific mentions get boosted toward `general` rather than having zero cue signal.

**Acceptance**: For text "no heat in my apartment", `computeCueStrengthForField("...", "Sub_Location", cues)` returns `topLabel === "general"` with `score > 0`.

---

### Task 1.3: Add cue-scoring tests for new keywords

**File**: `packages/core/src/__tests__/classifier/cue-scoring.test.ts`

Add tests using the real cue dictionary (pattern from existing line ~284):

1. "I haven't had heat in over a week" → Category topLabel = "maintenance", score > 0
2. "no heat in my apartment" → Sub_Location topLabel = "general", score > 0
3. "The heater is not working" → Category topLabel = "maintenance", score > 0
4. "It's freezing in my unit" → Category topLabel = "maintenance", score > 0
5. Verify existing plumbing/electrical cues still produce same results (no regression)

**Acceptance**: `pnpm --filter @wo-agent/core exec vitest run src/__tests__/classifier/cue-scoring.test.ts` passes with new tests.

---

### Task 1.4: Validate confidence computation for no-heat

**File**: `packages/core/src/__tests__/classifier/confidence.test.ts` (or new test file)

Add a test that computes confidence for a no-heat scenario with the new cue scores and verifies:

- Category confidence ≥ 0.65 (above medium_threshold) when model_confidence is reasonable (≥ 0.7)
- Sub_Location confidence gets a cue boost from "general" match

This verifies the cue fix actually resolves the confidence gap end-to-end.

**Acceptance**: Test passes showing Category confidence above follow-up threshold.

---

### Batch 1 Review Checkpoint

- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @wo-agent/core test` passes (including new cue tests)
- [ ] No-heat text produces Category cue score > 0
- [ ] No-heat text produces Sub_Location.general cue score > 0
- [ ] Existing cue tests still pass (no regression)

---

## Batch 2: Follow-Up Prompt + Taxonomy Fix

> **Purpose**: Ensure the follow-up UI can express whole-unit Sub_Location, and add tenant-friendly display labels.

### Task 2.1: Add whole-unit Sub_Location values to taxonomy

**File**: `packages/schemas/taxonomy.json`

Add two values to the Sub_Location array:

```json
"Sub_Location": [
  "kitchen",
  "bathroom",
  ...
  "general",
  "entire_unit",
  "multiple_rooms",
  "other_sub_location"
]
```

**File**: `packages/schemas/taxonomy_constraints.json`

Add both values under `suite` in `Location_to_Sub_Location`:

```json
"suite": [
  "kitchen", "bathroom", "common_living_dining", "bedroom",
  "closets", "keys_locks", "windows", "balcony", "ceiling",
  "general", "entire_unit", "multiple_rooms"
]
```

Add both values to `Sub_Location_to_Maintenance_Category` with the same broad set as `general`:

```json
"entire_unit": [
  "plumbing", "electrical", "hvac", "carpentry", "flooring",
  "drywall_plaster", "paint", "pest_control", "general_maintenance",
  "locksmith", "appliance", "roofing", "tile",
  "other_issue", "other_maintenance_category"
],
"multiple_rooms": [
  "plumbing", "electrical", "hvac", "carpentry", "flooring",
  "drywall_plaster", "paint", "pest_control", "general_maintenance",
  "locksmith", "appliance", "roofing", "tile",
  "other_issue", "other_maintenance_category"
]
```

Add both to `Maintenance_Object_to_Sub_Location` for relevant objects (radiator, thermostat, etc.):

```json
"radiator": ["kitchen", "bathroom", ..., "entire_unit", "multiple_rooms"],
"thermostat": ["common_living_dining", "hallways_stairwells", "mechanical_room", "entire_unit", "multiple_rooms"]
```

Also add `entire_unit` and `multiple_rooms` to the `SKIP_VALUES` set in `packages/schemas/src/validators/taxonomy-cross-validator.ts` — they should be treated like `general` for hierarchy validation (skippable, not strict parent→child check).

**Acceptance**: `validateHierarchicalConstraints()` returns `valid: true` for a classification with `Sub_Location: "entire_unit"`. Taxonomy tests pass.

---

### Task 2.2: Update follow-up prompt to surface whole-unit options

**File**: `packages/core/src/llm/prompts/followup-prompt.ts`

Add a rule (after existing Rule 12):

```
Rule 14: When generating Sub_Location options for HVAC or heating issues,
always include "entire_unit" (labeled "Entire apartment") and
"multiple_rooms" (labeled "Multiple rooms") alongside room-specific options.
Heating problems frequently affect the whole unit, not just one room.
```

This ensures Claude includes whole-unit options in the question rather than only listing individual rooms.

**Acceptance**: When the follow-up generator is called for a no-heat issue with Sub_Location needing input, the returned options include `entire_unit` or `multiple_rooms`.

---

### Task 2.3: Create taxonomy display labels

**File**: `packages/schemas/taxonomy-labels.json` (new)

Create a JSON mapping from taxonomy slugs to tenant-facing display labels:

```json
{
  "version": "1.0.0",
  "labels": {
    "Category": {
      "maintenance": "Maintenance",
      "management": "Management",
      "other_category": "Other"
    },
    "Location": {
      "suite": "Your unit",
      "building_interior": "Building interior",
      "building_exterior": "Building exterior"
    },
    "Sub_Location": {
      "kitchen": "Kitchen",
      "bathroom": "Bathroom",
      "common_living_dining": "Living / Dining Room",
      "bedroom": "Bedroom",
      "closets": "Closets",
      "keys_locks": "Keys / Locks",
      "windows": "Windows",
      "balcony": "Balcony",
      "ceiling": "Ceiling",
      "general": "General area",
      "entire_unit": "Entire apartment",
      "multiple_rooms": "Multiple rooms",
      "entrance_lobby": "Entrance / Lobby",
      "hallways_stairwells": "Hallway / Stairwell",
      "elevator": "Elevator",
      "laundry": "Laundry room",
      "parking_garage": "Parking garage",
      "other_sub_location": "Other area"
    },
    "Maintenance_Category": {
      "plumbing": "Plumbing",
      "electrical": "Electrical",
      "hvac": "Heating / Cooling",
      "carpentry": "Carpentry",
      "flooring": "Flooring",
      "pest_control": "Pest control",
      "general_maintenance": "General maintenance",
      "appliance": "Appliance",
      "locksmith": "Locksmith",
      "not_applicable": "N/A"
    },
    "Priority": {
      "low": "Low",
      "normal": "Normal",
      "high": "High",
      "emergency": "Emergency"
    }
  }
}
```

Cover the most commonly surfaced values. Missing entries fall back to the raw slug.

**File**: `packages/schemas/src/taxonomy-labels.ts` (new)

Export a loader and lookup function:

```typescript
export function getTaxonomyLabel(field: string, slug: string): string;
```

Returns the display label if it exists, otherwise returns the slug with underscores replaced by spaces and first letter capitalized.

Add to the schemas barrel export (`packages/schemas/src/index.ts`).

**Acceptance**: `getTaxonomyLabel("Sub_Location", "common_living_dining")` returns `"Living / Dining Room"`. Unknown slugs return a formatted fallback.

---

### Task 2.4: Update followup-form.tsx to use display labels

**File**: `apps/web/src/components/followup-form.tsx`

Import `getTaxonomyLabel` from `@wo-agent/schemas` and use it when rendering option labels:

```tsx
// Before:
{option}

// After:
{getTaxonomyLabel(q.field_target, option)}
```

Also update `confirmation-panel.tsx` to use display labels for classification values shown in the confirmation view.

**Acceptance**: Follow-up options render as "Kitchen", "Bathroom", "Living / Dining Room" instead of raw slugs. Confirmation panel labels are human-readable.

---

### Batch 2 Review Checkpoint

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes across all packages
- [ ] `entire_unit` and `multiple_rooms` are valid taxonomy values
- [ ] Constraint validation accepts them
- [ ] `getTaxonomyLabel()` works for all commonly surfaced values
- [ ] Followup form renders display labels
- [ ] Confirmation panel renders display labels

---

## Batch 3: Regression Coverage + CI

> **Purpose**: Add regression eval cases and run full CI.

### Task 3.1: Add no-heat regression eval cases

**File**: `packages/evals/datasets/regression/examples.jsonl`

Append 2 regression cases based on gold-016 and gold-019:

```jsonl
{"example_id":"reg-021","dataset_type":"regression","source_type":"bug","conversation_text":"The heater is not working. It's freezing in my unit and the radiator is cold to the touch.","split_issues_expected":[{"issue_text":"The heater is not working. It's freezing in my unit and the radiator is cold to the touch."}],"expected_classification_by_issue":[{"Category":"maintenance","Location":"suite","Sub_Location":"general","Maintenance_Category":"hvac","Maintenance_Object":"radiator","Maintenance_Problem":"no_heat","Priority":"high"}],"expected_missing_fields":[],"expected_followup_fields":[],"expected_needs_human_triage":false,"expected_risk_flags":[],"slice_tags":["hvac","no_heat","regression","BUG-001"],"taxonomy_version":"2.0.0","schema_version":"1.0.0","review_status":"approved_for_gate","reviewed_by":"human-reviewer-1","created_at":"2026-03-19T00:00:00Z"}
{"example_id":"reg-022","dataset_type":"regression","source_type":"bug","conversation_text":"There is no heat at all in my apartment. The thermostat says it's on but nothing is happening.","split_issues_expected":[{"issue_text":"There is no heat at all in my apartment. The thermostat says it's on but nothing is happening."}],"expected_classification_by_issue":[{"Category":"maintenance","Location":"suite","Sub_Location":"general","Maintenance_Category":"hvac","Maintenance_Object":"thermostat","Maintenance_Problem":"no_heat","Priority":"high"}],"expected_missing_fields":[],"expected_followup_fields":[],"expected_needs_human_triage":false,"expected_risk_flags":[],"slice_tags":["hvac","no_heat","regression","BUG-001"],"taxonomy_version":"2.0.0","schema_version":"1.0.0","review_status":"approved_for_gate","reviewed_by":"human-reviewer-1","created_at":"2026-03-19T00:00:00Z"}
```

**File**: `packages/evals/datasets/regression/manifest.json`

Update count from 20 to 22 and add entries for reg-021 and reg-022.

**Acceptance**: Manifest count matches actual JSONL line count. `pnpm --filter @wo-agent/evals test` passes.

---

### Task 3.2: Run full CI suite

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @wo-agent/web build
```

**Acceptance**: All 4 pass with 0 errors.

---

### Task 3.3: Update bug tracker

**File**: `docs/bug-tracker.md`

Update BUG-001 row:
- Status: `FIXED`
- Maps To: `packages/schemas/classification_cues.json; packages/schemas/taxonomy.json; packages/schemas/taxonomy-labels.json; packages/core/src/llm/prompts/followup-prompt.ts; packages/evals/datasets/regression/examples.jsonl`
- Last Reviewed: `2026-03-19`

Update dashboard counts.

**Acceptance**: Tracker row reflects completed state.

---

### Batch 3 Review Checkpoint

- [ ] 2 regression cases added with BUG-001 slice tag
- [ ] Manifest count matches
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` all pass
- [ ] Tracker updated to FIXED

---

## Files Created/Modified Summary

### New Files (2)
| File | Purpose |
|---|---|
| `packages/schemas/taxonomy-labels.json` | Slug → display label mapping |
| `packages/schemas/src/taxonomy-labels.ts` | Loader + lookup function |

### Modified Files (10)
| File | Change |
|---|---|
| `packages/schemas/classification_cues.json` | Add HVAC keywords to Category.maintenance and Sub_Location.general |
| `packages/schemas/taxonomy.json` | Add `entire_unit`, `multiple_rooms` to Sub_Location |
| `packages/schemas/taxonomy_constraints.json` | Add new values to constraint maps |
| `packages/schemas/src/validators/taxonomy-cross-validator.ts` | Add new values to SKIP_VALUES |
| `packages/schemas/src/index.ts` | Export taxonomy labels |
| `packages/core/src/llm/prompts/followup-prompt.ts` | Add Rule 14 for whole-unit HVAC options |
| `packages/core/src/__tests__/classifier/cue-scoring.test.ts` | Add no-heat cue tests |
| `apps/web/src/components/followup-form.tsx` | Use display labels |
| `apps/web/src/components/confirmation-panel.tsx` | Use display labels |
| `packages/evals/datasets/regression/examples.jsonl` | Add 2 no-heat regression cases |
| `packages/evals/datasets/regression/manifest.json` | Update count |
| `docs/bug-tracker.md` | Update BUG-001 status to FIXED |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| New cue keywords cause false positives on Category | Only adding HVAC-specific terms that are unambiguously maintenance. No generic words. |
| New taxonomy values break downstream constraint checks | `entire_unit` and `multiple_rooms` added to SKIP_VALUES — treated like `general` by hierarchy validator. |
| Label mapping breaks existing tests | Fallback behavior: unknown slugs get formatted (underscores → spaces, capitalize). No test depends on raw slug rendering. |
| Follow-up prompt change causes unexpected Claude behavior | Rule 14 is additive (doesn't modify existing rules). Only affects HVAC Sub_Location. |
| Regression eval cases have wrong expectations | Based directly on gold-016 and gold-019 which are already approved_for_gate. |

---

## What This Does NOT Change

- No changes to the state machine, transition matrix, or dispatcher
- No changes to the confidence formula or thresholds
- No changes to the follow-up answer contract (`string | boolean`)
- No multi-select UI — uses single enum values per the bug note's own guidance
- No changes to auth, rate limiting, or security
