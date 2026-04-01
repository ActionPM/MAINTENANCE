# Implementation Plan: Taxonomy Integrity Hardening

> **Status:** Complete
> **Date:** 2026-04-01
> **Context:** Taxonomy audit found five gaps: schema-lock enforcement, display label coverage, cue coverage, constraint completeness, and test completeness. This plan addresses all five findings in priority order.

---

## Findings Summary

| #   | Severity | Finding                                                                                                                                                                                | Impact                                                                                                                           |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | `classification.schema.json:48` and `work_order.schema.json:71` define classification as `additionalProperties: { "type": "string" }` -- any string key/value passes JSON Schema       | Weakens spec non-negotiable #3 (schema-lock all model outputs). Taxonomy enforcement relies entirely on runtime cross-validator. |
| 2   | Medium   | `taxonomy-labels.json` has no value-label maps for Maintenance_Object (52), Maintenance_Problem (16), Management_Category (5), Management_Object (25) -- 98 unlabeled values           | Tenant-facing UI shows slug-formatted fallbacks (`not_working` -> "Not working") instead of curated copy.                        |
| 3   | Medium   | `classification_cues.json` has thin coverage: Sub_Location 7/34, Maintenance_Object 27/52, Management_Object 12/25, Maintenance_Problem 14/16, Management_Category 3/5                 | Confidence scoring for uncovered values depends 100% on model hint + completeness; no cue-based correction signal.               |
| 4   | Medium   | `not_applicable` is valid in 5 taxonomy fields but has no parent entries in `taxonomy_constraints.json`. `constraint-resolver.ts:67` returns null (unconstrained) for missing parents. | Structurally asymmetric; no test or documentation asserts this is intentional.                                                   |
| 5   | Low      | `taxonomy-labels.test.ts` and `taxonomy-constraints.test.ts` check referential validity, not coverage completeness                                                                     | Allows label/constraint gaps to coexist with green CI.                                                                           |

---

## Batch 1 -- Schema-lock codegen (Finding 1)

**Goal:** Generate enum-backed schema definitions from `taxonomy.json` so JSON Schema itself enforces taxonomy membership on classification objects.

**Architecture:**

```
packages/schemas/
  scripts/
    generate-taxonomy-enums.mjs       # codegen: reads taxonomy.json, writes generated schema (plain Node ESM)
  taxonomy-classification.generated.schema.json   # generated output (checked in)
  classification.schema.json          # $ref to generated TaxonomyClassification
  work_order.schema.json              # $ref to generated TaxonomyClassification
  src/
    validator.ts                      # loads generated schema into Ajv
```

The generated schema defines a `TaxonomyClassification` definition with:

- One optional property per taxonomy field, each with `type: "string"` + `enum: [values from taxonomy.json]`
- `additionalProperties: false` -- rejects unknown field names at schema level
- No `required` -- classification is progressively built

### Task 1.1 -- Create codegen script

**File:** `packages/schemas/scripts/generate-taxonomy-enums.mjs`

Plain Node ESM script (no tsx dependency required). Reads `taxonomy.json`, builds a JSON Schema object with one property per taxonomy field (each with an enum array of its allowed values), and writes `taxonomy-classification.generated.schema.json` to the package root.

```javascript
// packages/schemas/scripts/generate-taxonomy-enums.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taxonomyPath = resolve(__dirname, '..', 'taxonomy.json');
const outputPath = resolve(__dirname, '..', 'taxonomy-classification.generated.schema.json');

const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf-8'));

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'taxonomy-classification.generated.schema.json',
  definitions: {
    TaxonomyClassification: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(taxonomy).map(([field, values]) => [
          field,
          { type: 'string', enum: [...values] },
        ]),
      ),
      additionalProperties: false,
    },
  },
};

writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n');
console.log('Generated taxonomy-classification.generated.schema.json');
```

### Task 1.2 -- Run codegen to produce generated schema

Run the script to create `taxonomy-classification.generated.schema.json`. Verify the output has 9 properties matching taxonomy.json exactly.

### Task 1.3 -- Update classification.schema.json

Replace `classification.schema.json:48-51`:

