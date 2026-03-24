# Gold-Set Ingest Amendment

**Date**: 2026-03-24
**Status**: Draft — pending peer review
**Scope**: Targeted fixes to the CSV-to-JSONL transpiler so the 214-row gold set can be ingested and baselined
**Parent plan**: `gold-set-taxonomy-migration.md` (committed 2026-03-23)

---

## Context

The gold-set CSV has arrived. Comparing it against the transpiler built in the parent plan reveals five concrete mismatches. All are contained to the transpiler and its tests — no runtime, schema, or taxonomy changes are needed.

The parent plan assumed column names and a semver taxonomy_version format that the actual CSV does not use. It also did not account for the `emergency` and `safety_flag` columns, which carry signal that the dataset should preserve for future scoring.

---

## Decisions

### D1: `other_issue` stays in the taxonomy — transpiler maps it on ingest

**Context**: The gold set uses `other_issue` as a Maintenance_Category in 7 rows (mold, wall damage, ambiguous issues). The taxonomy also has `other_maintenance_category` as a separate catch-all. The product owner directed that these should be combined.

**Decision**: Map `other_issue` → `other_maintenance_category` in the transpiler during CSV ingest. Do not remove `other_issue` from `taxonomy.json` or `taxonomy_constraints.json` in this phase.

**Why safest/smallest**:
- Removing `other_issue` from the taxonomy requires updating taxonomy_constraints.json (30+ sub-location entries), the cross-validator legacy lists, and taxonomy-labels.json. That is a cross-cutting taxonomy change with its own test surface.
- Mapping in the transpiler is a one-line change isolated to ingest.
- The runtime classifier prompt already uses `not_applicable` for cross-domain and the v2 prompt does not mention `other_issue` — it will naturally fall back to `other_maintenance_category` or `general_maintenance` when the category is ambiguous.
- A follow-up task can deprecate `other_issue` from the taxonomy after the gold-v1 baseline is stable.

### D2: Column names are mapped in the transpiler, not renamed in the eval schema

**Context**: The CSV uses `raw_intake` and `atomic_issue`. The eval schema uses `conversation_text` and `issue_text`.

**Decision**: The transpiler maps CSV columns to eval schema fields. The eval schema is not renamed.

**Why**: Renaming the eval schema would touch `NormalizedExample`, `eval_example.schema.json`, all 6 existing datasets, the eval runner, replay runner, and metrics — ~20 files. Mapping in the transpiler is 2 lines.

### D3: `emergency` and `safety_flag` populate `expected_risk_flags` for future scoring

**Context**: The parent plan defaulted `expected_risk_flags: []` for all rows. The CSV has explicit `emergency` and `safety_flag` columns.

**Decision**: The transpiler populates `expected_risk_flags` from these columns:
- `emergency = "yes"` → `"emergency"` in `expected_risk_flags`
- `safety_flag = "yes"` → `"safety"` in `expected_risk_flags`

Gold-v1 does not add risk-flag metrics or regression gates to the eval runner. The data is carried in the dataset so it is available when risk-flag scoring is implemented in a follow-up phase. No eval-runner or metrics changes in this amendment.

### D4: `maintenance_taxonomy_v1` maps to `1.0.0`

**Context**: The CSV uses `maintenance_taxonomy_v1` as the taxonomy_version. The repo's taxonomy is at `1.0.0`. All gold-set values exist in the repo taxonomy at that version.

**Decision**: The transpiler maps the string `maintenance_taxonomy_v1` → `1.0.0`. If other named versions appear in future CSVs, the mapping table is extended.

### D5: `example_id` is conversation-scoped from `source_message_id`; `record_id` is not emitted

**Context**: Each gold-set row has a `record_id` (e.g., GCS-0001) and a `source_message_id` (e.g., SR-1018). Multi-issue conversations share a `source_message_id` across multiple `record_id` rows. The transpiler groups rows by `source_message_id` into one `NormalizedExample` per conversation, so there is no 1:1 mapping from `record_id` to `example_id`.

**Decision**: `example_id` is derived from `source_message_id` (format: `gold-v1-SR-1018`). `record_id` is not emitted in the v1 JSONL output. It remains a CSV-only traceability artifact — recoverable from the source CSV if a specific gold-set row needs to be traced back.

**Why**: A grouped `NormalizedExample` for SR-1018 contains 8 atomic issues. Assigning one `record_id` as the `example_id` would be misleading. Using `source_message_id` is consistent with the eval schema's one-example-per-conversation model.

### D6: `is_multi_issue_original` is not a new field — it is already encoded

The transpiler groups rows by `source_message_id`. When multiple rows share a `source_message_id`, the resulting `NormalizedExample` has `split_issues_expected.length > 1` and gets a `multi_issue` slice tag. The `is_multi_issue_original` column confirms this grouping but does not add new information. No change needed.

---

## Task Breakdown

### Task A: Fix CSV column mapping in transpiler

