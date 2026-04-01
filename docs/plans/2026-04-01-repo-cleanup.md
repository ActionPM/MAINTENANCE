# Implementation Plan: Repo Working Tree Cleanup

> **Status:** Draft
> **Date:** 2026-04-01
> **Context:** The working tree has ~80 unstaged modified files and ~22 untracked files spanning 7+ work items accumulated across several sessions. Two commits are unpushed. Goal: commit everything in clean logical groups, push, and leave the tree spotless.

---

## Current State

- **Branch:** `main`, 2 commits ahead of `origin/main`
- **Unpushed:** `5d1396c style: format Prettier drift` + `eefca0c fix: address bug-004 follow-up confidence and bug-006 confirmation summary`
- **Typecheck:** Clean
- **Tests:** 199 test files, all passing
- **Formatting:** 77 files need `pnpm format`

## Work Items in the Tree

Analysis of `git diff` shows these intertwined work items:

| Work Item             | Description                                                                                                                | Files                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Taxonomy cleanup**  | Remove stale `other_*` placeholder values from schemas, constraints, prompts, tests                                        | ~8 source + many tests   |
| **Bug-009**           | Follow-up ordering (Phase 1), answer pinning (Phase 2), stale descendant invalidation (Phase 3)                            | ~15 source + ~12 tests   |
| **Bug-011**           | Deterministic fallback questions, hint threshold 10→25, Sub_Location auto-accept gating, Maintenance_Object risk relevance | ~8 source + ~8 tests     |
| **Bug-004 follow-up** | Cue enrichment from follow-up answers, recoverable-vs-unrecoverable triage routing                                         | ~4 source + ~6 tests     |
| **Bug-006 follow-up** | Confirmation panel UX: human-readable labels, "submit for review" copy variant                                             | ~3 source + ~3 tests     |
| **Eval refresh**      | Dataset examples updated for taxonomy; all baselines regenerated                                                           | 4 datasets + 5 baselines |
| **Dev tooling**       | Persistent orchestrator-factory cache, build-info endpoint, dev-log-summary script                                         | 4 files                  |
| **Docs**              | bug-tracker, spec-gap-tracker, launch-checklist, operational-readiness                                                     | 4 files                  |
| **Plans**             | 7 archived plan files (bugs 004, 009 phases 1-4, 011, taxonomy cleanup followup)                                           | 7 files                  |

## Commit Strategy

These changes are deeply intertwined — bug-009 and bug-011 share classifier, confidence, session, and followup code; taxonomy cleanup touches tests across every module. Trying to split them into per-bug commits risks broken intermediate states. Instead, group by **layer** so each commit is independently CI-green:

### Commit 1 — `style: format Prettier drift`

Run `pnpm format` first so formatting noise doesn't pollute the feature commits.

- All 77 files that need formatting

### Commit 2 — `feat(schemas): taxonomy cleanup — remove stale placeholder values`

Pure schema/data changes. No runtime behavior change, but tests and downstream code depend on these being in place first.

- `packages/schemas/taxonomy.json`
- `packages/schemas/taxonomy_constraints.json`
- `packages/schemas/taxonomy-labels.json`
- `packages/schemas/eval_example.schema.json`
- `packages/schemas/src/types/orchestrator-action.ts`
- `packages/schemas/src/__tests__/enums-and-config.test.ts`
- `packages/schemas/src/__tests__/eval-validators.test.ts`
- `packages/schemas/src/__tests__/taxonomy-constraints.test.ts`
- `packages/schemas/src/__tests__/taxonomy-cross-validation-constraints.test.ts`
- `docs/taxonomy.json`

### Commit 3 — `feat(core): followup ordering, answer pinning, deterministic fallbacks, triage routing (bugs 004, 009, 011)`

The main feature commit. All runtime source changes + their tests. This bundles bugs 004/006/009/011 because they share session types, classifier logic, and orchestrator handlers.

- All `packages/core/src/` modified and new files (classifier, followup, session, confirmation, orchestrator handlers, LLM prompts, index.ts)
- All `packages/core/src/__tests__/` modified and new test files
- `packages/db/src/repos/pg-event-store.ts` + test
- `apps/web/src/components/confirmation-panel.tsx` + test
- `apps/web/src/components/__tests__/chat-shell.test.tsx`