```json
// Before
"classification": {
  "type": "object",
  "additionalProperties": { "type": "string" }
}

// After
"classification": {
  "$ref": "taxonomy-classification.generated.schema.json#/definitions/TaxonomyClassification"
}
```

### Task 1.4 -- Update work_order.schema.json

Replace `work_order.schema.json:71-74`:

```json
// Before
"classification": {
  "type": "object",
  "additionalProperties": { "type": "string" }
}

// After
"classification": {
  "$ref": "taxonomy-classification.generated.schema.json#/definitions/TaxonomyClassification"
}
```

### Task 1.5 -- Register generated schema in validator.ts

Add import and registration in `packages/schemas/src/validator.ts`:

```typescript
import taxonomyClassificationSchema from '../taxonomy-classification.generated.schema.json';

// In SCHEMA_ENTRIES array:
['taxonomy-classification.generated.schema.json', taxonomyClassificationSchema as unknown as Record<string, unknown>],
```

The generated schema's `$id` must match the `$ref` target for Ajv cross-file resolution.

### Task 1.6 -- Add `generate` script to package.json

In `packages/schemas/package.json`:

```json
"scripts": {
  "generate": "node scripts/generate-taxonomy-enums.mjs",
  ...
}
```

No new devDependencies required -- the script is plain Node ESM.

### Task 1.7 -- Add staleness guard test

New test in `packages/schemas/src/__tests__/taxonomy-enum-staleness.test.ts`:

Regenerates the schema in-memory from current taxonomy.json and compares to the file on disk. Fails with actionable message if stale:

```
Expected generated schema to match taxonomy-classification.generated.schema.json.
Run: pnpm --filter @wo-agent/schemas generate
```

This catches taxonomy.json changes that weren't followed by codegen.

### Task 1.8 -- Add generated schema to integration inventory test

`packages/schemas/src/__tests__/integration.test.ts:251` has a "schema/config JSON files exist" test that inventories all JSON files in the schemas package. Add `taxonomy-classification.generated.schema.json` to the `schemaFiles` array so the new artifact is covered by the existing inventory check.

### Task 1.9 -- Fix test breakage from tighter schema

Some existing tests may assert "taxonomy validation fails" for invalid values. With enum-backed schemas, those values now fail at schema validation instead. Audit test files for classifier/work-order tests that pass invalid classification values and update assertions to expect schema-level rejection where appropriate.

Key test files to audit:

- `packages/core/src/__tests__/classifier/issue-classifier.test.ts`
- `packages/core/src/__tests__/classifier/integration.test.ts`
- `packages/schemas/src/__tests__/validators.test.ts`
- `packages/core/src/__tests__/confirmation/payload-builder.test.ts`
- Any test using `classification: { Category: "invalid_value" }` patterns

### Task 1.10 -- Run full checks

```bash
pnpm test && pnpm typecheck && pnpm lint
```

### Review checkpoint

Verify:

- Generated schema has 9 properties with correct enum values
- Both classification.schema.json and work_order.schema.json $ref the generated definition
- Ajv resolves cross-file $ref correctly
- Schema validation now rejects invalid taxonomy field names and values
- Taxonomy cross-validator still runs (for category gating and hierarchical constraints)
- All tests pass (with updated assertions where needed)
- Staleness test catches intentional drift

---

## Batch 2 -- Display label completeness (Finding 2)

**Goal:** Every taxonomy value has a curated display label. No slug fallbacks reach tenant-facing UI.

### Task 2.1 -- Add Maintenance_Object labels (52 values)

Add to `taxonomy-labels.json` under `"labels"`:

