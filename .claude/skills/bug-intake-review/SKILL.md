---
name: bug-intake-review
description: Review one ActionPM bug note from the vault against the repo, classify the bug, fill the vault intake review block, and create or update the canonical row in `docs/bug-tracker.md`. Use when a new bug has been logged, when the user asks for a single-bug repo review from outside the vault, or when tracker intake needs to happen without fixing code.
---

# Bug Intake Review

## Overview

Use this skill to turn one raw vault bug note into one reviewed, canonical tracker entry.

Follow the authority split in `docs/bug-management.md`:

- the vault note is the intake and working-draft surface,
- the repo tracker row is the living technical source of truth,
- and the vault `Agent Repo Review` section freezes once the tracker row exists.

Do not fix code when using this skill.

## Workflow

### 1. Read the intake note and repo context

Read:

- the vault bug note,
- `docs/bug-management.md`,
- `docs/bug-tracker.md`,
- and the most relevant repo artifacts for the reported behavior.

Prefer direct evidence:

- source files,
- schemas,
- trackers,
- plans,
- evals,
- and tests.

Do not rely on vault text alone for the diagnosis.

### 2. Determine the canonical labels

Assign:

- `Severity`: `P0`, `P1`, `P2`, or `P3`
- `Status`: usually `REPO_REVIEWED` after intake
- `System Area`
- `Failure Mode`
- `Architectural Scope`: `isolated`, `recurring`, or `systemic`
- `Repo Assessment`: one short authoritative diagnosis
- `Maps To`: semicolon-separated targets if known
- `Next Artifact`: the concrete next destination if `Maps To` is not complete yet

Apply the severity rules from `docs/bug-management.md`.

### 3. Fill the vault `Agent Repo Review` section

Write the intake review into the vault note once.

Include:

- review date,
- reviewer,
- bug ID,
- repo branch or commit reviewed,
- system area,
- failure mode,
- severity,
- architectural scope,
- one-paragraph technical assessment,
- and tracker-row creation state.

Keep this section concise. It is a working draft that becomes frozen after the tracker row exists.

### 4. Create or update the tracker row

Add or update one row in `docs/bug-tracker.md`.

Rules:

- keep one row per bug,
- use a stable `Bug ID`,
- make `Maps To` multi-value with semicolons,
- update `Last updated` and summary counts when the tracker changes,
- and treat the tracker row as authoritative once created.

### 5. Freeze the vault review block

If the row now exists in `docs/bug-tracker.md`, do not continue revising the vault `Agent Repo Review` section on later status changes. Put later changes in the tracker row and downstream repo artifacts.

## Output Standard

The skill should leave behind:

- one reviewed vault bug note,
- one canonical tracker row,
- and no code changes outside the bug-tracking documents unless the task explicitly asks for them.

## Typical Triggers

Use this skill for prompts like:

- "Review this bug note against the repo."
- "Do intake on this bug and add it to the tracker."
- "Classify this one bug and log the issue."
- "Fill the agent section for this vault bug note."
