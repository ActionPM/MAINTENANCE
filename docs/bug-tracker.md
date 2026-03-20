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

| Field | Value |
| --- | --- |
| Tracker owner | ActionPM |
| Last updated | 2026-03-19 |
| Process source | `docs/bug-management.md` |

## Definitions

| Term | Definition |
| --- | --- |
| `Bug ID` | Stable identifier for one bug across the vault, tracker, plans, and reviews |
| `Vault Note` | The originating vault bug note used for intake and original report context |
| `Status` | Current lifecycle state for the bug under the status rules in `docs/bug-management.md` |
| `Severity` | Priority class based on impact and response expectations |
| `System Area` | Primary subsystem or workflow affected, such as classification, follow-ups, routing, or UI |
| `Failure Mode` | The type of failure, such as confidence gap, schema mismatch, missing option, state transition, or auth bug |
| `Cluster` | Shared theme or cross-bug grouping used during portfolio review |
| `Architectural Scope` | `isolated`, `recurring`, or `systemic` |
| `Repo Assessment` | Short authoritative technical diagnosis after repo review |
| `Maps To` | Semicolon-separated downstream artifacts tied to the bug |
| `Next Artifact` | The next concrete artifact that should be created or updated |
| `Last Reviewed` | Date the row was last checked against the current repo state |

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

| Severity | Meaning |
| --- | --- |
| `P0` | Security, data loss, production down, or emergency routing broken |
| `P1` | Core flow broken, explicit spec violation, or gold-test regression |
| `P2` | Degraded experience, confidence/quality issue, or missing capability |
| `P3` | Cosmetic, display, or minor UX issue |

## Summary Dashboard

| Status | Count |
| --- | --- |
| `LOGGED` | 0 |
| `REPO_REVIEWED` | 0 |
| `CLUSTERED` | 0 |
| `PLANNED` | 0 |
| `IN_PROGRESS` | 0 |
| `FIXED` | 3 |
| `VERIFIED` | 0 |
| `CLOSED` | 0 |
| `DEFERRED` | 0 |
| `DUPLICATE` | 0 |

## Row Template

| Bug ID | Vault Note | Summary | Status | Severity | System Area | Failure Mode | Cluster | Architectural Scope | Repo Assessment | Maps To | Next Artifact | Owner | Last Reviewed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BUG-000` | `_Vault path_` | `_One-line summary_` | `LOGGED` | `P2` | `_Area_` | `_Mode_` | `_Cluster or TBD_` | `isolated` | `_Short diagnosis_` | `_artifact-a; artifact-b_` | `_Next destination_` | `ActionPM` | `YYYY-MM-DD` |

## Active Bugs

| Bug ID | Vault Note | Summary | Status | Severity | System Area | Failure Mode | Cluster | Architectural Scope | Repo Assessment | Maps To | Next Artifact | Owner | Last Reviewed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BUG-001` | `ActionPM2/02_System/Bugs/BUG - No Heat Follow Up Questions.md` | No-heat follow-ups ask for maintenance confirmation and miss whole-unit coverage options | `FIXED` | `P2` | `classification / follow-ups` | `cue gap + follow-up option gap` | `confidence-coverage` | `systemic` | `Fixed: broadened Category.maintenance cues (+30 keywords, possessive regex), added entire_unit/multiple_rooms to taxonomy + constraints, added Rule 14 to follow-up prompt, added taxonomy-labels.json for display labels, added reg-021/022 regression cases.` | `packages/schemas/classification_cues.json; packages/schemas/taxonomy.json; packages/schemas/taxonomy-labels.json; packages/core/src/llm/prompts/followup-prompt.ts; packages/evals/datasets/regression/examples.jsonl` | `Verify in next demo cycle.` | `ActionPM` | `2026-03-19` |
| `BUG-002` | `ActionPM2/02_System/Bugs/BUG - Entering Service Requests Before Unit.md` | Message input visible before unit selection - user can submit and crash demo | `FIXED` | `P3` | `UI / chat shell` | `premature input visibility` | `demo-ux` | `isolated` | `Fixed: CREATE_CONVERSATION now returns unit_selected (single-unit, auto-resolved) or unit_selection_required (multi-unit/resolver-fail). Removed intake_started from INPUT_STATES. Updated startWithQueuedText to skip SELECT_UNIT when already unit_selected.` | `packages/core/src/orchestrator/action-handlers/create-conversation.ts; apps/web/src/components/chat-shell.tsx; apps/web/src/hooks/use-conversation.ts` | `Verify in next demo cycle.` | `ActionPM` | `2026-03-19` |
| `BUG-003` | `ActionPM2/02_System/Bugs/BUG - Wrong Follow Up Questions.md` | Toilet overflow asks to confirm maintenance and location - same cue gap as BUG-001 | `FIXED` | `P2` | `classification / follow-ups` | `cue gap - same confidence cluster as BUG-001` | `confidence-coverage` | `systemic` | `Fixed: shared fix with BUG-001. Category.maintenance cues now include overflow/overflowing/toilet. Location.suite regex catches possessive "my toilet". reg-023 regression case added.` | `packages/schemas/classification_cues.json; packages/evals/datasets/regression/examples.jsonl` | `Verify in next demo cycle.` | `ActionPM` | `2026-03-19` |
