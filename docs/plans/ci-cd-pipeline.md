# CI/CD Pipeline — Implementation Plan

> **Status**: Reviewed (v7 — addressed 14 findings across 6 review rounds)
> **Created**: 2026-03-10
> **Project**: Work Order Agent (pnpm monorepo)

---

## Overview

Add GitHub Actions CI/CD pipelines and linting infrastructure to the Work Order Agent monorepo. The project currently has **zero CI** — no workflows, no linter config, no formatter config. It does have a `vercel.json` for web deployment and root-level `test`/`typecheck`/`lint` scripts that recurse into workspaces.

### Goals

1. **PR gate** — block merges that break types, tests, or lint rules
2. **Lint + format** — enforce consistent code style across 347 TS/TSX files
3. **Fast feedback** — parallel jobs, aggressive caching, fail-fast
4. **Deploy gate** — Vercel preview on PR, production on merge to `main`
5. **Eval gate** — required offline eval on classifier/schema changes per governance rules

---

## Current State

| Area           | Status                                                               |
| -------------- | -------------------------------------------------------------------- |
| GitHub Actions | None                                                                 |
| ESLint         | None (root `lint` script exists but no config)                       |
| Prettier       | None                                                                 |
| Vitest         | Configured per-package (5 configs, 139 test files)                   |
| TypeScript     | `tsc --noEmit` per-package via `typecheck` script                    |
| Deployment     | `vercel.json` in `apps/web/` (Vercel)                                |
| Env vars       | `DATABASE_URL`, `JWT_*`, `ANTHROPIC_API_KEY` (tests use mocks/stubs) |

---

## Implementation Plan

### Phase 1: Linting & Formatting Infrastructure

> **Why first**: The CI workflow needs something to lint. Setting up ESLint + Prettier before the workflow avoids a broken pipeline on day one.

#### Task 1.1 — Install ESLint + Prettier at root

**File**: `package.json` (root devDependencies)

Install:

```
pnpm add -Dw eslint @eslint/js typescript-eslint eslint-config-prettier eslint-plugin-react eslint-plugin-react-hooks globals prettier
```

Packages chosen:

- `eslint` v9 + `@eslint/js` — flat config format
- `typescript-eslint` — TS-aware rules
- `eslint-config-prettier` — disables rules that conflict with Prettier
- `eslint-plugin-react` + `eslint-plugin-react-hooks` — for `apps/web/` JSX/TSX
- `globals` — provides Node.js, browser, and test global definitions for flat config (required since flat config has no implicit `env` like legacy config)
- `prettier` — formatting

#### Task 1.2 — Create `eslint.config.js` (flat config)

