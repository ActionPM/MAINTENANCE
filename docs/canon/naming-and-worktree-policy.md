# Naming and Worktree Policy

## Purpose

Define naming, branch, task ID, and worktree rules for governed frontend work.

## Task IDs

- Format: `FE-###`
- One task ID per governed change set

## Branch naming

- Format: `feat/FE-042-short-name`
- Hotfix format: `fix/FE-042-short-name`

## Worktree rule

- One generator worktree per task
- Separate review worktree for medium/high-risk critic or auditor pass
- No persistent per-agent worktrees
- No multi-task worktrees

## Worktree directories

- Generator: `../wt/FE-042`
- Review: `../wt-review/FE-042-security`
- Audit: `../wt-review/FE-042-quality`

## Cleanup

- Delete review worktrees after merge decision
- Delete task worktree within 24 hours of merge
- Delete local branch after merge unless release-related

## Forbidden

- Direct work on `main`
- Multiple active tasks in one worktree
- Reviewing code from the same working tree used to author it
- Reusing stale review artifacts after new commits

## Merge implication

Violating this policy blocks merge for governed work.
