---
name: bug-portfolio-review
description: Review the ActionPM bug backlog as a portfolio, compare the open bugs to the architecture and repo trackers, cluster related failures, and publish a dated synthesis in `docs/bugs/reviews/`. Use when multiple bugs have accumulated, when the user asks for batch analysis instead of bug-by-bug fixing, or when system-level remediation proposals are needed.
---

# Bug Portfolio Review

## Overview

Use this skill to analyze the bug backlog as a system, not as isolated notes.

The canonical inputs are repo artifacts, especially:

- `docs/bug-tracker.md`,
- `docs/bug-management.md`,
- `docs/spec.md`,
- `docs/spec-gap-tracker.md`,
- `docs/operational-readiness.md`,
- relevant plans,
- relevant RFCs,
- and relevant eval artifacts.

Do not fix code when using this skill unless the user explicitly expands the task.

## Workflow

### 1. Read the live backlog from the tracker

Start from `docs/bug-tracker.md`, not from unreviewed raw vault notes.

Focus on rows that are:

- `REPO_REVIEWED`,
- `CLUSTERED`,
- `PLANNED`,
- `IN_PROGRESS`,
- `FIXED`,
- or `DEFERRED`.

### 2. Build the architecture view

Compare the open bugs to the architecture and governance docs.

Look for:

- repeated failures in the same subsystem,
- contradictions between tracker rows and spec or operational docs,
- duplicate bugs,
- and symptoms that point to shared causes in prompts, schemas, constraints, eval coverage, or orchestration.

### 3. Cluster the backlog

Group bugs by:

- subsystem,
- failure mode,
- architecture layer,
- and shared remediation path.

Use cluster names that are stable enough to reuse in `docs/bug-tracker.md`.

### 4. Propose downstream artifacts

For each meaningful cluster, propose the next concrete artifact:

- `docs/spec-gap-tracker.md` rows,
- `docs/operational-readiness.md` rows,
- plans under `docs/plans/`,
- RFCs under `docs/rfcs/`,
- or regression cases under `packages/evals/datasets/regression/`.

Prefer system changes over piecemeal fixes when the evidence supports it.

### 5. Publish the portfolio review

Write a dated review in `docs/bugs/reviews/` using a filename like `YYYY-MM-DD-bug-portfolio-review.md`.

Treat the review as append-only historical context.

Do not overwrite an older review to represent current state.

### 6. Update tracker rows if needed

If the portfolio review changes cluster names, severity, or the intended downstream artifacts, update the affected rows in `docs/bug-tracker.md` in the same pass.

Do not use the review document itself as the living tracker.

## Review Output

A complete run should produce:

- a dated portfolio review document,
- updated tracker rows when clustering or routing changed,
- and a clear distinction between isolated bugs and systemic patterns.

## Typical Triggers

Use this skill for prompts like:

- "Review all open bugs together."
- "Compare these bugs to the architecture."
- "What system changes does the current bug backlog suggest?"
- "Cluster the current bugs and propose a plan."