```json
"Maintenance_Object": {
  "toilet": "Toilet",
  "sink": "Sink",
  "faucet": "Faucet",
  "drain": "Drain",
  "pipe": "Pipe",
  "shower": "Shower",
  "breaker": "Circuit breaker",
  "fuse": "Fuse",
  "switch": "Light switch",
  "outlet": "Electrical outlet",
  "light": "Light fixture",
  "radiator": "Radiator",
  "thermostat": "Thermostat",
  "door": "Door",
  "cabinet": "Cabinet",
  "shelf": "Shelf",
  "baseboard": "Baseboard",
  "floor": "Floor",
  "tile": "Tile",
  "carpet": "Carpet",
  "wood": "Wood floor",
  "laminate": "Laminate floor",
  "wall": "Wall",
  "ceiling": "Ceiling",
  "paint": "Paint",
  "pests": "Pests (general)",
  "cockroaches": "Cockroaches",
  "ants": "Ants",
  "bedbugs": "Bedbugs",
  "rodents": "Rodents",
  "lock": "Lock",
  "key": "Key",
  "fridge": "Fridge",
  "dishwasher": "Dishwasher",
  "oven": "Oven",
  "microwave": "Microwave",
  "stove": "Stove",
  "washer": "Washer",
  "dryer": "Dryer",
  "range_hood": "Range hood",
  "roof": "Roof",
  "grout": "Grout",
  "bathtub": "Bathtub",
  "window": "Window",
  "smoke_detector": "Smoke detector",
  "exhaust_fan": "Exhaust fan",
  "screen": "Screen",
  "blind": "Blind",
  "other_object": "Other",
  "no_object": "Not specified",
  "needs_object": "Needs identification",
  "not_applicable": "N/A"
}
```

### Task 2.2 -- Add Maintenance_Problem labels (16 values)

```json
"Maintenance_Problem": {
  "leak": "Leak",
  "drain": "Drain issue",
  "clog": "Clog",
  "not_working": "Not working",
  "no_water": "No water",
  "no_heat": "No heat",
  "flood": "Flooding",
  "infestation": "Infestation",
  "broken_damaged": "Broken / Damaged",
  "safety_risk": "Safety risk",
  "smell": "Unusual smell",
  "low_pressure": "Low pressure",
  "noise_vibration": "Noise / Vibration",
  "missing": "Missing",
  "other_problem": "Other",
  "not_applicable": "N/A"
}
```

### Task 2.3 -- Add Management_Category labels (5 values)

```json
"Management_Category": {
  "accounting": "Accounting",
  "lease": "Lease",
  "general": "General inquiry",
  "other_mgmt_cat": "Other",
  "not_applicable": "N/A"
}
```

### Task 2.4 -- Add Management_Object labels (25 values)

```json
"Management_Object": {
  "rent_increases": "Rent increase",
  "rent_charges": "Rent charges",
  "banking": "Banking",
  "rent_receipt": "Rent receipt",
  "move_out": "Move-out",
  "sublet_assign": "Sublet / Assignment",
  "rentable_item": "Rentable item",
  "add_remove_tenant": "Add / Remove tenant",
  "move_in": "Move-in",
  "lease_inquiry": "Lease inquiry",
  "complaint": "Complaint",
  "booking_scheduling": "Booking / Scheduling",
  "legal_matters": "Legal matters",
  "technical_issues": "Technical issues",
  "accommodations": "Accommodations",
  "chargebacks": "Chargebacks",
  "general_feedback": "General feedback",
  "questions": "Questions",
  "parking": "Parking",
  "intercom": "Intercom",
  "building_access": "Building access",
  "other_mgmt_obj": "Other",
  "no_object": "Not specified",
  "needs_object": "Needs identification",
  "not_applicable": "N/A"
}
```

**Note:** These labels are initial suggestions. Product review may refine them -- for example, whether "Flooding" or "Flood" is better, or whether "Not specified" vs "Unspecified" is the right tone. The completeness test (Task 2.5) ensures nothing gets missed; the exact copy is a product decision.

**Placeholder/meta values need explicit product review.** Labels like `needs_object` -> "Needs identification", `no_object` -> "Not specified", and `not_applicable` -> "N/A" are better than raw slugs, but they still expose internal classifier states to tenants. These values surface when the system hasn't finished narrowing a classification and appear in follow-up prompts and confirmation panels. Product should decide whether these should be hidden entirely, reworded to tenant-facing language (e.g., "We'll identify this for you"), or kept as-is. The completeness test enforces that a label exists; the quality of that label for meta values is a separate product decision.

### Task 2.5 -- Add label completeness test

New test in `packages/schemas/src/__tests__/taxonomy-labels.test.ts`:

