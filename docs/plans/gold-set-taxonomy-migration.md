# Gold-Set Taxonomy Migration Plan

**Date**: 2026-03-23
**Status**: Approved — ready for implementation
**Scope**: Behavior-first migration of taxonomy labeling discipline to match the 214-row gold set

---

## Executive Summary

The current classifier force-fills all 9 taxonomy fields on every issue. The gold set demands stricter evidence-based labeling: leave unsupported fields blank (omit the key), use `needs_object` intentionally as a routeable placeholder, normalize irrelevant cross-domain fields to `not_applicable`, and trigger structured follow-up for meaningful gaps.

The architecture is unchanged: split-first, schema-lock, deterministic orchestration, append-only events, version pinning, deterministic risk. What changes is prompts, cue dictionaries, post-processing, completeness policy, constraint resolution, and eval coverage.

No taxonomy.json changes. No DB migration. No taxonomy/work-order domain contract changes. `PinnedVersions` expands with `cue_version` — this is a public schema change affecting `work_order.schema.json` (`additionalProperties: false`, `$ref` to `PinnedVersions`) and the inline `pinned_versions` object in `orchestrator_action.schema.json`. Both schemas must be updated in Task 2.5.

---

## Resolved Decisions

These decisions were reviewed and approved by the product owner on 2026-03-23:

1. **Management issues do not need a Location.** Blank Location on management issues is accepted as-is — no follow-up triggered. The runtime aligns with the gold set on this point.

2. **`needs_object` always triggers follow-up on initial classification.** If the follow-up answer doesn't resolve it (tenant can't be more specific, or caps are exhausted), the request remains submittable with `needs_object` intact. This is a "try to clarify, but don't block" policy. **Gold-v1 policy override**: The gold set does not flag most `needs_object` rows for follow-up. The runtime intentionally diverges — the transpiler (Task 1.1) must rewrite `expected_followup_fields` to include `Maintenance_Object` or `Management_Object` for any row where the classification contains `needs_object`, regardless of the gold-set's `should_ask_followup` value. This override is documented in the gold-v1 manifest and the baseline peer-review notes.

3. **Cue dictionary version is a separate tracked artifact.** A `cue_version` field will be added to `PinnedVersions` alongside `prompt_version`, `taxonomy_version`, `model_id`, and `schema_version`. Independent change cadence enables isolated diagnostics, eval slicing by cue version, and cleaner scaling as cue sources grow. This is a public schema change (see Task 2.5).

4. **Splitter eval is deferred to a follow-up phase.** The classification/follow-up/completeness migration is the priority. Splitter eval moves to Phase 6 (post-stabilization). The gold-set transpiler still encodes `split_issues_expected` so the data is ready.

5. **Escape-hatch rate threshold is 15%.** Balances automation with pragmatism. If the gold-set sizing check (Task 3.3) shows the rate near or above 15% with current caps, caps are adjusted. Can tighten to 10% once the policy stabilizes with production data.

---

## Work Streams

Four parallel work streams, with dependency edges noted per task.

### Stream 1: Gold-Set Ingest & Eval Pipeline

### Stream 2: Classifier, Cue, and Constraint Behavior

### Stream 3: Completeness & Follow-Up Policy

### Stream 4: Runtime Metadata, Orchestration, and Compatibility

---

## Task Breakdown

### Stream 1: Gold-Set Ingest & Eval Pipeline