**File**: `eslint.config.js` (root)

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  { ignores: ['**/dist/', '**/node_modules/', '**/.next/', '**/coverage/'] },

  // Base JS rules
  js.configs.recommended,

  // TypeScript rules for all TS files
  ...tseslint.configs.recommended,

  // Node.js globals for all packages (process, console, require, __dirname, etc.)
  // Required because flat config has no implicit `env` — without this, ESLint
  // reports "no-undef" on process.env, console.log, require(), etc.
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Browser + Node globals for web app (Next.js SSR uses both)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 19 auto-import
      'react/prop-types': 'off', // TypeScript handles this
    },
    settings: { react: { version: 'detect' } },
  },

  // Test globals (describe, it, expect, vi, etc.) + relaxed rules
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    languageOptions: {
      globals: {
        ...globals.vitest,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Prettier must be last
  prettierConfig,
);
```

> **Why `globals` is required**: ESLint v9 flat config does not have `env: { node: true }` like legacy config. Without explicit `languageOptions.globals`, any use of `process`, `console`, `require`, `__dirname`, or `globalThis` triggers `no-undef` errors. This repo uses `process.env` in `orchestrator-factory.ts`, `run-eval.ts`, and many other files; `require()` for lazy CJS imports in the web app; and vitest globals (`describe`, `it`, `expect`) in test files configured with `globals: true`.

#### Task 1.3 — Create `.prettierrc`

**File**: `.prettierrc` (root)

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

#### Task 1.4 — Add `lint` scripts to each package

Currently only the root has `"lint": "pnpm -r lint"` but no package defines a `lint` script.

**Option A (recommended)**: Single root-level lint command instead of per-package.

Update root `package.json`:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

This is simpler than per-package lint scripts because ESLint v9 flat config handles scoping via `files` globs.

#### Task 1.5 — Initial lint fix pass

Run `pnpm lint:fix && pnpm format` to auto-fix. Then manually address remaining errors. Commit as a standalone "chore: add eslint + prettier" commit before the CI workflow.

**Estimated manual fixes**: Likely `@typescript-eslint/no-unused-vars` and `@typescript-eslint/no-explicit-any` across ~30-50 files. Consider setting `no-explicit-any` to `warn` initially.

---

### Phase 2: CI Workflow (PR Gate)

#### Task 2.1 — Create `.github/workflows/ci.yml`

**File**: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
    env:
      # Tests use in-memory stubs, no real DB or LLM needed
      DATABASE_URL: ''
      ANTHROPIC_API_KEY: ''

  build-web:
    name: Build Web App
    runs-on: ubuntu-latest
    needs: [typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wo-agent/web build
    env:
      DATABASE_URL: ''
      ANTHROPIC_API_KEY: ''
```

**Design decisions**:

- **3 parallel jobs** (lint, typecheck, test) + 1 sequential (build-web after typecheck) — fast feedback, ~2-3 min total
- **Node 22** (LTS) — project requires >=20, using current LTS for stability
- **pnpm 10** — matches local dev (10.30.2)
- **`--frozen-lockfile`** — ensures CI uses exact lockfile, fails if lockfile is outdated
- **`concurrency` with cancel-in-progress** — saves runner minutes on rapid pushes
- **No DB/LLM secrets in CI** — tests use in-memory stores and LLM stubs
- **`build-web` job** — catches Next.js build errors (SSR/SSG issues, import errors) that typecheck alone misses

#### Task 2.2 — Add branch protection rules

After the CI and eval workflows are both merged, configure GitHub branch protection on `main`:

- Require status checks from the **CI workflow** (`ci.yml`):
  - `Lint & Format`
  - `Type Check`
  - `Test`
  - `Build Web App`
- Require status checks from the **Evals workflow** (`evals.yml`):
  - `Detect eval-relevant changes`
  - `Post Eval Summary`
- Require branches to be up to date
- Require PR reviews (optional, team preference)

> **Cross-workflow enforcement**: GitHub branch protection can require status checks from any workflow, not just one. The eval workflow's required checks are `Detect eval-relevant changes` and `Post Eval Summary` — both always run on every PR and always resolve to a success/failure status.
>
> **Why NOT require the matrix jobs**: The `Eval Gate (offline) (gold/hard/ood/regression)` matrix jobs are conditionally skipped when no eval-relevant files change. GitHub treats skipped jobs as having no status, which would leave required checks stuck on "Pending" and block the PR. Only require jobs that always run. The matrix jobs are enforced indirectly: `Post Eval Summary` has an explicit "Enforce eval gate result" step that checks `needs.eval-gate.result != 'success'` and exits with code 1 if any matrix job failed. This is necessary because `always()` in the job's `if:` condition prevents GitHub from auto-propagating failure from `needs`.
>
> **Important**: The eval status checks will only appear in the branch protection dropdown after the workflow has run at least once on the repo. Merge the workflow file first (Task 4.2), trigger it on a test PR, then configure branch protection to require the eval checks.

This is a manual GitHub settings step, not a file change.

---

### Phase 3: Deployment Workflow

#### Task 3.1 — Vercel GitHub Integration (recommended path)

**No workflow file needed.** Vercel's GitHub integration already handles:

- Preview deploys on every PR
- Production deploy on merge to `main`
- Uses `vercel.json` config already in `apps/web/`

**Setup steps** (one-time, manual):

1. Connect repo to Vercel project at vercel.com

2. **Keep the Root Directory as the repo root (default `/`).** Do NOT set it to `apps/web`. Reasons:
   - The web app imports 4 workspace packages (`@wo-agent/core`, `@wo-agent/schemas`, `@wo-agent/db`, `@wo-agent/mock-erp`) that live outside `apps/web/`. Vercel's [monorepo docs](https://vercel.com/docs/monorepos#root-directory) state the app cannot access files outside the configured Root Directory.
   - The current `vercel.json` uses repo-root-relative paths: `outputDirectory: "apps/web/.next"` and `buildCommand: "pnpm --filter @wo-agent/web build"`. These paths are correct when resolved from the repo root. Setting Root Directory to `apps/web` would make `outputDirectory` resolve to `apps/web/apps/web/.next`.
   - `installCommand: "pnpm install"` must run at the monorepo root to install all workspace dependencies.

3. **Move `vercel.json` from `apps/web/vercel.json` to the repo root.** Vercel reads `vercel.json` from the Root Directory. Since Root Directory is the repo root, the config file must live there too. The current file contents are already correct for a repo-root context — no path changes needed, just the file location:

   ```bash
   git mv apps/web/vercel.json vercel.json
   ```

4. Set environment variables in Vercel dashboard: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ANTHROPIC_API_KEY`

5. Set the **Framework Preset** to `Next.js` in Vercel project settings. With Root Directory at repo root, Vercel may not auto-detect the Next.js framework (it looks for `next.config.ts` in Root Directory). The `vercel.json` already sets `"framework": "nextjs"`, but confirming in the dashboard avoids surprises.

**Why not a custom deploy workflow**: Vercel's native integration is simpler, provides preview URLs on PRs automatically, handles rollbacks, and is already configured via `vercel.json`.

#### Task 3.2 — (Alternative) Custom deploy workflow via Vercel CLI

Only if the Vercel GitHub integration isn't suitable (e.g., need pre-deploy DB migrations):

**File**: `.github/workflows/deploy.yml`

> **Important**: A separate `push`-triggered workflow does NOT wait for another workflow to pass, even if branch protection is configured. Branch protection only gates merges to the branch, not downstream `push` events. To ensure deploy only runs after CI succeeds, use `workflow_run` to trigger on CI completion.

```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI] # must match the `name:` in ci.yml
    types: [completed]
    branches: [main]