```typescript
describe('label completeness', () => {
  it('every taxonomy value has a display label in taxonomy-labels.json', () => {
    const taxonomy = loadTaxonomy();
    const missing: string[] = [];
    for (const [field, values] of Object.entries(taxonomy)) {
      for (const value of values) {
        const label = labels[field]?.[value];
        if (!label) {
          missing.push(`${field}.${value}`);
        }
      }
    }
    expect(missing, `Missing labels:\n${missing.join('\n')}`).toEqual([]);
  });
});
```

This test reads directly from taxonomy.json and taxonomy-labels.json, so it catches any future taxonomy additions that lack labels.

### Task 2.6 -- Run tests

```bash
pnpm --filter @wo-agent/schemas test
```

### Review checkpoint

Verify:

- All 98 previously unlabeled values now have labels in taxonomy-labels.json
- The completeness test passes
- `getTaxonomyLabel()` returns the new labels instead of slug fallbacks
- Total label count: 156 values across 9 fields (= full taxonomy coverage)

---

## Batch 3 -- Cue coverage audit test (Finding 3)

**Goal:** Add a test that cross-references taxonomy.json against classification_cues.json and forces an explicit decision for every uncovered value. This batch does NOT expand cues -- it creates the forcing function.

**Rationale:** Cue expansion should be driven by regression frequency data from evals, not blanket parity. The audit test makes the coverage gap visible and forces a conscious decision per uncovered value.

### Task 3.1 -- Add cue coverage audit test

New test file: `packages/schemas/src/__tests__/cue-coverage-audit.test.ts`

Reuse the existing `CueDictionary` type from `cue-dictionary-validator.ts`. The real cue shape is `fields[fieldName][value]` with `{ keywords: string[]; regex: string[] }` -- note `regex`, not `regex_patterns`.

```typescript
import { loadTaxonomy } from '../taxonomy.js';
import type { CueDictionary } from '../validators/cue-dictionary-validator.js';
import cuesJson from '../../classification_cues.json' with { type: 'json' };

const cues = cuesJson as unknown as CueDictionary;

describe('cue coverage audit', () => {
  it('every taxonomy value either has cues or is in the explicit exclusion list', () => {
    const taxonomy = loadTaxonomy();

    // Values excluded from cue matching. Each group must have a justification.
    // To add cues for a value: remove it from this list and add entries
    // in classification_cues.json. Expand based on eval regression frequency.
    // All currently-uncovered values, grouped by justification.
    // To add cues for a value: remove it from this list and add entries
    // in classification_cues.json. Expand based on eval regression frequency.
    const EXCLUDED: Record<string, string[]> = {
      // --- Placeholder/meta values: no meaningful keyword signal ---
      Maintenance_Object: ['other_object', 'no_object', 'needs_object', 'not_applicable'],
      Maintenance_Problem: ['other_problem', 'not_applicable'],
      Management_Category: ['other_mgmt_cat', 'not_applicable'],
      Management_Object: ['other_mgmt_obj', 'no_object', 'needs_object', 'not_applicable'],
      Maintenance_Category: ['other_maintenance_category', 'not_applicable'],

      // --- Uncovered values: eval-driven expansion pending ---
      Sub_Location: [
        'other_sub_location',
        // building interior/exterior -- low standalone keyword signal
        'closets',
        'windows',
        'ceiling',
        'entrance_lobby',
        'hallways_stairwells',
        'elevator',
        'laundry',
        'locker_room',
        'gym',
        'pool',
        'party_room',
        'other_amenity',
        'mechanical_room',
        'cable_room',
        'bike_locker',
        'parking_garage',
        'landscape',
        'hardscape',
        'facade',
        'roof',
        'mechanical',
        'garbage',
        'amenity',
        'surface_parking',
        // multi-area values
        'entire_unit',
        'multiple_rooms',
      ],
      // (Similarly populate Maintenance_Object, Management_Object exclusion
      //  lists with all currently-uncovered values from classification_cues.json.)
    };

    const uncovered: string[] = [];
    for (const [field, values] of Object.entries(taxonomy)) {
      const fieldCues = cues.fields[field] ?? {};
      const excluded = EXCLUDED[field] ?? [];
      for (const value of values) {
        if (excluded.includes(value)) continue;
        const entry = fieldCues[value];
        if (!entry || (entry.keywords.length === 0 && entry.regex.length === 0)) {
          uncovered.push(`${field}.${value}`);
        }
      }
    }

    expect(
      uncovered,
      `Uncovered values (add cues or add to EXCLUDED with justification):\n${uncovered.join('\n')}`,
    ).toEqual([]);
  });
});
```