#### Task 1.1: Build CSV-to-JSONL transpiler
**Files**: New file `packages/evals/src/datasets/csv-transpiler.ts`
**Why**: The eval harness loads JSONL + manifest.json exclusively (`packages/evals/src/datasets/load-dataset.ts`). The 214-row gold-set CSV must be converted to `NormalizedExample` JSONL format.
**Details**:
- Skip the title row (row 1) and the column header row (row 2) — data starts at row 3
- Group rows by `source_message_id` to reconstruct multi-issue conversations — each group becomes one `NormalizedExample` with multiple `split_issues_expected` entries and 1:1-aligned `expected_classification_by_issue` entries
- Map blank taxonomy cells to **omitted keys** in the expected classification object (not empty strings, not `null`)
- Map `not_applicable` cells to the literal string `"not_applicable"` in the classification object
- Map `needs_object` cells to the literal string `"needs_object"`
- **Gold-v1 policy override for `needs_object` follow-up** (Decision 2): For any row where the expected classification contains `needs_object` in `Maintenance_Object` or `Management_Object`, set `expected_followup_fields` to include that object field with `followup_type: "object_clarification"`, regardless of the gold-set's `should_ask_followup` column value. For all other rows, derive `expected_followup_fields` directly from the gold-set `should_ask_followup` and `followup_type` columns as-is. Document this override in the gold-v1 `manifest.json` under a `policy_overrides` key.
- **`expected_needs_human_triage` derivation**: The gold-set CSV has no direct `needs_human_triage` column. For gold-v1, set `expected_needs_human_triage: false` for all rows. Rationale: the gold set represents classifiable issues; rows that would require human triage are not included. If a future gold-set version adds triage cases, revisit this mapping. Document this default in the manifest.
- Populate `slice_tags` from Category, Maintenance_Category, Priority, and any multi-issue flag
- Normalize the gold-set taxonomy_version string into the repo's semver format
- Discard eval-only columns (`gold_rationale`, `evidence_notes`, `ambiguity_notes`, `reporting_risk`, `review_status`, `reviewer`, `Confidence_Score`, `Confidence_Flag`) — do not include in runtime output
- Write output as JSONL + manifest.json to `packages/evals/datasets/gold-v1/`
**Tests**: Title-row stripping, multiline CSV rows, blank-vs-omitted-key handling, grouping by source_message_id, malformed/semver-incompatible metadata, round-trip validation against `validateEvalExample`, `needs_object` rows get `expected_followup_fields` override, all rows have `expected_needs_human_triage: false`
**Depends on**: Nothing
**Acceptance**: Transpiler produces valid JSONL that `loadDataset()` accepts; 214 atomic issues across all examples; blank cells become omitted keys; `needs_object` policy override applied; `expected_needs_human_triage` defaulted

#### Task 1.2: Wire follow-up metrics into eval runner
**Files**: `packages/evals/src/cli/run-eval.ts`, `packages/evals/src/metrics/followup-metrics.ts`
**Why**: `computeFollowupPrecision` and `computeFollowupRecall` exist in `followup-metrics.ts` but are not invoked by `run-eval.ts` (lines 60-75). The gold set includes `should_ask_followup`, `followup_type`, and `constraint_passed` — these must be scored.
**Details**:
- Import and call `computeFollowupPrecision` and `computeFollowupRecall` in `run-eval.ts`
- Add `followup_precision`, `followup_recall`, `constraint_pass_rate` to the `RunMetrics` type and output
- Add these metrics to the per-slice computation in `computeSliceMetrics`
- Add `should_ask_followup` accuracy and `followup_type` accuracy as separate metrics
- Update `compare-runs.ts` regression gate: `followup_precision` and `followup_recall` should be blocking-rate metrics (any decrease blocks merge on critical slices)
- Update baseline JSON schema to include the new metric fields
- Note: `needs_human_triage` is excluded from gold-v1 eval scoring (all expected values are `false`); the metric exists but will only become meaningful when triage cases are added to a future dataset
**Tests**: Verify metrics compute correctly with known expected vs actual follow-up fields; verify gate logic catches regressions; verify `needs_human_triage` metric degrades gracefully with all-false expectations
**Depends on**: Task 1.1 (needs gold-set examples with follow-up expectations)
**Acceptance**: `pnpm eval:run --dataset gold-v1` reports follow-up precision/recall alongside existing metrics

#### Task 1.3: Generate gold-v1 baseline
**Files**: `packages/evals/baselines/gold-v1-baseline.json`
**Why**: Regression gate needs a baseline to compare against. The first run after migration establishes it.
**Details**:
- Run full eval suite against gold-v1 dataset after all Stream 2 and 3 changes are complete
- Capture baseline with `pnpm eval:update-baseline`
- Baseline includes all existing metrics plus new follow-up metrics
- Peer-review note: document the `needs_object` follow-up policy override — the baseline will show follow-up triggered on `needs_object` rows even though the raw gold set did not flag them
**Depends on**: Tasks 1.1, 1.2, 2.1-2.5, 3.1-3.4, 4.2, 4.3a
**Acceptance**: Baseline JSON exists and regression gate passes on clean run

---

### Stream 2: Classifier, Cue, and Constraint Behavior

#### Task 2.1: Rewrite classifier prompt
**File**: `packages/core/src/llm/prompts/classifier-prompt.ts`
**Why**: `buildClassifierSystemPrompt()` (lines 7-71) currently instructs "Every classification field MUST use a value from the taxonomy above" and shows a JSON template with all 9 fields. This is the primary source of force-fill behavior.
**Details**:
- Replace rule 1 ("Every classification field MUST use a value") with evidence-based instructions:
  - "Only assign a taxonomy value when the tenant's text provides clear evidence for it"
  - "If the text does not support a field value, OMIT that field from the classification object entirely"
  - "Do not guess Location, Sub_Location, or object fields from weak or indirect evidence"
  - "A mentioned object does NOT automatically imply a location (e.g., 'sink' does not mean Location=suite)"