jobs:
  deploy:
    name: Deploy to Vercel
    runs-on: ubuntu-latest
    # Only deploy if CI succeeded — skip if it failed or was cancelled
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Deploy to Vercel
        run: npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

#### Task 3.3 — DB Migration Step (future)

When ready for production DB, add a migration step before deploy:

```yaml
migrate:
  name: Run DB Migrations
  runs-on: ubuntu-latest
  environment: production # requires approval
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 10
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @wo-agent/db migrate
      env:
        DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Use a GitHub environment (`production`) with required reviewers so migrations need manual approval.

---

### Phase 4: Eval Gate (Required — Offline)

> **Why required**: The project's eval governance (`docs/evals-governance.md` §6) already defines blocking CI rules: any regression on critical slices (`emergency`, `building_access`, `pest_control`, OOD routing) blocks merge. Schema-invalid and contradiction-after-retry rate increases also block. This phase implements those rules as a CI gate.

> **Why offline-only**: The current eval package only exposes `FixtureClassifierAdapter` and `RecordedOutputAdapter` (`packages/evals/src/runners/classifier-adapters.ts`). There is no live/provider-backed adapter. The eval CLI uses the `fixture` adapter by default and requires no `ANTHROPIC_API_KEY`. A live adapter can be added later as a separate optional workflow.

#### Task 4.1 — Seed initial baselines (prerequisite)

The eval gate compares each run against a committed baseline. Without a baseline, `run-eval.ts` (line 263) skips comparison entirely and the gate passes vacuously — providing no protection. Baselines must be seeded before the workflow is useful.

**Baseline auto-discovery** uses the `manifest_id` field from each dataset's `manifest.json`, not the dataset directory name:

- `gold/manifest.json` → `manifest_id: "gold-v0.1"` → baseline: `gold-v0.1-baseline.json`
- `hard/manifest.json` → `manifest_id: "hard-v0.1"` → baseline: `hard-v0.1-baseline.json`
- `ood/manifest.json` → `manifest_id: "ood-v0.1"` → baseline: `ood-v0.1-baseline.json`
- `regression/manifest.json` → `manifest_id: "regression-v0.1"` → baseline: `regression-v0.1-baseline.json`

**Steps to seed baselines** (run locally, commit results):

```bash
# 1. Run each dataset to generate EvalRun JSON files
pnpm --filter @wo-agent/evals eval:run --dataset gold --adapter fixture
pnpm --filter @wo-agent/evals eval:run --dataset hard --adapter fixture
pnpm --filter @wo-agent/evals eval:run --dataset ood --adapter fixture
pnpm --filter @wo-agent/evals eval:run --dataset regression --adapter fixture