### Task 3.2 -- Populate initial exclusion list (CI-green)

Seed the exclusion list with **all** currently-uncovered values so CI stays green on merge. Every excluded value gets a justification comment (grouped by reason: placeholder/meta, low keyword signal, eval-driven expansion pending).

The forcing function works on the **removal** side: when someone adds cues for a value, they remove it from the exclusion list. When someone adds a new taxonomy value, the test fails unless they also add cues or an exclusion entry. This keeps the decision explicit without landing a red test.

### Task 3.3 -- Run tests

```bash
pnpm --filter @wo-agent/schemas test
```

### Review checkpoint

Verify:

- The audit test passes green with the full exclusion list
- Every excluded value has a justification comment
- Adding a new taxonomy value without cues or exclusion fails the test

---

## Batch 4 -- Constraint data fix, not_applicable bypass, and completeness tests (Findings 4 + 5)

**Goal:** Fix a cross-category constraint gap where leak-capable appliances are unreachable under `plumbing`, document and test that `not_applicable` intentionally has no constraint entries, and add completeness tests that catch future gaps.

### Task 4.0 -- Add leak-capable appliances to plumbing object list

**Problem:** When a tenant reports "I have a leak" in the kitchen, the classifier infers `Maintenance_Category=plumbing`. The forward constraint `Maintenance_Category_to_Maintenance_Object` for `plumbing` only includes pipe/fixture objects (toilet, sink, faucet, drain, pipe, shower, bathtub). Dishwasher, fridge, and washer -- all of which can leak via water supply lines, drain hoses, or defrost trays -- are only listed under `appliance`. The constraint narrows them out before the tenant ever sees them as options.

**Fix:** In `taxonomy_constraints.json`, add `dishwasher`, `fridge`, and `washer` to the `plumbing` array in `Maintenance_Category_to_Maintenance_Object`:

```json
"plumbing": [
  "toilet",
  "sink",
  "faucet",
  "drain",
  "pipe",
  "shower",
  "bathtub",
  "dishwasher",
  "fridge",
  "washer",
  "other_object",
  "needs_object"
]
```

These objects remain in the `appliance` list as well -- an object can be valid under multiple categories. The constraint resolver intersects parent constraints, so adding them to `plumbing` makes them reachable when the classifier infers plumbing from a leak report, while keeping them available under appliance for non-leak problems (e.g., dishwasher not_working).

**Verify after change:**

- `resolveValidOptions('Maintenance_Object', { Sub_Location: 'kitchen', Maintenance_Category: 'plumbing' }, constraints)` includes `dishwasher`, `fridge`, `washer`
- Existing plumbing objects still present
- `Maintenance_Object_to_Maintenance_Problem` for these three already includes `leak` (confirmed: dishwasher line 642, fridge line 635, washer line 665)
- `Maintenance_Object_to_Sub_Location` for these three already includes `kitchen` (confirmed: dishwasher line 1048, fridge line 1045; washer needs check -- may need `kitchen` added if currently only `laundry`)

**Washer sub-location constraint:** `Maintenance_Object_to_Sub_Location` for `washer` is currently `["laundry"]` only (line 1060). Do **not** add `kitchen` -- washers in kitchens are uncommon in the building types this product serves (Canadian multi-residential). Washer remains reachable for leak reports in laundry rooms, which is the correct scope. Dishwasher and fridge already have `kitchen` in their sub-location lists and are the primary appliance-leak objects for kitchens.

### Task 4.0a -- Update classifier prompt guidance

`packages/core/src/llm/prompts/classifier-prompt.ts` lines 94 and 198 (V1 and V2 prompts) both say:

```
Maintenance_Category constrains Maintenance_Object: e.g., "plumbing" allows toilet, sink, pipe, etc. NOT breaker, fridge.
```

After adding fridge, dishwasher, and washer to plumbing, this example is wrong -- fridge is now allowed under plumbing. Update both lines to:

```
Maintenance_Category constrains Maintenance_Object: e.g., "plumbing" allows toilet, sink, pipe, dishwasher, fridge, etc. NOT breaker, light.
```

The negative example switches from `fridge` (now valid under plumbing) to `light` (an electrical-only object that remains invalid under plumbing).

### Task 4.0b -- Update classifier prompt constraint test

`packages/core/src/__tests__/classifier/classifier-prompt-constraints.test.ts` line 33 asserts:

```typescript
expect(prompt).toMatch(/fridge.*kitchen/i);
```

This test checks the Object->Sub_Location example and is unaffected by the plumbing change (fridge still must be in kitchen). No change needed to this specific assertion.

However, if any other test in this file or in `classifier-prompt.test.ts` asserts the exact "NOT breaker, fridge" text, update it to match the new wording. Grep for `NOT.*breaker.*fridge` across the test suite.

### Task 4.0c -- Add constraint regression test for appliance-leak path

Add a test in `packages/core/src/__tests__/classifier/constraint-resolver.test.ts` that verifies the fix works end-to-end:

```typescript
describe('appliance-leak cross-category constraint', () => {
  it('dishwasher is reachable under plumbing for kitchen leaks', () => {
    const objects = resolveValidOptions(
      'Maintenance_Object',
      {
        Sub_Location: 'kitchen',
        Maintenance_Category: 'plumbing',
      },
      constraints,
    );
    expect(objects).toContain('dishwasher');
    expect(objects).toContain('fridge');
  });

  it('dishwasher still reachable under appliance', () => {
    const objects = resolveValidOptions(
      'Maintenance_Object',
      {
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
      },
      constraints,
    );
    expect(objects).toContain('dishwasher');
  });

  it('leak is a valid problem for dishwasher', () => {
    const problems = resolveValidOptions(
      'Maintenance_Problem',
      {
        Maintenance_Object: 'dishwasher',
      },
      constraints,
    );
    expect(problems).toContain('leak');
  });
});
```

### Task 4.1 -- Document bypass in taxonomy_constraints.json

Add a top-level `_meta` field documenting the policy. Do **not** bump the `version` field -- constraint versions are not currently pinned or consumed by the app, so incrementing it is noise.

```json
{
  "version": "1.0.0",
  "_meta": {
    "not_applicable_policy": "not_applicable values intentionally have no parent entries in constraint maps. When a field is not_applicable, constraint resolution returns null (unconstrained) for its children. This is correct: not_applicable means the axis does not apply, so constraining children is meaningless."
  },
  ...
}
```

### Task 4.2 -- Add constraint coverage completeness test

New test in `packages/schemas/src/__tests__/taxonomy-constraints.test.ts`.

Use a shared helper that iterates **every** constraint map, not just maintenance maps. This keeps the test model consistent with the problem we're preventing -- any map with a missing parent is surfaced, not just the ones we know about today.

```typescript
describe('constraint coverage completeness', () => {
  // Values intentionally excluded from parent constraint mappings.
  // Documented in taxonomy_constraints.json _meta.not_applicable_policy.
  const PARENT_EXCLUSIONS: Record<string, string[]> = {
    Maintenance_Category: ['not_applicable'],
    Maintenance_Object: ['not_applicable'],
    // Add other exclusions here with justification if discovered.
  };

  // Map from constraint map name -> [parentField, taxonomy key]
  const CONSTRAINT_MAP_PARENTS: Array<{
    mapName: string;
    parentField: string;
  }> = [
    { mapName: 'Location_to_Sub_Location', parentField: 'Location' },
    { mapName: 'Sub_Location_to_Maintenance_Category', parentField: 'Sub_Location' },
    { mapName: 'Maintenance_Category_to_Maintenance_Object', parentField: 'Maintenance_Category' },
    { mapName: 'Maintenance_Object_to_Maintenance_Problem', parentField: 'Maintenance_Object' },
    { mapName: 'Maintenance_Object_to_Sub_Location', parentField: 'Maintenance_Object' },
  ];

  for (const { mapName, parentField } of CONSTRAINT_MAP_PARENTS) {
    it(`every ${parentField} value has a ${mapName} entry or is excluded`, () => {
      const constraints = loadTaxonomyConstraints();
      const map = constraints[mapName] as Record<string, readonly string[]>;
      const excluded = PARENT_EXCLUSIONS[parentField] ?? [];
      const parentValues = taxonomy[parentField as keyof typeof taxonomy];
      const missing = parentValues.filter((val) => !map[val] && !excluded.includes(val));
      expect(missing, `Missing ${mapName} entries: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