- Replace rules 2-3 (cross-domain normalization) with `not_applicable` as the standard:
  - "If the issue is maintenance, set Management_Category, Management_Object to 'not_applicable'"
  - "If the issue is management, set Maintenance_Category, Maintenance_Object, Maintenance_Problem to 'not_applicable'"
  - Remove legacy `other_mgmt_cat`/`other_maintenance_category` references from the prompt (validator still accepts them for old taxonomy versions)
- Add explicit `needs_object` guidance:
  - "Use 'needs_object' when the category/problem type is understood but the specific object cannot be identified from the text"
  - "Do not use 'needs_object' as a lazy default — use it only when there genuinely is an object involved but it is ambiguous"
- Update the JSON template to show fields as optional:
  - Show only `issue_id`, `classification: { ... }`, `model_confidence: { ... }`, `missing_fields`, `needs_human_triage`
  - Add comment: "Include only fields you can classify with evidence. Omit fields you cannot."
- Add guidance for `missing_fields`:
  - "List fields you omitted from classification because the text did not support a value"
  - "Also list fields where you assigned a value but have low certainty"
- Preserve the hierarchical constraints section as-is (still valid)
- Update the constrained-retry user message in `buildClassifierUserMessage()` (line 77+) to use `not_applicable` instead of `other_*` for cross-domain fields
- Bump `PROMPT_VERSION` constant in `packages/schemas/src/version-pinning.ts` (used by version pinning)
**Tests**: Unit tests for prompt construction; integration tests verifying the classifier omits unsupported fields rather than guessing
**Depends on**: Nothing
**Acceptance**: Prompt no longer instructs force-fill; cross-domain fields use `not_applicable`; `PROMPT_VERSION` bumped

#### Task 2.2: Update classifier adapter post-processing
**File**: `packages/core/src/llm/adapters/classifier-adapter.ts`
**Why**: The adapter may normalize or fill missing fields after LLM response. Post-processing must align with the new "omit unsupported fields" policy.
**Details**:
- Ensure the adapter does NOT add default values for omitted taxonomy fields
- Ensure `missing_fields` in the LLM response is merged with fields omitted from `classification` — if a field is absent from the classification object, it should appear in `missing_fields`
- Verify schema validation accepts partial `classification` objects (it should — `additionalProperties: { "type": "string" }` map)
- Do NOT change the schema itself — omitted keys are already valid
**Tests**: Adapter correctly passes through partial classifications; omitted fields appear in `missing_fields`
**Depends on**: Task 2.1 (prompt changes determine what the LLM outputs)
**Acceptance**: A classification with 5 of 9 fields passes validation; omitted fields are in `missing_fields`

#### Task 2.3: Audit and fix cue dictionaries
**Files**: `packages/schemas/classification_cues.json`, `packages/core/src/classifier/cue-scoring.ts`
**Why**: Cue scoring has 0.40 weight in the confidence formula. If cues map "sink" -> `Location: suite` or "toilet" -> `Sub_Location: bathroom`, they reinforce overfill even with a corrected prompt.
**Details**:
- Audit every Location and Sub_Location cue entry for object-to-location shortcuts:
  - Remove or downweight cues that infer location from object mentions (e.g., "sink" should NOT cue `Location: suite` — sinks exist in multiple locations)
  - Remove or downweight cues that infer sub-location from object mentions (e.g., "toilet" should NOT cue `Sub_Location: bathroom` without other evidence)
- Audit Maintenance_Object cues to ensure they don't implicitly set location fields
- Keep Category, Priority, and Maintenance_Category/Problem cues as-is (these are generally evidence-based)
- Keep emergency/safety cues intact — these are orthogonal overlays
- Document each removed/changed cue with rationale
- Bump cue dictionary version in `classification_cues.json`
**Tests**: Cue scoring for "my sink is leaking" should NOT produce high Location or Sub_Location scores; "toilet is clogged" should produce high Maintenance_Object and Problem scores but not Location
**Depends on**: Nothing
**Acceptance**: No object-to-location shortcuts remain; cue dictionary version bumped; existing non-location cues unchanged

#### Task 2.4: Fix constraint resolver for needs_object persistence
**File**: `packages/core/src/classifier/constraint-resolver.ts`
**Why**: `VAGUE_VALUES` set (line 5) includes `needs_object`, so `resolveConstraintImpliedFields()` (line 54) will overwrite `needs_object` with a specific value when constraints narrow to exactly one option. Per Decision 2, `needs_object` should persist and trigger follow-up instead.
**Details**:
- Remove `needs_object` from `VAGUE_VALUES` set
- `needs_object` should only be overwritten when:
  - Follow-up answers provide specific object information, OR
  - The classifier explicitly upgrades it on reclassification after new information
