# Bug Management

This document defines the canonical process for logging, reviewing, clustering, planning, fixing, and verifying bugs for the Work Order Agent.

Use it to keep bug handling disciplined, architecture-aware, and batch-oriented instead of reactive.

## Goals

- Capture each bug once with enough context to review it properly.
- Keep the vault useful for intake and working notes without making it the canonical technical tracker.
- Keep the repo authoritative for technical diagnosis, status, and downstream implementation links.
- Review bugs individually at intake, but prefer planning and remediation in portfolio batches.
- Ensure bugs turn into concrete follow-through artifacts instead of accumulating as disconnected notes.

## Canonical Artifacts

| Artifact               | Canonical path                                                       | Role                                                   |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Bug process            | `docs/bug-management.md`                                             | Authority for the workflow and rules in this document  |
| Bug tracker            | `docs/bug-tracker.md`                                                | Living canonical state for individual bugs             |
| Portfolio reviews      | `docs/bugs/reviews/`                                                 | Append-only point-in-time synthesis of the bug backlog |
| Vault bug template     | `ActionPM2/99_Templates/Note Templates/Template - Bug.md`            | Intake and working-draft note structure                |
| Vault bug process note | `ActionPM2/02_System/Bugs/PROC - Bug Intake and Portfolio Review.md` | Vault-facing explanation of how the workflow operates  |

## Authority Model

Use Option B.

- The vault bug note is the intake and working-draft surface.
- The vault `Agent Repo Review` section is filled once during intake review.
- Once a row exists in `docs/bug-tracker.md`, the vault `Agent Repo Review` section is frozen.
- After that point, the repo is authoritative for:
  - technical diagnosis,
  - severity,
  - status,
  - clustering,
  - downstream artifact mapping,
  - and closure state.

The vault still remains authoritative for the original report context:

- reporter description,
- screenshots,
- business impact,
- and expected behavior.

## Severity

| Severity | Criteria                                                                | Expected handling                                                        |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `P0`     | Security issue, data loss, production down, or emergency routing broken | Bypass batch review and act immediately                                  |
| `P1`     | Core flow broken, explicit spec violation, or gold-test regression      | Review next cycle and open a plan within 48 hours                        |
| `P2`     | Degraded experience, confidence/quality issue, or missing capability    | Keep in batch review flow and plan when clustered or otherwise justified |
| `P3`     | Cosmetic issue, display issue, or minor UX defect                       | Batch review and fix opportunistically                                   |

Severity is assigned during repo review and may be revised later if more evidence appears.

## Status Lifecycle

The canonical statuses are:

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

Valid lifecycle rules:

- New bugs start at `LOGGED`.
- Intake review moves a bug to `REPO_REVIEWED`.
- `CLUSTERED` is optional, not mandatory.
- Isolated bugs may move directly from `REPO_REVIEWED` to `PLANNED`.
- Duplicate bugs may move from `REPO_REVIEWED` to `DUPLICATE`.
- Bugs may move from `REPO_REVIEWED` to `DEFERRED` when the reason is explicit and bounded.
- `FIXED` means the code or config change exists.
- `VERIFIED` means the fix has been checked against the intended behavior and any required regression coverage.
- `CLOSED` means no more active work remains and the row is stable.

## Architectural Scope

Each bug must be labeled with one of these scopes:

- `isolated`
- `recurring`
- `systemic`

Use:

- `isolated` when the failure is local to one implementation path,
- `recurring` when multiple similar defects appear in the same subsystem or workflow,
- `systemic` when the backlog indicates a shared architectural, taxonomy, prompting, or process problem.

## Tracker Rules

`docs/bug-tracker.md` is the living source of truth for bug state.

Each bug row must include:

- a stable `Bug ID`,
- the vault note path,
- a one-line summary,
- status,
- severity,
- system area,
- failure mode,
- cluster,
- architectural scope,
- repo assessment,
- `Maps To`,
- next artifact,
- owner,
- and last reviewed date.