### Commit 4 — `chore(evals): refresh datasets and baselines for updated taxonomy`

Eval data is downstream of the schema + core changes.

- `packages/evals/datasets/gold-v1/examples.jsonl`
- `packages/evals/datasets/hard/examples.jsonl`
- `packages/evals/datasets/ood/examples.jsonl`
- `packages/evals/datasets/regression/examples.jsonl`
- `packages/evals/baselines/gold-v1-baseline.json`
- `packages/evals/baselines/gold-v1-anthropic-baseline.json`
- `packages/evals/baselines/hard-anthropic-baseline.json`
- `packages/evals/baselines/hard-v0.1-baseline.json`
- `packages/evals/baselines/ood-v0.1-baseline.json`

### Commit 5 — `chore: dev tooling — persistent factory cache, build-info endpoint, dev-log script`

Independent dev-experience improvements.

- `apps/web/src/lib/orchestrator-factory.ts`
- `apps/web/src/app/dev/login/page.tsx`
- `apps/web/src/app/api/dev/build-info/route.ts` (new)
- `apps/web/src/lib/build-info.ts` (new)
- `scripts/dev-log-summary.ps1` (new)

### Commit 6 — `docs: update bug tracker, spec gap tracker, launch checklist, operational readiness`

- `docs/bug-tracker.md`
- `docs/spec-gap-tracker.md`
- `docs/launch-checklist.md`
- `docs/operational-readiness.md`

### Commit 7 — `docs: archive implementation plans for bugs 004, 009, 011, taxonomy cleanup`

- `docs/plans/2026-03-30-bug-004-regression-remedy.md` (new)
- `docs/plans/2026-03-30-bug-009-followup-question-ordering.md` (new)
- `docs/plans/2026-03-30-bug-009-phase2-answer-pinning.md` (new)
- `docs/plans/2026-03-30-bug-009-phase3-stale-descendant-invalidation.md` (new)
- `docs/plans/2026-03-30-bug-009-phase4-object-first-enhancement.md` (new)
- `docs/plans/2026-03-31-bug-011-wrong-followup-questions.md` (new)
- `docs/plans/2026-04-01-taxonomy-cleanup-followup.md` (new)
- `docs/plans/2026-04-01-repo-cleanup.md` (this plan, new)

### Post-commit — Push

Push all commits (2 existing + 7 new) to `origin/main`.

---

## Execution Steps

### Step 1 — Format

```bash
pnpm format
```

### Step 2 — Stage and commit: formatting

```bash
git add -A
git commit -m "style: format Prettier drift"
```

Note: This stages ALL formatting changes. Since the working tree has no staged changes, `-A` is safe here — it only picks up the Prettier rewrites.

**Wait** — this approach is wrong. We can't `git add -A` after formatting because that would stage everything, not just formatting changes. Instead:

1. Stash all current changes
2. Apply formatting to the stashed state
3. Commit formatting separately

Actually, the cleanest approach:

### Step 1 — Format first, then commit everything in order

Since Prettier changes and feature changes are mixed in the same files, we cannot separate them with stash tricks. Instead:

1. Run `pnpm format` to normalize all files
2. Commit files in logical groups (each group includes both the feature change AND its formatting)
3. This means commit 1 (style: format) is dropped — formatting is folded into each feature commit

**Revised commit sequence (6 commits, not 7):**

### Step 1 — Run `pnpm format`

```bash
pnpm format
```

### Step 2 — Commit: taxonomy cleanup

```bash
git add \
  packages/schemas/taxonomy.json \
  packages/schemas/taxonomy_constraints.json \
  packages/schemas/taxonomy-labels.json \
  packages/schemas/eval_example.schema.json \
  packages/schemas/src/types/orchestrator-action.ts \
  packages/schemas/src/__tests__/enums-and-config.test.ts \
  packages/schemas/src/__tests__/eval-validators.test.ts \
  packages/schemas/src/__tests__/taxonomy-constraints.test.ts \
  packages/schemas/src/__tests__/taxonomy-cross-validation-constraints.test.ts \
  docs/taxonomy.json

git commit -m "feat(schemas): taxonomy cleanup — remove stale placeholder values"
```