# 2. Promote each run to become the baseline.
#    update-baseline validates metrics + slice_metrics are present,
#    then writes to baselines/${manifest_id}-baseline.json
pnpm --filter @wo-agent/evals eval:update-baseline --run-file packages/evals/baselines/gold-run-<timestamp>.json
pnpm --filter @wo-agent/evals eval:update-baseline --run-file packages/evals/baselines/hard-run-<timestamp>.json
pnpm --filter @wo-agent/evals eval:update-baseline --run-file packages/evals/baselines/ood-run-<timestamp>.json
pnpm --filter @wo-agent/evals eval:update-baseline --run-file packages/evals/baselines/regression-run-<timestamp>.json

# 3. Commit the baseline files (they must be checked in for CI to find them)
git add packages/evals/baselines/*-baseline.json
git commit -m "ci: seed eval baselines for all 4 datasets"
```

**Important**: `update-baseline.ts` requires the EvalRun to have both `metrics` and non-empty `slice_metrics` (lines 45-52). If a run is missing slice metrics, the promotion will fail — investigate the dataset/adapter before retrying.

#### Task 4.2 — Eval workflow on classifier/schema changes

**File**: `.github/workflows/evals.yml`

**Available datasets** (under `packages/evals/datasets/`):

| Directory     | `manifest_id`     | Type       | Examples | Key slices                                                                     |
| ------------- | ----------------- | ---------- | -------- | ------------------------------------------------------------------------------ |
| `gold/`       | `gold-v0.1`       | gold       | 50       | 12 domain slices (plumbing, electrical, hvac, ...)                             |
| `hard/`       | `hard-v0.1`       | hard       | 20       | ambiguous, vague, multi_issue, slang, typo                                     |
| `ood/`        | `ood-v0.1`        | ood        | 15       | off_topic, gibberish, other_service, edge_case                                 |
| `regression/` | `regression-v0.1` | regression | 20       | hierarchy_violation, cross_domain, confidence_edge, constraint_edge, emergency |

The `eval:run` CLI (`packages/evals/src/cli/run-eval.ts`) requires:

- `--dataset <name>` — **mandatory**, must match a directory under `packages/evals/datasets/`. Exits code 1 if missing (line 40).
- `--adapter <name>` — optional, defaults to `fixture`
- `--baseline <path>` — optional, auto-discovers from `baselines/${manifest_id}-baseline.json` (line 234)

Output files are written to `packages/evals/baselines/`:

- `${datasetName}-run-${timestamp}.json` — the EvalRun JSON
- `${datasetName}-comparison-${timestamp}.md` — the comparison report (only written when baseline exists)

```yaml
name: Evals

# Trigger on ALL pull requests — no paths filter.
# Path filtering is done at the job level via dorny/paths-filter so that
# required status checks resolve to "success" (not stuck on "pending")
# when no eval-relevant files are changed.
on:
  pull_request:
    branches: [main]

jobs:
  # Step 1: Detect whether eval-relevant files changed
  detect-changes:
    name: Detect eval-relevant changes
    runs-on: ubuntu-latest
    outputs:
      eval-relevant: ${{ steps.filter.outputs.eval }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            eval:
              - 'packages/core/src/classifier/**'
              - 'packages/core/src/followup/**'
              - 'packages/core/src/splitter/**'
              - 'packages/schemas/taxonomy*'
              - 'packages/schemas/classification_cues.json'
              - 'packages/evals/**'

  # Step 2: Run eval matrix — only if relevant files changed
  eval-gate:
    name: Eval Gate (offline)
    runs-on: ubuntu-latest
    needs: [detect-changes]
    if: needs.detect-changes.outputs.eval-relevant == 'true'
    strategy:
      fail-fast: false
      matrix:
        dataset: [gold, hard, ood, regression]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # Run eval against committed baseline.
      # The fixture adapter requires no secrets — it replays pre-recorded outputs.
      # Baselines must be committed first (Task 4.1) or comparison is skipped.
      - name: Run ${{ matrix.dataset }} eval
        run: pnpm --filter @wo-agent/evals eval:run --dataset ${{ matrix.dataset }} --adapter fixture

      # Upload the run artifact for traceability
      - name: Upload eval artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-${{ matrix.dataset }}
          path: |
            packages/evals/baselines/${{ matrix.dataset }}-run-*.json
            packages/evals/baselines/${{ matrix.dataset }}-comparison-*.md

  # Step 3: Post combined comment after all matrix jobs complete.
  # This is the REQUIRED check in branch protection, so it must:
  #   - succeed when no eval-relevant files changed (no-op)
  #   - succeed when evals ran and all passed
  #   - FAIL when evals ran and any matrix job failed
  eval-comment:
    name: Post Eval Summary
    runs-on: ubuntu-latest
    needs: [detect-changes, eval-gate]
    # Run if detect-changes succeeded — covers both "evals ran" and "evals skipped"
    if: always() && needs.detect-changes.result == 'success'
    steps:
      # If no eval-relevant changes, skip with a success exit
      - name: Skip (no eval-relevant changes)
        if: needs.detect-changes.outputs.eval-relevant != 'true'
        run: echo "No eval-relevant files changed — skipping."

      # CRITICAL: Fail this job if any eval-gate matrix job failed.
      # Because this job uses `always()`, GitHub does not propagate failure
      # from `needs.eval-gate` automatically. Without this step, a failed
      # eval gate would still produce a green "Post Eval Summary" check,
      # allowing the PR to merge despite regressions.
      - name: Enforce eval gate result
        if: needs.detect-changes.outputs.eval-relevant == 'true' && needs.eval-gate.result != 'success'
        run: |
          echo "::error::Eval gate failed or was cancelled (result: ${{ needs.eval-gate.result }}). PR cannot merge."
          exit 1

      - uses: actions/download-artifact@v4
        if: needs.detect-changes.outputs.eval-relevant == 'true'
        with:
          path: eval-artifacts
          pattern: eval-*
          merge-multiple: true

      - name: Post eval results
        if: needs.detect-changes.outputs.eval-relevant == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const dir = 'eval-artifacts';
            if (!fs.existsSync(dir)) {
              core.warning('No eval artifacts found');
              return;
            }
            const files = fs.readdirSync(dir)
              .filter(f => f.endsWith('.md') && f.includes('-comparison-'))
              .sort();
            if (files.length === 0) {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: '## Eval Results (offline fixture)\n\nNo comparison reports generated. Baselines may not be seeded yet — see Task 4.1 in the CI/CD plan.'
              });
              return;
            }
            const reports = files.map(f => fs.readFileSync(`${dir}/${f}`, 'utf8')).join('\n\n---\n\n');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Eval Results (offline fixture)\n\n${reports}`
            });
```

> **Why no `paths:` filter on the workflow trigger**: GitHub keeps status checks from path-filtered workflows in a "Pending" state when the workflow is skipped. If those checks are required by branch protection, the PR is blocked from merging — even though no eval-relevant files changed. Instead, the workflow triggers on all PRs, and `dorny/paths-filter` detects changes at the job level. When no relevant files changed, `eval-gate` is skipped (its `if:` is false) and `eval-comment` exits with success after a no-op step. Both report as "success" to branch protection, unblocking the PR.

**Design decisions**:

- **Always-triggered workflow with job-level path filtering** — the workflow triggers on all PRs (no `paths:` filter). A `detect-changes` job uses `dorny/paths-filter` to check if eval-relevant files changed. When they haven't, `eval-gate` is skipped and `eval-comment` succeeds with a no-op. This avoids the GitHub limitation where path-filtered workflows leave required status checks stuck on "Pending" when skipped.
- **Matrix strategy over 4 real datasets** — runs `gold`, `hard`, `ood`, `regression` in parallel with `fail-fast: false` so all results are visible even if one regresses
- **No `ANTHROPIC_API_KEY` needed** — the `fixture` adapter replays pre-recorded outputs, making this fast (~seconds) and free
- **Blocking by default** — if the eval run exits non-zero (critical slice regression, schema-invalid increase, or contradiction-after-retry increase per governance §6), the job fails and blocks merge
- **Baseline dependency** — requires committed baselines from Task 4.1. Without them, runs complete but comparison is skipped and a warning comment is posted
- **Artifact upload per dataset** — preserves each EvalRun JSON for debugging failed gates
- **Separate comment job** — downloads all matrix artifacts and posts a combined PR comment with all comparison reports
- **No `require('glob')`** — uses `fs.readdirSync` only; the `glob` package is not in the dependency tree

> **Note on `approved_for_gate` filtering**: The governance doc (`evals-governance.md` §7) specifies that only `approved_for_gate` examples should participate in CI gate decisions. However, `loadDataset()` (`packages/evals/src/datasets/load-dataset.ts` line 36) currently loads **all** examples without filtering by `review_status`. This means the gate currently runs against the full dataset. Enforcing `approved_for_gate` filtering requires a code change to the loader — tracked separately from this CI plan. Until that filtering is implemented, the gate operates on all examples in each dataset.

#### Task 4.3 — (Future) Live provider-backed eval workflow

When a live `AnthropicClassifierAdapter` is added to `packages/evals/src/runners/classifier-adapters.ts`, create a separate **non-blocking** workflow:

```yaml
name: Evals (live)
on:
  pull_request:
    paths: [same paths as above]
jobs:
  eval-live:
    name: Eval (live, non-blocking)
    runs-on: ubuntu-latest
    continue-on-error: true # non-blocking until adapter is validated
    strategy:
      fail-fast: false
      matrix:
        dataset: [gold, hard, ood, regression]
    steps:
      # ... same setup as Task 4.2 ...
      - run: pnpm --filter @wo-agent/evals eval:run --dataset ${{ matrix.dataset }} --adapter anthropic
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

This is intentionally deferred — do not add until a live adapter exists and has been validated against the fixture baseline.

---

## Task Summary

| #   | Task                         | Files                                                 | Effort    | Dependencies                          |
| --- | ---------------------------- | ----------------------------------------------------- | --------- | ------------------------------------- |
| 1.1 | Install ESLint + Prettier    | `package.json`                                        | 5 min     | —                                     |
| 1.2 | Create ESLint flat config    | `eslint.config.js`                                    | 15 min    | 1.1                                   |
| 1.3 | Create Prettier config       | `.prettierrc`                                         | 2 min     | 1.1                                   |
| 1.4 | Update root lint scripts     | `package.json`                                        | 5 min     | 1.2, 1.3                              |
| 1.5 | Initial lint fix pass        | Multiple                                              | 30-60 min | 1.4                                   |
| 2.1 | Create CI workflow           | `.github/workflows/ci.yml`                            | 15 min    | 1.5                                   |
| 2.2 | Branch protection rules      | GitHub UI                                             | 5 min     | 2.1 + 4.2 merged, each triggered once |
| 3.1 | Connect Vercel integration   | Vercel UI + `git mv apps/web/vercel.json vercel.json` | 10 min    | —                                     |
| 3.2 | (Alt) Custom deploy workflow | `.github/workflows/deploy.yml`                        | 15 min    | 3.1                                   |
| 3.3 | DB migration step            | `.github/workflows/deploy.yml`                        | 10 min    | 3.2                                   |
| 4.1 | Seed initial baselines       | `packages/evals/baselines/`                           | 15 min    | eval datasets exist                   |
| 4.2 | Eval gate workflow (offline) | `.github/workflows/evals.yml`                         | 20 min    | 4.1                                   |
| 4.3 | (Future) Live eval workflow  | `.github/workflows/evals.yml`                         | 15 min    | 4.2 + live adapter                    |

### Recommended execution order

```
Phase 1 (1.1 → 1.2 → 1.3 → 1.4 → 1.5)  ←  commit: "chore: add eslint + prettier"
Phase 2 (2.1)                               ←  commit: "ci: add GitHub Actions CI workflow"
Phase 3 (3.1)                               ←  manual Vercel setup
Phase 4 (4.1)                               ←  commit: "ci: seed eval baselines for all 4 datasets"
Phase 4 (4.2)                               ←  commit: "ci: add offline eval gate per governance rules"
Phase 2 (2.2)                               ←  manual GitHub settings (after 2.1 + 4.2 each triggered once)
Phase 4 (4.3)                               ←  deferred until live adapter exists
```

Phases 3 and 4 are independent and can be done in parallel after Phase 2.
Phase 4.1 (baseline seeding) **must** precede 4.2 (workflow) or the gate passes vacuously.
Task 2.2 (branch protection) is deliberately last: eval status checks must appear in the GitHub dropdown before they can be required, which means the eval workflow must have run at least once.

---

## Secrets Required

| Secret               | Where               | Purpose                                                                      |
| -------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | GitHub repo secrets | Future live eval runs only (Task 4.3); offline fixture evals need no secrets |
| `DATABASE_URL`       | Vercel env vars     | Production DB                                                                |
| `JWT_ACCESS_SECRET`  | Vercel env vars     | Auth tokens                                                                  |
| `JWT_REFRESH_SECRET` | Vercel env vars     | Refresh tokens                                                               |
| `VERCEL_TOKEN`       | GitHub repo secrets | Only if using custom deploy (Task 3.2)                                       |
| `VERCEL_ORG_ID`      | GitHub repo secrets | Only if using custom deploy (Task 3.2)                                       |
| `VERCEL_PROJECT_ID`  | GitHub repo secrets | Only if using custom deploy (Task 3.2)                                       |

---

## Risk & Mitigations

| Risk                                         | Impact                          | Mitigation                                                                                                     |
| -------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Initial lint fix creates huge diff           | Review burden                   | Do as standalone commit before CI; use `--fix` for auto-fixable rules                                          |
| `no-explicit-any` blocks too many files      | Blocks PR merges                | Set to `warn` initially, tighten to `error` later                                                              |
| Eval runs are slow/expensive (LLM calls)     | CI cost, slow PRs               | Phase 4.2 uses offline fixture adapter (fast, free); live evals deferred to 4.3 with `continue-on-error: true` |
| Eval gate passes vacuously without baselines | False sense of safety           | Phase 4.1 seeds baselines before workflow is added; comment job warns when no comparison reports exist         |
| Next.js build fails in CI but not locally    | False failures                  | `build-web` job catches this early; env vars set to empty strings                                              |
| pnpm lockfile drift                          | CI fails on `--frozen-lockfile` | Good — forces developers to commit lockfile changes                                                            |