```

This generates one test case per constraint map. If a new constraint map is added, add it to `CONSTRAINT_MAP_PARENTS`. If a new taxonomy value is added without a constraint entry, the test fails with a clear message.

### Task 4.3 -- Add not_applicable bypass assertion tests

New tests in `packages/core/src/__tests__/classifier/constraint-resolver.test.ts`:

```typescript
describe('not_applicable bypass', () => {
  it('returns null (unconstrained) when Maintenance_Category is not_applicable', () => {
    const result = resolveValidOptions(
      'Maintenance_Object',
      {
        Category: 'management',
        Maintenance_Category: 'not_applicable',
      },
      constraints,
    );
    expect(result).toBeNull();
  });

  it('returns null (unconstrained) when Maintenance_Object is not_applicable', () => {
    const result = resolveValidOptions(
      'Maintenance_Problem',
      {
        Category: 'management',
        Maintenance_Object: 'not_applicable',
      },
      constraints,
    );
    expect(result).toBeNull();
  });

  it('does not auto-resolve not_applicable via constraint implication', () => {
    const implied = resolveConstraintImpliedFields(
      {
        Category: 'management',
        Maintenance_Category: 'not_applicable',
        Maintenance_Object: 'not_applicable',
      },
      constraints,
    );
    expect(implied).toEqual({});
  });
});
```

These tests codify the current behavior as intentional, so any future change to constraint resolution that accidentally starts constraining `not_applicable` children will break.

### Task 4.4 -- Run tests

```bash
pnpm test
```

### Review checkpoint

Verify:

- Dishwasher, fridge, and washer appear in `plumbing` object list alongside their existing `appliance` entries
- Washer sub-location stays `["laundry"]` only (no kitchen)
- Classifier prompt lines 94/198 updated -- `fridge` removed from negative example, `dishwasher`/`fridge` added to positive example
- Regression test confirms dishwasher/fridge reachable under plumbing for kitchen
- `_meta.not_applicable_policy` documents the bypass
- Completeness tests pass with current constraint data
- not_applicable bypass tests assert null/unconstrained behavior
- No existing tests broken

---

## Batch 5 -- Spec-gap-tracker + docs

**Goal:** Update tracker rows affected by these changes.

### Task 5.1 -- Update S02-03 evidence

Row `S02-03` (schema-lock all model outputs) currently says: "all validate against JSON Schema via Ajv."

Update evidence to reference the enum-backed generated schema:

> `classification.schema.json` and `work_order.schema.json` $ref `taxonomy-classification.generated.schema.json` which enforces taxonomy field names and values via enum constraints. Codegen from `taxonomy.json`; staleness guard test in `taxonomy-enum-staleness.test.ts`. Runtime cross-validator (`taxonomy-cross-validator.ts`) enforces category gating and hierarchical constraints as a second layer.

### Task 5.2 -- Update S27-04 evidence

Row `S27-04` (work_order.schema.json) -- add note that classification is now enum-backed via codegen.

### Task 5.3 -- Consider new tracker rows

If the audit reveals that cue coverage or label completeness should be tracked as spec compliance items, add new rows. Candidate:

| ID       | Spec Ref | Requirement                                                             | Status |
| -------- | -------- | ----------------------------------------------------------------------- | ------ |
| `S27-19` | `29`     | taxonomy-labels.json -- complete display label coverage                 | `DONE` |
| `S27-20` | `29`     | classification_cues.json -- cue coverage audit with explicit exclusions | `DONE` |

### Task 5.4 -- Run full CI

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @wo-agent/web build
```

