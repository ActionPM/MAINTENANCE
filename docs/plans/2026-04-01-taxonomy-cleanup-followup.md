# Implementation Plan: Taxonomy Cleanup Follow-Up — Stale Eval Baselines

> **Status:** Done
> **Date:** 2026-04-01
> **Context:** Peer review of taxonomy placeholder cleanup found three issues. Two are already resolved. This plan addresses the remaining one: eval baseline files that still reference removed taxonomy values.

---

## Peer Review Findings — Triage

### Finding 1: eval_example.schema.json lost `required: ["Category"]` — ALREADY RESOLVED

The `required: ["Category"]` was not removed — it was replaced with an `anyOf` pattern:

```json
"anyOf": [
  { "maxProperties": 0 },
  { "required": ["Category"] }
]
```

This is a better constraint. It allows explicitly empty classification objects (for partial eval examples) while still requiring Category when any fields are present. The old `required` conflicted with the empty-object case. No action needed.

### Finding 2: Classifier prompt rule 3 management cross-fill — ALREADY RESOLVED

The V1 prompt diff shows the management→maintenance cross-fill was changed from:

```
Maintenance_Category: "other_maintenance_category", Maintenance_Object: "other_maintenance_object", Maintenance_Problem: "other_problem"
```

to:

```
Maintenance_Category: "not_applicable", Maintenance_Object: "not_applicable", Maintenance_Problem: "not_applicable"
```

This matches the V2 prompt's behavior. No action needed.

### Finding 3: Stale eval baselines — NEEDS WORK

Eight baseline files still contain removed taxonomy values (`other_category`, `other_priority`, `other_maintenance_object`). These are LLM output recordings, not runtime data, but they create a latent inconsistency with the current taxonomy.

---

## Scope

Fix only the stale baseline issue. Two tiers of baselines exist:

**Tier 1 — Fixture baselines** (can regenerate without API key):

- `gold-v1-baseline.json` — 1 occurrence of `other_maintenance_object`

**Tier 2 — Provider/LLM baselines** (recorded LLM outputs, need API key to regenerate):

- `gold-v1-anthropic-baseline.json` — 2 occurrences of `other_category`
- `gold-v1-run-1774635426800.json` — 2 occurrences of `other_category`
- `hard-anthropic-baseline.json` — 2 occurrences of `other_category`
- `hard-run-1774566191302.json` — 2 occurrences of `other_category`
- `hard-run-1774635574051.json` — 3 occurrences of `other_category`

**Tier 3 — Archived v0.1 baselines** (historical, superseded by v1):

- `hard-v0.1-baseline.json` — 8 occurrences (`other_category` + `other_priority`)
- `ood-v0.1-baseline.json` — 24 occurrences (`other_category` + `other_priority`)

**Clean baselines** (no stale values, no action needed):

- `gold-v0.1-baseline.json`
- All `regression-*` baselines
- All `*-comparison-*` reports

---

## Plan

### Step 1 — Regenerate the fixture baseline (no API key needed)

`gold-v1-baseline.json` is the only fixture baseline with a stale value. Regenerate it:

```bash
pnpm --filter @wo-agent/evals eval:run -- --dataset gold-v1 --adapter fixture
pnpm --filter @wo-agent/evals eval:update-baseline -- --run-file packages/evals/baselines/gold-v1-run-<timestamp>.json
```

Verify the new baseline has zero occurrences of removed values. The single `other_maintenance_object` should become either `other_object`, `not_applicable`, or a specific object value depending on how the fixture adapter resolves it.

### Step 2 — Decide on provider baselines

Provider baselines (`*-anthropic-baseline.json`, `*-run-*.json`) contain `other_category` because the live LLM returned it when the taxonomy still included `other_category`. There are two options:

**Option A — Regenerate with live LLM (preferred if API key is available):**

`eval:update-baseline` always writes to `<dataset_manifest_id>-baseline.json`. It does NOT write adapter-specific paths. To update the provider-specific baselines, run the eval and then manually rename the output:

```bash
# Requires ANTHROPIC_API_KEY in .env.local

# gold-v1
pnpm --filter @wo-agent/evals eval:run -- --dataset gold-v1 --adapter anthropic
# eval:run writes gold-v1-run-<timestamp>.json
# Promote to provider baseline with manual rename:
cp packages/evals/baselines/gold-v1-run-<timestamp>.json packages/evals/baselines/gold-v1-anthropic-baseline.json

# hard
pnpm --filter @wo-agent/evals eval:run -- --dataset hard --adapter anthropic
cp packages/evals/baselines/hard-run-<timestamp>.json packages/evals/baselines/hard-anthropic-baseline.json
```

Do NOT use `eval:update-baseline` for provider baselines — it would overwrite the fixture baseline path (`gold-v1-baseline.json`), not the provider-specific file. The run output file is the baseline; copy it to the `-anthropic-baseline.json` path directly.

After promotion, delete the superseded run files:

- `gold-v1-run-1774635426800.json` (old run, now replaced by the new anthropic baseline)
- `hard-run-1774566191302.json`, `hard-run-1774635574051.json` (same)

The LLM will see the updated taxonomy (without `other_category`) and should classify to `maintenance` or `management` instead.

**Option B — Document as pinned to prior taxonomy version (if no API key):**

Create `packages/evals/baselines/README.md` noting:

- `*-anthropic-baseline.json` files were generated against the pre-cleanup taxonomy which included `other_category` and `other_priority`
- **Policy: taxonomy-version drift in historical baselines is intentionally accepted.** The eval comparison logic compares relative accuracy and regression gates, not absolute taxonomy values. Baselines pinned to an older taxonomy remain valid for detecting regressions within their dataset, but new baselines generated against the current taxonomy will produce different absolute numbers.
- Regeneration with the current taxonomy requires `ANTHROPIC_API_KEY`

### Step 3 — Archive or document v0.1 baselines

`hard-v0.1-baseline.json` and `ood-v0.1-baseline.json` are v0.1 artifacts superseded by the v1 datasets. They have the heaviest stale-value contamination (8 and 24 occurrences respectively).

**Option A — Delete them** if v1 baselines fully supersede them and no comparison path references them.

**Option B — Leave them** with a README note that v0.1 baselines are historical and pinned to the original taxonomy.

Check whether any code path references these files:

```bash
grep -r "v0.1-baseline" packages/evals/src/
```

If nothing references them programmatically, they are safe to either delete or document.

### Step 4 — Verify no stale values remain in active baselines

After steps 1-3, verify active baselines only (exclude archived v0.1 files if kept):

```bash
# Active baselines: fixture + provider promoted baselines
grep -l '"other_category"\|"other_priority"\|"other_maintenance_object"\|"other_management_category"\|"other_management_object"\|"other_issue"' \
  packages/evals/baselines/gold-v1-baseline.json \
  packages/evals/baselines/gold-v1-anthropic-baseline.json \
  packages/evals/baselines/hard-anthropic-baseline.json \
  packages/evals/baselines/regression-*.json
```

Target: zero matches. If v0.1 baselines were kept as archived, they are excluded from this check — their stale values are documented in the README as pinned to the prior taxonomy.

### Step 5 — Run eval tests

```bash
pnpm --filter @wo-agent/evals test
```

Verify all 78 eval tests still pass after any baseline changes.

---

## Acceptance Criteria

1. `gold-v1-baseline.json` regenerated with zero removed-value references.
2. Provider baselines either regenerated (Option A) or documented (Option B).
3. v0.1 baselines either removed or documented as historical.
4. All eval tests pass.

---

## Risk Assessment

| Risk                                                   | Likelihood | Mitigation                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture baseline regeneration changes metrics          | Low        | Fixture adapter uses expected values from dataset; the `other_maintenance_object` example is the known change, but aggregate and slice metrics are recomputed from all examples so minor shifts in summary numbers are possible |
| Provider baseline regeneration shifts accuracy numbers | Medium     | Expected — the LLM now has a smaller Category enum. Compare old and new baselines before promoting.                                                                                                                             |
| v0.1 baseline deletion breaks a reference              | Very Low   | Grep for references first. v0.1 datasets are historical.                                                                                                                                                                        |