**File**: `packages/evals/src/datasets/csv-transpiler.ts`
**Changes**:
1. Read `raw_intake` column → map to `conversation_text` in `NormalizedExample`
2. Read `atomic_issue` column → map to `issue_text` in `split_issues_expected`
3. Derive `example_id` from `source_message_id` (format: `gold-v1-{source_message_id}`, e.g., `gold-v1-SR-1018`)
4. `record_id` is not emitted — it is read during parsing but not carried into the output
5. Update `GoldSetRow` interface to match actual CSV column names

**Tests**: Update fixture CSV in `csv-transpiler.test.ts` to use `raw_intake`, `atomic_issue`, `record_id`, `source_message_id` column names. Verify: `conversation_text` populated from `raw_intake`; `issue_text` from `atomic_issue`; `example_id` from `source_message_id`.

**Depends on**: Nothing
**Acceptance**: Transpiler reads the actual CSV without errors; `example_id` is conversation-scoped from `source_message_id`; `record_id` does not appear in output

### Task B: Fix taxonomy_version normalization

**File**: `packages/evals/src/datasets/csv-transpiler.ts`
**Changes**:
1. Add named-version mapping: `{ 'maintenance_taxonomy_v1': '1.0.0' }`
2. `normalizeTaxonomyVersion()` checks the mapping table first, falls back to numeric semver normalization

**Tests**: `normalizeTaxonomyVersion('maintenance_taxonomy_v1')` returns `'1.0.0'`; existing numeric tests unchanged

**Depends on**: Nothing
**Acceptance**: No throw on `maintenance_taxonomy_v1`; produces valid semver

### Task C: Map `other_issue` → `other_maintenance_category` in transpiler

**File**: `packages/evals/src/datasets/csv-transpiler.ts`
**Changes**:
1. In `buildClassification()`, after reading each taxonomy field value, apply value normalization: if `Maintenance_Category` value is `other_issue`, replace with `other_maintenance_category`

**Tests**: Gold-set row with `Maintenance_Category: "other_issue"` produces classification with `Maintenance_Category: "other_maintenance_category"`

**Depends on**: Nothing
**Acceptance**: All 7 `other_issue` rows produce `other_maintenance_category` in output

### Task D: Map `emergency` and `safety_flag` to `expected_risk_flags`

**File**: `packages/evals/src/datasets/csv-transpiler.ts`
**Changes**:
1. Read `emergency` and `safety_flag` columns from each row
2. Populate `expected_risk_flags`:
   - `emergency = "yes"` → include `"emergency"`
   - `safety_flag = "yes"` → include `"safety"`
3. Aggregate across all rows in a multi-issue group (union of flags)

**Tests**: Row with `emergency=yes, safety_flag=no` → `expected_risk_flags: ["emergency"]`; row with both yes → `["emergency", "safety"]`; row with both no → `[]`

**Depends on**: Nothing
**Acceptance**: Risk flags populated from CSV; multi-issue groups merge flags correctly

### Task E: Run transpiler on actual CSV and generate gold-v1 baseline

**Files**:
- Input: gold-set CSV (provided by product owner)
- Output: `packages/evals/datasets/gold-v1/examples.jsonl`, `packages/evals/datasets/gold-v1/manifest.json`
- Baseline: `packages/evals/baselines/gold-v1-baseline.json`

**Steps**:
1. Place CSV in a known location (or pipe content to transpiler)
2. Run `transpileCsv()` → writes `gold-v1/` dataset
3. Verify `loadDataset('gold-v1')` succeeds (schema validation passes)
4. Run `pnpm eval:run --dataset gold-v1` → produces eval run JSON
5. Review metrics: field_accuracy, followup_precision, followup_recall (risk flags are dataset-only — no metric computed in gold-v1)
6. If metrics are reasonable, run `pnpm eval:update-baseline` to promote to `gold-v1-baseline.json`

**Depends on**: Tasks A–D
**Acceptance**: `loadDataset()` accepts the output; eval run completes without errors; baseline JSON exists

---

## What this plan does NOT change

- **taxonomy.json** — no values added or removed. `other_issue` stays for now.
- **taxonomy_constraints.json** — unchanged.
- **Runtime behavior** — no changes to orchestrator, classifier, confidence, completeness gate, or follow-up logic.
- **Eval schema** — `NormalizedExample`, `eval_example.schema.json` unchanged.
- **Existing datasets** — gold, hard, ood, regression datasets untouched.
- **JSON schemas** — no schema file changes.

## Risks

| Risk | Mitigation |
|---|---|
| `other_issue` rows produce eval mismatches if runtime classifies as `general_maintenance` instead of `other_maintenance_category` | Both are valid taxonomy values; field_accuracy will score the exact match. Acceptable for baseline — the gold set defines the target. |
| Named taxonomy versions from future CSVs not in mapping table | Transpiler throws with a clear error message; extend the table when new versions appear. |
| `expected_risk_flags` data is populated but not scored | Intentional — gold-v1 does not add risk-flag metrics. The data is preserved so scoring can be added in a follow-up phase without re-ingesting the CSV. |

---

## Estimated scope

5 changes to one file (`csv-transpiler.ts`) + test updates. No cross-package changes. No runtime changes. This is a pure ingest/eval fix.