`Maps To` must support multiple targets separated by semicolons, for example:

`spec-gap/S14-03; plans/2026-03-20-cue-coverage; evals/regression/no-heat-category`

## Intake Review

Use the `bug-intake-review` skill for single-bug intake.

The intake workflow is:

1. A bug is logged in the vault with the bug template.
2. The agent reviews the repo from outside the vault.
3. The agent fills the vault `Agent Repo Review` section.
4. The agent creates or updates the row in `docs/bug-tracker.md`.
5. The vault `Agent Repo Review` section is frozen once the row exists.

The intake review does not:

- fix code,
- open implementation PRs,
- or automatically create a full remediation plan.

## Portfolio Review

Use the `bug-portfolio-review` skill for backlog synthesis.

The portfolio workflow is:

1. Read the open rows in `docs/bug-tracker.md`.
2. Compare them against:
   - `docs/spec.md`,
   - `docs/spec-gap-tracker.md`,
   - `docs/operational-readiness.md`,
   - relevant plans,
   - relevant RFCs,
   - eval artifacts,
   - and the current architecture.
3. Cluster bugs by subsystem, failure mode, and shared cause.
4. Identify duplicates and common failure patterns.
5. Publish a dated review under `docs/bugs/reviews/`.
6. Propose the downstream artifacts needed to address the cluster.

Portfolio reviews are append-only snapshots. They are historical analysis documents, not living trackers.

## Routing Rules

Every reviewed bug must map to at least one downstream artifact when it becomes actionable.

Typical destinations:

- `docs/spec-gap-tracker.md` for explicit spec contract failures,
- `docs/operational-readiness.md` for runtime hardening or deployment risk,
- `docs/plans/...` for implementation planning,
- `docs/rfcs/...` for architecture or governance changes,
- `packages/evals/datasets/regression/...` for regression coverage,
- or an issue-specific test file when the scope is intentionally narrow.

If a bug does not yet map anywhere, `Next Artifact` must state the expected next destination explicitly.

## Regression Rule

Every `P0` and `P1` bug that reaches `FIXED` must add a regression case before it can move to `VERIFIED`.

For `P2` and `P3` bugs, regression coverage is recommended but not mandatory unless the portfolio review or implementation plan explicitly requires it.

## Update Rules

Update `docs/bug-tracker.md`:

- when a new bug finishes intake review,
- when severity changes,
- when clustering changes,
- when a downstream artifact is created,
- when a fix starts,
- when a fix lands,
- and when verification or closure is completed.

If a PR fixes a bug but does not update the tracker row, that is a process failure.

## Review Cadence

Default cadence:

- Run intake review for each new bug note.
- Run portfolio review weekly, or sooner when five or more open bugs accumulate.
- Run portfolio review immediately when a new `P0` appears.
- Pull a `P1` into the next review cycle and create a plan within 48 hours.

## Launch Interaction

Launch decisions must consider the bug tracker.

- No open `P0` bug is acceptable for launch.
- Any open `P1` bug requires explicit named acceptance in the launch record.
- Bugs that indicate false emergency behavior, broken routing, broken ownership checks, or broken submission flow should be treated as launch blockers unless resolved or formally accepted.

## Portfolio Review Archive Rule

Files under `docs/bugs/reviews/` are append-only point-in-time outputs.

- Do not overwrite prior portfolio reviews as a way to represent current state.
- Correct factual errors if necessary, but do not repurpose an old review into a living document.
- The living state remains in `docs/bug-tracker.md`.

## Minimal Operating Standard

This process is working correctly only if:

- new bugs are logged in the vault with the template,
- every reviewed bug has one canonical tracker row,
- tracker rows are updated as work progresses,
- portfolio reviews analyze bugs together rather than in isolation,
- and actionable bugs map to concrete repo artifacts.