**Gate:** `pnpm --filter @wo-agent/schemas test` must pass.

### Step 3 — Commit: core features (bugs 004, 006, 009, 011)

```bash
git add \
  packages/core/src/classifier/ \
  packages/core/src/followup/ \
  packages/core/src/session/ \
  packages/core/src/confirmation/payload-builder.ts \
  packages/core/src/orchestrator/action-handlers/answer-followups.ts \
  packages/core/src/orchestrator/action-handlers/start-classification.ts \
  packages/core/src/llm/prompts/classifier-prompt.ts \
  packages/core/src/llm/prompts/followup-prompt.ts \
  packages/core/src/index.ts \
  packages/core/src/__tests__/ \
  packages/db/src/repos/pg-event-store.ts \
  packages/db/src/__tests__/pg-event-store.test.ts \
  apps/web/src/components/confirmation-panel.tsx \
  apps/web/src/components/__tests__/confirmation-panel.test.tsx \
  apps/web/src/components/__tests__/chat-shell.test.tsx

git commit -m "feat(core): followup ordering, answer pinning, deterministic fallbacks, triage routing (bugs 004, 006, 009, 011)"
```

**Gate:** `pnpm --filter @wo-agent/core test && pnpm --filter @wo-agent/db test && pnpm --filter @wo-agent/web test` must pass.

### Step 4 — Commit: eval refresh

```bash
git add \
  packages/evals/datasets/ \
  packages/evals/baselines/

git commit -m "chore(evals): refresh datasets and baselines for updated taxonomy"
```

**Gate:** `pnpm --filter @wo-agent/evals test` must pass.

### Step 5 — Commit: dev tooling

```bash
git add \
  apps/web/src/lib/orchestrator-factory.ts \
  apps/web/src/app/dev/login/page.tsx \
  apps/web/src/app/api/dev/build-info/route.ts \
  apps/web/src/lib/build-info.ts \
  scripts/dev-log-summary.ps1

git commit -m "chore: dev tooling — persistent factory cache, build-info endpoint"
```

### Step 6 — Commit: docs

```bash
git add \
  docs/bug-tracker.md \
  docs/spec-gap-tracker.md \
  docs/launch-checklist.md \
  docs/operational-readiness.md

git commit -m "docs: update bug tracker, spec gap tracker, launch checklist, operational readiness"
```

### Step 7 — Commit: plans

```bash
git add docs/plans/

git commit -m "docs: archive implementation plans for bugs 004, 009, 011, taxonomy cleanup"
```

### Step 8 — Push

```bash
git push
```

---

## Verification

After all commits, before push:

- `pnpm typecheck` — clean
- `pnpm test` — 199 test files pass
- `pnpm format:check` — clean
- `git status` — clean working tree
- `git log --oneline origin/main..HEAD` — 9 commits (2 existing + 7 new... wait, the 2 existing include a format commit too)

Actually, the 2 existing unpushed commits (`5d1396c style: format Prettier drift` + `eefca0c fix: address bug-004 follow-up confidence and bug-006 confirmation summary`) are already in the history. Our new commits stack on top. Final push sends all 9 commits.

---

## Acceptance Criteria

1. `git status` shows clean working tree (no modified, no untracked except gitignored)
2. `pnpm typecheck && pnpm test && pnpm format:check` all pass
3. All commits pushed to `origin/main`
4. Each commit has a clear, descriptive message following repo conventions

---

## Risk Assessment

| Risk                                                                                | Likelihood | Mitigation                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schemas commit breaks core tests (taxonomy values removed before core code updated) | Medium     | Run `pnpm --filter @wo-agent/schemas test` after schemas commit; if core tests fail at that intermediate state, merge schemas + core into one commit |
| Formatting mixed into feature diffs makes review harder                             | Low        | Accepted tradeoff — separating formatting from features is impractical when they touch the same files                                                |
| Push to main without PR                                                             | Low        | User is sole developer; branch protection not configured; all CI checks verified locally                                                             |