- `needs_object` should NOT be overwritten by constraint resolution alone
- Keep `general` and `other_sub_location` in `VAGUE_VALUES` (these are still vague defaults worth auto-resolving)
- Add a comment explaining the policy distinction: `needs_object` is intentional and triggers follow-up; `general` is a fallback subject to auto-resolution
**Tests**: Classification with `Maintenance_Category: "plumbing"` and `Maintenance_Object: "needs_object"` — constraint resolver should NOT auto-resolve to a specific plumbing object; it should leave `needs_object` in place
**Depends on**: Nothing
**Acceptance**: `needs_object` persists through constraint resolution; `general` still gets auto-resolved

#### Task 2.5: Add cue_version to PinnedVersions and public schemas
**Files**:
- `packages/schemas/src/version-pinning.ts` (PinnedVersions interface + `resolveCurrentVersions` + `assertPinnedVersionsIntact`)
- `packages/schemas/work_order.schema.json` (PinnedVersions definition, `additionalProperties: false`)
- `packages/schemas/orchestrator_action.schema.json` (inline `pinned_versions` object)
- `packages/schemas/src/types/work-order.ts` (WorkOrder type if PinnedVersions is referenced)
- `packages/schemas/src/types/orchestrator-action.ts` (if PinnedVersions is referenced)
**Why**: Decision 3 — cue dictionary version is a separate tracked artifact. This is a **public schema change**: `PinnedVersions` is `$ref`'d by `work_order.schema.json` with `additionalProperties: false`, and used inline in `orchestrator_action.schema.json`. Adding `cue_version` without updating these schemas will break validation of WOs and orchestrator actions.
**Details**:
- Add `cue_version: string` to `PinnedVersions` interface in `version-pinning.ts`
- Add `CUE_VERSION` constant, initialized from `classification_cues.json` version field (currently `1.2.0`)
- Update `resolveCurrentVersions()` to include `cue_version: CUE_VERSION`
- Update `assertPinnedVersionsIntact()` to validate `cue_version` field
- Add `"cue_version": { "type": "string" }` to the `PinnedVersions` definition in `work_order.schema.json` and add it to `required`
- Add `"cue_version": { "type": "string" }` to the inline `pinned_versions` object in `orchestrator_action.schema.json`
- Update any TypeScript types that mirror these schemas
- **Historical work-order compatibility**: Persisted WOs in `work_orders.pinned_versions` (JSONB column, migration `004-work-orders.sql`) are read back verbatim in `pg-wo-store.ts` (line 165) and returned through API routes. Old rows will not have `cue_version`. Strategy: **normalize on read** — in the row-mapping function in `pg-wo-store.ts`, if `pinned_versions.cue_version` is missing, inject `"1.2.0"` (the pre-migration cue dictionary version) before returning the `WorkOrder` object. Do NOT backfill old rows (append-only discipline). Do NOT make `cue_version` optional in the schema — normalize on read so the rest of the system sees a consistent shape.
- Ensure resumed conversations without `cue_version` (pre-migration) get the same default (`"1.2.0"`) so `assertPinnedVersionsIntact` doesn't reject them
**Tests**: New conversation pins `cue_version`; resumed pre-migration conversation gets default `cue_version`; WO validation passes with `cue_version`; orchestrator action validation passes with `cue_version`; historical WO read from Postgres without `cue_version` gets `"1.2.0"` injected on read; API response includes `cue_version` for both old and new WOs
**Depends on**: Nothing
**Acceptance**: `cue_version` in PinnedVersions interface, both JSON schemas, and runtime resolution; backward-compatible for pre-migration sessions and historical work orders via normalize-on-read

---

### Stream 3: Completeness & Follow-Up Policy

#### Task 3.1: Implement completeness gate
**Files**: New file `packages/core/src/classifier/completeness-gate.ts`, modifications to `packages/core/src/classifier/confidence.ts`
**Why**: The current system triggers follow-up only via confidence bands + `missing_fields`. The gold set requires blank meaningful fields to trigger follow-up regardless of confidence score. This must be a separate gate that runs BEFORE confidence-band logic, not a modification to confidence scoring.
**Details**:
- Create `completeness-gate.ts` with a `checkCompleteness()` function:
  - Input: `classification` (partial Record), `category` (maintenance/management), `completenessPolicy` (configurable)
  - Output: `{ complete: boolean, incompleteFields: string[], followupTypes: Record<string, string> }`
  - Domain-specific completeness rules:
    - **Maintenance issues**: require Category, Priority; treat blank Location, Sub_Location, Maintenance_Object as follow-up-eligible when they affect routing or manager clarity; `needs_object` is **always follow-up-eligible** (Decision 2) — the system asks for clarification, but the request can still be submitted if follow-up fails to yield a specific object
    - **Management issues**: require Category, Priority; normalize Maintenance_Category/Object/Problem to `not_applicable` (not follow-up-eligible); blank Location is **accepted as-is** — no follow-up triggered (Decision 1)
    - **Both**: cross-domain `not_applicable` fields are never follow-up-eligible
  - Follow-up type derivation per field:
    - Blank Location/Sub_Location -> `followup_type: "location"` (maintenance only)
    - `needs_object` -> `followup_type: "object_clarification"` (always, per Decision 2)
    - Other blanks -> `followup_type: "other"`
  - Submittability rule for `needs_object`: if follow-up doesn't resolve it (caps exhausted or tenant can't clarify), the issue remains submittable with `needs_object` intact — do NOT escalate to `needs_human_triage` solely because `needs_object` persists
