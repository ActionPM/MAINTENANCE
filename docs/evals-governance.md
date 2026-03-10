# Categorization Eval Governance Rules

## 1. Allowed candidate change types
- Cue dictionary updates (adding keywords/regex patterns to `classification_cues.json`)
- Prompt updates (modifying classifier, splitter, or follow-up prompts)
- Confidence threshold/policy updates (adjusting `ConfidenceConfig` or `FieldPolicyMetadata`)
- Follow-up policy updates (adjusting caps, question templates)

## 2. Restricted change types
- Taxonomy changes require RFC, version bump, and downstream migration
- No production auto-tuning (all changes are offline, reviewed, and merged via PR)
- No unreviewed production data ingestion into eval datasets
- No changes to eval schemas without corresponding validator updates

## 3. Required refinement workflow
1. **Mine failure** — identify regression candidates from production events or eval failures
2. **Classify root cause** — categorize as: uncovered (missing cue), difficult (ambiguous input), noisy (conflicting signals), or taxonomy gap
3. **Propose smallest fix** — target the narrowest change (e.g., add 2 keywords vs. restructure the cue dictionary)
4. **Run candidate** — execute eval suite against the fixed datasets
5. **Merge criteria** — merge only if critical slices are flat or better (no regressions on emergency, access, pest, OOD slices)
6. **Update dataset** — add the regression example to the regression dataset after human review

## 4. Review requirements
- **Gold and hard datasets**: Single human review required for approval
- **OOD and high-risk examples**: Dual human review required before `approved_for_gate` status
- **Production-derived examples**: Must be hashed/redacted before check-in; dual review required
- **Regression dataset**: Single review, but reviewer must not be the person who proposed the fix

## 5. Version pinning
Every eval run records:
- `taxonomy_version` — which taxonomy was active
- `schema_version` — which eval schemas were used
- `cue_dict_version` — which cue dictionary version was used
- `prompt_version` — which prompt templates were used
- `model_id` — which LLM model was used

This enables exact reproduction of any eval run.

## 6. CI gate policy
- **Blocking gates**: Any regression on critical slices (emergency, building_access, pest_control, OOD routing) blocks merge
- **Warning gates**: Regressions on non-critical slices produce warnings but do not block
- **Schema/taxonomy invalid rate**: Any increase in schema-invalid or taxonomy-invalid output rates blocks merge
- **Contradiction-after-retry rate**: Any increase blocks merge

## 7. Dataset lifecycle
- `draft` → `reviewed` → `approved_for_gate`
- Only `approved_for_gate` examples participate in CI gate decisions
- `draft` and `reviewed` examples can be used for development but not for blocking merges