### Review checkpoint

Verify:

- Spec-gap-tracker rows are accurate and evidence is current
- Dashboard totals haven't shifted incorrectly
- All CI checks pass

---

## Dependency Graph

```
Batch 1 (schema-lock)  --+
Batch 2 (labels)        --+--> Batch 5 (tracker + docs)
Batch 3 (cue audit)     --+
Batch 4 (constraints)   --+
```

Batches 1-4 are independent of each other. Batch 5 depends on all prior batches.

Recommended execution order: 1 -> 2 -> 4 -> 3 -> 5 (schema-lock first because it's highest-risk; labels second because it's highest-volume content; constraints before cue audit because it's simpler).

---

## Risk Assessment

| Risk                                                                                    | Likelihood | Mitigation                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-file `$ref` breaks Ajv resolution                                                 | Low        | The `$id` in the generated schema matches the `$ref` target; Ajv resolves by `$id` when schema is registered via `addSchema()`. Test immediately after wiring.                                                         |
| Existing tests break from tighter schema                                                | Medium     | Some tests may pass invalid taxonomy values expecting cross-validator rejection. Audit test files in Task 1.9 and update assertions. The behavioral outcome is the same (rejection), only the rejection layer changes. |
| Generated schema goes stale after taxonomy change                                       | Low        | Staleness guard test (Task 1.7) fails CI if taxonomy.json and generated schema diverge. Actionable error message tells developer to run `generate`.                                                                    |
| Label copy doesn't match product tone                                                   | Low        | Labels are initial suggestions. Completeness test ensures coverage; product review can refine copy independently.                                                                                                      |
| Cue audit test creates large initial test failure                                       | Low        | Resolved: seed full exclusion list so CI stays green. Forcing function works on the removal side -- adding cues lets you shrink the exclusion list.                                                                    |
| Constraint completeness test discovers additional missing parents beyond not_applicable | Low        | If other parent values are missing, the test surfaces them. Add to exclusion list with justification, or add constraint entries -- same pattern as the cue audit.                                                      |

---

## Files Changed (Estimated)

| Batch | New files                                                                                                                               | Modified files                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `scripts/generate-taxonomy-enums.mjs`, `taxonomy-classification.generated.schema.json`, `src/__tests__/taxonomy-enum-staleness.test.ts` | `classification.schema.json`, `work_order.schema.json`, `src/validator.ts`, `package.json`, `src/__tests__/integration.test.ts`, plus test files with invalid-taxonomy assertions   |
| 2     | --                                                                                                                                      | `taxonomy-labels.json`, `src/__tests__/taxonomy-labels.test.ts`                                                                                                                     |
| 3     | `src/__tests__/cue-coverage-audit.test.ts`                                                                                              | --                                                                                                                                                                                  |
| 4     | --                                                                                                                                      | `taxonomy_constraints.json`, `core/src/llm/prompts/classifier-prompt.ts`, `src/__tests__/taxonomy-constraints.test.ts`, `core/src/__tests__/classifier/constraint-resolver.test.ts` |
| 5     | --                                                                                                                                      | `docs/spec-gap-tracker.md`                                                                                                                                                          |

---

## Acceptance Criteria

1. `classification.schema.json` and `work_order.schema.json` enforce taxonomy field names and values via enum constraints generated from `taxonomy.json`.
2. A staleness guard test fails if the generated schema is out of sync with `taxonomy.json`.
3. All 156 taxonomy values (across 9 fields) have curated display labels in `taxonomy-labels.json`.
4. A label completeness test enforces that every taxonomy value has a label.
5. A cue coverage audit test enforces that every taxonomy value either has cues or is in an explicit exclusion list with justification.
6. `not_applicable` constraint bypass is documented in `taxonomy_constraints.json` and asserted in tests.
7. Constraint completeness tests ensure every parent value has a constraint entry or is in an explicit exclusion list.
8. `docs/spec-gap-tracker.md` reflects all changes accurately.
9. `pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @wo-agent/web build` all pass.