- Modify `determineFieldsNeedingInput()` in `confidence.ts` (line 153):
  - Run completeness gate FIRST — collect `incompleteFields`
  - Then run existing confidence-band logic ONLY on fields that ARE populated in the classification
  - Merge results: `incompleteFields` (from completeness) + low/medium-confidence populated fields (from bands) = total `fieldsNeedingInput`
  - Exclude cross-domain `not_applicable` fields from both gates (already handled by category gating at line 182)
- Export `DEFAULT_COMPLETENESS_POLICY` config object with the domain-specific rules
**Tests**:
  - Maintenance issue with blank Location -> `incompleteFields` includes Location, `followupType` = "location"
  - Management issue with blank Location -> NOT in `incompleteFields` (Decision 1)
  - Management issue -> Maintenance_Category/Object/Problem NOT in `incompleteFields` (they're `not_applicable`, not "blank")
  - `needs_object` on any maintenance issue -> IN `incompleteFields` with type "object_clarification" (Decision 2)
  - `needs_object` after failed follow-up -> issue still submittable, NOT escalated to `needs_human_triage`
  - Confidence bands still apply to populated fields independently
**Depends on**: Nothing (but integrates with Task 3.2)
**Acceptance**: Completeness gate runs before confidence bands; blank meaningful fields trigger follow-up per domain rules; `not_applicable` never triggers follow-up; `needs_object` always triggers follow-up but doesn't block submission

#### Task 3.2: Update confidence to exclude omitted fields
**File**: `packages/core/src/classifier/confidence.ts`
**Why**: `computeAllFieldConfidences()` (line 74) iterates `Object.keys(classification)` — so omitted fields already won't get a confidence score. But `determineFieldsNeedingInput()` (line 153) iterates `Object.entries(opts.confidenceByField)` and won't see omitted fields either. The gap: omitted fields fall through both gates silently. Task 3.1's completeness gate catches them, but we need to verify the integration.
**Details**:
- Confirm `computeAllFieldConfidences` only computes scores for keys present in `classification` — no change needed if so (verified: line 78 iterates `Object.keys(classification)`)
- Confirm `determineFieldsNeedingInput` only processes fields with confidence scores — verified (line 158)
- Integration: after Task 3.1, the call site in `start-classification.ts` must call completeness gate separately and merge results
- **Key insight**: The confidence formula stays focused on populated predictions. Omitted fields are handled entirely by the completeness gate. No formula change needed.
**Tests**: Classification with 5 of 9 fields -> confidence computed for 5 fields only; no NaN/undefined for missing fields; completeness gate catches the other 4
**Depends on**: Task 3.1
**Acceptance**: Confidence formula unchanged; omitted fields handled exclusively by completeness gate

#### Task 3.3: Follow-up cap sizing check
**Files**: `packages/core/src/followup/caps.ts`, potentially `packages/schemas/src/confidence-config.ts` (FollowUpCaps)
**Why**: Current caps: max 3 questions/turn, max 8 turns, question budget. The new completeness policy may trigger follow-up more frequently (blank maintenance fields + `needs_object` always asked). Need to verify caps produce an escape-hatch rate below 15% (Decision 5).
**Details**:
- Analyze the 214 gold-set rows: count how many trigger `should_ask_followup = true`; compute distribution of `followup_type`; count `needs_object` rows that will now trigger follow-up under Decision 2
- Compute expected follow-up questions per conversation under the new policy
- Compare against current caps: measure projected escape-hatch rate
- If escape-hatch rate >= 15%, propose adjusted cap values with justification
- If escape-hatch rate < 15%, keep current caps unchanged
- Document the analysis with numbers
- The 15% threshold can be tightened to 10% once the policy stabilizes with production data
- Note on escape-hatch behavior: the current escape hatch transitions to `tenant_confirmation_pending` (not a triage state) with `needs_human_triage: true` flags on individual issues. The conversation still proceeds to confirmation — it is not blocked. The 15% threshold measures how often issues arrive at confirmation with unresolved follow-up, not how often conversations are abandoned.
**Tests**: Simulated replay of gold-set conversations under new policy; measure escape-hatch rate
**Depends on**: Tasks 1.1 (gold-set data), 3.1 (completeness policy)
**Acceptance**: Escape-hatch rate documented; caps confirmed adequate (< 15%) or adjusted with justification

#### Task 3.4: Update follow-up prompt for typed follow-ups
**Files**: `packages/core/src/llm/prompts/followup-prompt.ts`, `packages/core/src/followup/followup-generator.ts`
**Why**: Follow-up generation should produce minimum targeted questions based on the specific `followup_type` rather than generic clarification requests.
**Details**:
- Pass `followup_type` per field to the follow-up generator input
- Update the follow-up prompt to generate type-specific questions:
  - `"location"` -> "Where in your unit/building is this issue?" or similar location-scoping question
  - `"object_clarification"` -> "Can you describe the specific [fixture/item] involved?" (for `needs_object` cases per Decision 2)
  - `"other"` -> general clarification
- Generate the minimum question needed per type — one targeted question, not broad
- Preserve existing schema validation and retry logic
**Tests**: Location-type follow-up produces location-scoped question; object-type produces object-scoped question; no extraneous questions generated
**Depends on**: Task 3.1 (provides `followup_type` per field)
**Acceptance**: Follow-up questions are typed and targeted; schema validation still passes

---

### Stream 4: Runtime Metadata, Orchestration, and Compatibility

#### Task 4.1: Add internal classification metadata
**Files**: `packages/core/src/session/types.ts` (IssueClassificationResult), `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Why**: The plan requires `should_ask_followup`, `followup_type`, and `constraint_passed` as runtime-internal metadata on each classified issue. These support eval scoring and audit without changing public DTOs beyond what Task 2.5 already covers.
**Details**:
- Extend `IssueClassificationResult` (session/types.ts line 16) with:
  ```typescript
  readonly shouldAskFollowup: boolean;
  readonly followupTypes: Record<string, string>; // field -> followup_type
  readonly constraintPassed: boolean;
  ```
- Populate these fields in `handleStartClassification()` after completeness gate and confidence analysis:
  - `shouldAskFollowup` = `fieldsNeedingInput.length > 0`
  - `followupTypes` = from completeness gate output
  - `constraintPassed` = `!output.needs_human_triage && hierarchyResult.valid`
- These fields are stored in session state (already flexible JSON) and emitted in events
- Do NOT add to `WorkOrder` schema, API responses, or `ConversationSnapshot`
- Do NOT add `gold_rationale`, `evidence_notes`, `ambiguity_notes`, `reporting_risk`, `review_status`, `reviewer`, `Confidence_Score`, or `Confidence_Flag` to any runtime structure
**Tests**: Classification result includes the three new metadata fields; they appear in session state; they do NOT appear in WO or API output
**Depends on**: Task 3.1 (completeness gate provides the data)
**Acceptance**: Metadata stored internally; not leaked to public contracts

#### Task 4.2: Integrate completeness gate into start-classification handler
**File**: `packages/core/src/orchestrator/action-handlers/start-classification.ts`
**Why**: The handler (line 69) is the integration point where classifier output flows through constraint resolution, confidence analysis, and follow-up decisions. The completeness gate must be inserted into this pipeline.
**Details**:
- After constraint resolution and before `determineFieldsNeedingInput()`:
  1. Call `checkCompleteness(output.classification, category, completenessPolicy)`
  2. Compute confidence for populated fields only (existing `computeAllFieldConfidences`)
  3. Call `determineFieldsNeedingInput()` with confidence results (only for populated fields)
  4. Merge: completeness-gate incomplete fields + confidence-gate fields = total `fieldsNeedingInput`
- When management Category is confident:
  - Auto-normalize Maintenance_Category/Object/Problem to `not_applicable` in post-processing if classifier didn't already
  - These fields should NOT trigger follow-up (they're irrelevant, not "blank")
  - Blank Location is accepted — no follow-up (Decision 1)
- When maintenance Category is confident:
  - Auto-normalize Management_Category/Object to `not_applicable`
  - `needs_object` triggers follow-up (Decision 2)
- `needs_object` submittability: if follow-up caps exhaust while `needs_object` is still unresolved, the existing escape hatch transitions to `tenant_confirmation_pending` with `needs_human_triage: true` on the issue — the conversation proceeds, it is not blocked. This is already the correct behavior for `needs_object` under Decision 2.
- Preserve existing flow: hierarchical validation -> constrained retry -> confidence -> follow-up generation -> caps check -> escape hatch
- The completeness gate adds a step between constraint resolution and confidence, not a replacement
**Tests**: End-to-end: message with no location evidence -> completeness gate flags Location (maintenance only) -> follow-up generated for location; management message with no location -> no follow-up for location; `needs_object` -> follow-up asked -> caps exhausted -> transitions to `tenant_confirmation_pending` with `needs_human_triage` flag
**Depends on**: Tasks 2.1, 2.2, 2.4, 3.1, 3.2, 4.1
**Acceptance**: Pipeline runs in correct order; completeness gate fires before confidence; cross-domain normalization happens automatically; management Location not flagged; `needs_object` follow-up is best-effort

#### Task 4.3: Version-aware adapter factory and prompt dispatch
**Files**:
- `packages/core/src/llm/adapters/classifier-adapter.ts` (prompt selection)
- `packages/core/src/llm/adapters/followup-adapter.ts` (prompt selection)
- `packages/core/src/llm/create-llm-deps.ts` (factory wiring)
- `packages/core/src/orchestrator/action-handlers/start-classification.ts` (handler dispatch)
- `packages/core/src/orchestrator/action-handlers/answer-followups.ts` (handler dispatch)
- `packages/schemas/src/version-pinning.ts` (PROMPT_VERSION bump)
**Why**: The current `createClassifierAdapter()` captures the system prompt **once** at adapter creation time (line 21: `const systemPrompt = buildClassifierSystemPrompt(taxonomy);`) and closes over it. The handler cannot switch prompts per-conversation without changing this architecture. Similarly, `createFollowUpAdapter()` captures its prompt at creation. Version-gated behavior requires the adapter or the call site to select the prompt dynamically based on `session.pinned_versions.prompt_version`.
**Details**:
- Modify `createClassifierAdapter` to build the system prompt per-call instead of closing over one prompt at creation time. The adapter reads `input.prompt_version` (already available on `IssueClassifierInput`) to select old vs new prompt. Same for `createFollowUpAdapter`.
  - In `classifier-adapter.ts`: change from `const systemPrompt = buildClassifierSystemPrompt(taxonomy);` (captured once at line 21) to building the prompt inside the returned function, branching on `input.prompt_version`
  - In `followup-adapter.ts`: same pattern — build prompt per call based on version
  - `create-llm-deps.ts`: no change needed — the factory still creates one adapter per tool; the adapter itself is now version-aware
  - _Rejected alternative_: creating two adapters in `createLlmDependencies()` and having handlers select based on pinned version. This is more complex and spreads version logic across the factory and handlers instead of keeping it in the adapter.
- Completeness gate dispatch: in `handleStartClassification` and `handleAnswerFollowups`, check `session.pinned_versions.prompt_version`:
  - Old prompt_version: skip completeness gate (old force-fill behavior)
  - New prompt_version: apply completeness gate
- Cue version dispatch: check `session.pinned_versions.cue_version` (with fallback for pre-migration sessions) to select cue scoring behavior if needed
- Bump `PROMPT_VERSION` in `version-pinning.ts`
- Document version boundary in code comments
**Tests**: Resumed conversation with old prompt_version -> adapter builds old prompt, completeness gate skipped; new conversation -> adapter builds new prompt, completeness gate applied; no cross-contamination; pre-migration session without `cue_version` -> fallback default works
**Depends on**: Tasks 2.1, 2.5, 3.1
**Acceptance**: Old conversations unaffected; new conversations use evidence-based classification; adapter builds prompt per-call based on version

#### Task 4.4: Regression test suite
**Files**: New and modified tests across `packages/core/src/classifier/`, `packages/core/src/followup/`, `packages/core/src/orchestrator/action-handlers/`
**Why**: Comprehensive regression coverage for the behavior changes.
**Details**:
- **No weak-evidence inference**: "my sink is leaking" -> classifier should NOT set Location=suite or Sub_Location=kitchen
- **Blank triggers follow-up (maintenance)**: maintenance message with no location info -> Location omitted from classification -> completeness gate triggers follow-up
- **Blank Location accepted (management)**: management message with no location info -> Location omitted -> no follow-up triggered (Decision 1)
- **needs_object always triggers follow-up**: classification with `Maintenance_Object: "needs_object"` -> follow-up asked for object clarification (Decision 2)
- **needs_object submittable after cap exhaustion**: follow-up caps exhausted with `needs_object` still present -> transitions to `tenant_confirmation_pending` with `needs_human_triage: true` flag on issue (not blocked, not routed to a triage state)
- **needs_object persistence**: constraint resolver does NOT overwrite `needs_object`
- **Management normalization**: management issue -> Maintenance_Category/Object/Problem = `not_applicable`; maintenance fields -> no follow-up
- **Confidence with omitted fields**: 5-field classification -> confidence computed for 5 fields only; no errors
- **Cap exhaustion at 15% threshold**: simulation where completeness gate triggers many follow-ups -> caps respected -> escape hatch fires correctly, transitions to `tenant_confirmation_pending`
- **Emergency/safety separation**: emergency issue -> deterministic escalation fires regardless of taxonomy completeness
- **Pinned conversation compat**: old-version session -> adapter builds old prompt, completeness gate skipped; new-version session -> adapter builds new prompt, completeness gate applied
- **cue_version pinning**: conversation pins cue_version at creation; resumed conversation uses pinned cue_version; pre-migration session gets default cue_version
- **PinnedVersions schema**: WO with cue_version passes validation; WO without cue_version (pre-migration) handled gracefully
**Depends on**: All Stream 2 and 3 tasks, Task 4.3
**Acceptance**: All regression tests pass; existing test suite still passes

---

## Execution Order

**Phase 1 — Foundation (no behavioral changes)**:
- Tasks 1.1, 2.3, 2.4, 2.5 (can run in parallel — CSV transpiler, cue audit, constraint resolver fix, cue_version in PinnedVersions + public schemas)

**Phase 2 — Classifier behavior change**:
- Task 2.1 (prompt rewrite)
- Task 2.2 (adapter post-processing)
- These change what the LLM outputs but don't yet change follow-up policy

**Phase 3 — Completeness & follow-up policy**:
- Task 3.1 (completeness gate — core logic)
- Task 3.2 (confidence integration verification)
- Task 3.4 (typed follow-up prompts)
- Task 4.1 (runtime metadata)
- Task 4.2 (handler integration — ties it all together)

**Phase 4 — Compatibility & eval**:
- Task 4.3 (version-aware adapter factory + prompt dispatch)
- Task 1.2 (wire follow-up metrics into eval)
- Task 3.3 (cap sizing at 15% threshold — needs gold-set analysis + completeness policy)

**Phase 5 — Baseline & regression**:
- Task 4.4 (regression test suite)
- Task 1.3 (generate gold-v1 baseline — final step)

**Phase 6 — Deferred: Splitter Eval** (post-stabilization):
- Build `split-replay.ts` runner
- Add `--eval-splits` flag to `run-eval.ts`
- Metrics: `split_count_accuracy`, `split_text_similarity`
- Data is ready (Task 1.1 encodes `split_issues_expected`)

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Classifier produces too many omitted fields (over-blanking) | Follow-up overload, poor UX | Prompt tuning + cap sizing check (Task 3.3); escape hatch preserves safety |
| Cue audit removes too aggressively | Confidence drops on previously-correct classifications | Audit against gold set, not just theory; keep non-location cues intact |
| Completeness gate + confidence bands double-trigger | Same field flagged by both gates | Merge logic deduplicates; completeness handles blanks, confidence handles populated fields |
| Old conversation compat breaks | Resumed conversations behave differently | Version-aware adapter (Task 4.3) gates all new behavior by prompt_version + cue_version |
| `needs_object` follow-up too aggressive | Extra questions for routeable issues | Follow-up is best-effort; submission not blocked if unresolved |
| Eval baseline mismatches gold set on `needs_object` rows | False failures in regression gate | Task 1.1 applies explicit policy override; documented in manifest and baseline notes |
| PinnedVersions schema change breaks existing consumers | WO or orchestrator action validation failures | Task 2.5 updates both JSON schemas; pre-migration sessions get default `cue_version`; historical WOs normalized on read in `pg-wo-store.ts` |
| Follow-up caps exhausted more frequently | More issues reach confirmation with `needs_human_triage` flags | Task 3.3 sizing check at 15% threshold; escape hatch routes to `tenant_confirmation_pending`, not a blocking state |

---

## Assumptions

- "Runtime metadata" = internal live-control state in session/events. "Eval-only guidance" = columns for scoring/review only.
- `should_ask_followup`, `followup_type`, `constraint_passed` are runtime-internal. All other gold-set metadata columns remain eval-only.
- No relational DB migration in this phase (classification stored in flexible JSON/JSONB).
- taxonomy.json stays unchanged; `taxonomy_version` does not bump.
- Validators continue rejecting empty strings; blanks are represented as omitted keys.
- `cue_version` is a separate tracked artifact pinned per conversation. This is a public schema change to `PinnedVersions`. Historical work orders without `cue_version` are normalized on read (inject `"1.2.0"`), not backfilled.
- Escape-hatch rate threshold is 15%; can tighten to 10% after production stabilization.
- `expected_needs_human_triage` is `false` for all gold-v1 rows (no triage cases in the gold set).
- Gold-v1 eval expectations for `needs_object` follow-up are rewritten by the transpiler to match Decision 2, not the raw gold-set `should_ask_followup` values.
- The escape hatch transitions to `tenant_confirmation_pending` with `needs_human_triage` flags on issues — it does not route to a separate triage state or block the conversation.
