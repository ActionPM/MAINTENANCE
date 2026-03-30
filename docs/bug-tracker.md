# Bug Tracker

This is the canonical tracker for product and system bugs reviewed against the current repository state.

Use this file as the living source of truth for:

- bug status,
- severity,
- technical assessment,
- clustering,
- and downstream artifact mapping.

Process authority lives in `docs/bug-management.md`.

## Metadata

| Field          | Value                    |
| -------------- | ------------------------ |
| Tracker owner  | ActionPM                 |
| Last updated   | 2026-03-28               |
| Process source | `docs/bug-management.md` |

## Definitions

| Term                  | Definition                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Bug ID`              | Stable identifier for one bug across the vault, tracker, plans, and reviews                                 |
| `Vault Note`          | The originating vault bug note used for intake and original report context                                  |
| `Status`              | Current lifecycle state for the bug under the status rules in `docs/bug-management.md`                      |
| `Severity`            | Priority class based on impact and response expectations                                                    |
| `System Area`         | Primary subsystem or workflow affected, such as classification, follow-ups, routing, or UI                  |
| `Failure Mode`        | The type of failure, such as confidence gap, schema mismatch, missing option, state transition, or auth bug |
| `Cluster`             | Shared theme or cross-bug grouping used during portfolio review                                             |
| `Architectural Scope` | `isolated`, `recurring`, or `systemic`                                                                      |
| `Repo Assessment`     | Short authoritative technical diagnosis after repo review                                                   |
| `Maps To`             | Semicolon-separated downstream artifacts tied to the bug                                                    |
| `Next Artifact`       | The next concrete artifact that should be created or updated                                                |
| `Last Reviewed`       | Date the row was last checked against the current repo state                                                |

## Status Rules

Valid values:

- `LOGGED`
- `REPO_REVIEWED`
- `CLUSTERED`
- `PLANNED`
- `IN_PROGRESS`
- `FIXED`
- `VERIFIED`
- `CLOSED`
- `DEFERRED`
- `DUPLICATE`

Lifecycle notes:

- `CLUSTERED` is optional.
- `REPO_REVIEWED -> PLANNED` is valid for isolated bugs.
- `FIXED -> VERIFIED` requires actual verification, not just code merge.
- `P0` and `P1` rows cannot move to `VERIFIED` without required regression coverage.

## Severity Rules

| Severity | Meaning                                                              |
| -------- | -------------------------------------------------------------------- |
| `P0`     | Security, data loss, production down, or emergency routing broken    |
| `P1`     | Core flow broken, explicit spec violation, or gold-test regression   |
| `P2`     | Degraded experience, confidence/quality issue, or missing capability |
| `P3`     | Cosmetic, display, or minor UX issue                                 |

## Summary Dashboard

| Status          | Count |
| --------------- | ----- |
| `LOGGED`        | 0     |
| `REPO_REVIEWED` | 2     |
| `CLUSTERED`     | 0     |
| `PLANNED`       | 0     |
| `IN_PROGRESS`   | 0     |
| `FIXED`         | 5     |
| `VERIFIED`      | 0     |
| `CLOSED`        | 0     |
| `DEFERRED`      | 0     |
| `DUPLICATE`     | 0     |

## Row Template

| Bug ID    | Vault Note     | Summary              | Status   | Severity | System Area | Failure Mode | Cluster            | Architectural Scope | Repo Assessment     | Maps To                    | Next Artifact        | Owner      | Last Reviewed |
| --------- | -------------- | -------------------- | -------- | -------- | ----------- | ------------ | ------------------ | ------------------- | ------------------- | -------------------------- | -------------------- | ---------- | ------------- |
| `BUG-000` | `_Vault path_` | `_One-line summary_` | `LOGGED` | `P2`     | `_Area_`    | `_Mode_`     | `_Cluster or TBD_` | `isolated`          | `_Short diagnosis_` | `_artifact-a; artifact-b_` | `_Next destination_` | `ActionPM` | `YYYY-MM-DD`  |

## Active Bugs

| Bug ID    | Vault Note                                                                | Summary                                                                                  | Status  | Severity | System Area                   | Failure Mode                                   | Cluster               | Architectural Scope | Repo Assessment                                                                                                                                                                                                                                                  | Maps To                                                                                                                                                                                                                 | Next Artifact                | Owner      | Last Reviewed |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- | -------- | ----------------------------- | ---------------------------------------------- | --------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------- | ------------- |
| `BUG-001` | `ActionPM2/02_System/Bugs/BUG - No Heat Follow Up Questions.md`           | No-heat follow-ups ask for maintenance confirmation and miss whole-unit coverage options | `FIXED` | `P2`     | `classification / follow-ups` | `cue gap + follow-up option gap`               | `confidence-coverage` | `systemic`          | `Fixed: broadened Category.maintenance cues (+30 keywords, possessive regex), added entire_unit/multiple_rooms to taxonomy + constraints, added Rule 14 to follow-up prompt, added taxonomy-labels.json for display labels, added reg-021/022 regression cases.` | `packages/schemas/classification_cues.json; packages/schemas/taxonomy.json; packages/schemas/taxonomy-labels.json; packages/core/src/llm/prompts/followup-prompt.ts; packages/evals/datasets/regression/examples.jsonl` | `Verify in next demo cycle.` | `ActionPM` | `2026-03-19`  |
| `BUG-002` | `ActionPM2/02_System/Bugs/BUG - Entering Service Requests Before Unit.md` | Message input visible before unit selection - user can submit and crash demo             | `FIXED` | `P3`     | `UI / chat shell`             | `premature input visibility`                   | `demo-ux`             | `isolated`          | `Fixed: CREATE_CONVERSATION now returns unit_selected (single-unit, auto-resolved) or unit_selection_required (multi-unit/resolver-fail). Removed intake_started from INPUT_STATES. Updated startWithQueuedText to skip SELECT_UNIT when already unit_selected.` | `packages/core/src/orchestrator/action-handlers/create-conversation.ts; apps/web/src/components/chat-shell.tsx; apps/web/src/hooks/use-conversation.ts`                                                                 | `Verify in next demo cycle.` | `ActionPM` | `2026-03-19`  |
| `BUG-003` | `ActionPM2/02_System/Bugs/BUG - Wrong Follow Up Questions.md`             | Toilet overflow asks to confirm maintenance and location - same cue gap as BUG-001       | `FIXED` | `P2`     | `classification / follow-ups` | `cue gap - same confidence cluster as BUG-001` | `confidence-coverage` | `systemic`          | `Fixed: shared fix with BUG-001. Category.maintenance cues now include overflow/overflowing/toilet. Location.suite regex catches possessive "my toilet". reg-023 regression case added.`                                                                         | `packages/schemas/classification_cues.json; packages/evals/datasets/regression/examples.jsonl`                                                                                                                          | `Verify in next demo cycle.` | `ActionPM` | `2026-03-19`  |
| `BUG-004` | `ActionPM2/02_System/Bugs/BUG - Not classifying Maintenance as Maintenance.md` | Follow-up reclassification still asks maintenance vs management after plumbing evidence | `FIXED` | `P2`     | `classification / follow-ups` | `reclassification confidence ignores follow-up evidence` | `confidence-coverage` | `systemic`          | `Fixed: added buildEnrichedCueText helper that folds tenant follow-up answers into cue scoring corpus, wired into answer-followups handler. Category cue score now rises above gating threshold after maintenance evidence in follow-up answers. Added BUG-004 handler test, e2e integration test, and reg-024 regression row.` | `packages/core/src/classifier/cue-scoring.ts; packages/core/src/orchestrator/action-handlers/answer-followups.ts; packages/core/src/__tests__/followup/answer-followups.test.ts; packages/core/src/__tests__/followup/e2e-toilet-leak.test.ts; packages/evals/datasets/regression/examples.jsonl; docs/plans/2026-03-28-bug-004-006-remediation.md` | `Verify in next demo cycle.` | `ActionPM` | `2026-03-28`  |
| `BUG-005` | `ActionPM2/02_System/Bugs/BUG - Obvious Maintenance Follow-Up Questions Are Poorly Structured.md` | Obvious toilet-leak follow-ups restate known facts and ask for direct urgency self-rating | `REPO_REVIEWED` | `P2`     | `classification / follow-ups` | `follow-up question design asks for restatement and direct urgency self-assessment` | `followup-ux-policy` | `systemic`          | `Repo review found a broader follow-up UX/policy issue rather than a single classification miss. The system is optimized around one-question-per-field collection, which produces low-signal prompts like asking the tenant to restate that a toilet issue is a leak and asking for a direct urgency rating. There is also likely cue coverage debt for lexical variants like "leaky", but the larger problem is that the follow-up flow asks tenants to label already-known facts and to self-assess urgency directly instead of answering qualifying questions that support derived urgency.` | `packages/core/src/llm/prompts/followup-prompt.ts; packages/core/src/followup/followup-generator.ts; packages/schemas/classification_cues.json; packages/core/src/__tests__/followup; packages/evals/datasets/regression/examples.jsonl` | `Create a focused follow-up-policy plan for obvious maintenance issues, including qualifier-based urgency assessment and lexical coverage for phrases like "leaky".` | `ActionPM` | `2026-03-28`  |
| `BUG-006` | `ActionPM2/02_System/Bugs/Bug - Please review before submitting is confusing.md` | Confirmation summary shows unlabeled values and confusing N/A chips before submission | `FIXED` | `P3`     | `confirmation / UI`           | `confirmation summary renders unlabeled values and cross-domain N/A chips` | `confirmation-presentation` | `isolated`          | `Fixed: added field_labels to taxonomy-labels.json with getFieldLabel(), extended payload-builder with display_fields (ordered per TAXONOMY_FIELD_NAMES, not_applicable filtered, human-readable labels). Confirmation panel now renders labeled field/value rows with chip fallback. Added payload-builder display_fields tests and confirmation-panel tests for pest-control N/A filtering.` | `packages/schemas/taxonomy-labels.json; packages/schemas/src/taxonomy-labels.ts; packages/core/src/confirmation/payload-builder.ts; apps/web/src/components/confirmation-panel.tsx; apps/web/src/components/confirmation-panel.module.css; apps/web/src/components/__tests__/confirmation-panel.test.tsx; packages/core/src/__tests__/confirmation/payload-builder.test.ts; docs/plans/2026-03-28-bug-004-006-remediation.md` | `Verify in next demo cycle.` | `ActionPM` | `2026-03-28`  |
| `BUG-007` | `ActionPM2/02_System/Bugs/BUG - Incorrect, Redundant, Repetitive Questions.md` | Obvious faucet leak stayed underconfident, exhausted follow-up budget, and still required human review | `REPO_REVIEWED` | `P2`     | `classification / follow-ups` | `obvious maintenance issue remains underconfident, exhausts follow-up budget, and falls into human-triage confirmation` | `confidence-calibration` | `systemic`          | `Repo review found a mixed but coherent confidence problem. In the exact March 25 faucet work order, low Location confidence was caused by historical runtime pinning to cue_version 1.3.0, which lacked kitchen/my kitchen suite inference. But the broader issue is still current: the confidence heuristic gives only 0.6 cue_strength per direct hit and reserves the extra constraint-implied boost for empty or vague fields, so obvious single-hit fields like Maintenance_Object=faucet and Sub_Location=kitchen still settle around 0.68. In this real faucet flow, those scores combined with the current follow-up policy burned the full 9-question budget and escaped to confirmation with needs_human_triage=true.` | `packages/core/src/classifier/confidence.ts; packages/core/src/classifier/cue-scoring.ts; packages/core/src/classifier/constraint-resolver.ts; packages/schemas/classification_cues.json; packages/core/src/__tests__/classifier/confidence-integration.test.ts; packages/evals/datasets/regression/examples.jsonl` | `Create a focused confidence-calibration plan for obvious maintenance issues, including faucet-leak regression coverage and a decision on whether direct single-hit object/sub-location cues should score high without constraint implication.` | `ActionPM` | `2026-03-28`  |
