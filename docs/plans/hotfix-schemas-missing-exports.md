# Hotfix: Repair broken imports in @wo-agent/schemas barrel

**Date:** 2026-03-10
**Branch:** `hotfix/schemas-missing-exports` (off `main`)
**Severity:** Critical — main is broken; any import of `@wo-agent/schemas` fails

---

## Problem

`packages/schemas/src/index.ts` on main exports from 4 modules that were never committed:

| Line(s) | Missing module                               | Type                                          |
| ------- | -------------------------------------------- | --------------------------------------------- |
| 8–10    | `./taxonomy-manifest.js`                     | Taxonomy governance (premature)               |
| 12–14   | `./taxonomy-analytic-classes.js`             | Taxonomy governance (premature)               |
| 160–161 | `./validators/orchestrator-action-domain.js` | Domain validator (should have been committed) |
| 162–163 | `./validators/issue-split-domain.js`         | Domain validator (should have been committed) |

**Impact:** Any package that imports `@wo-agent/schemas` hits a module-not-found error. This cascades through `@wo-agent/core`, `@wo-agent/db`, `@wo-agent/evals`, and `@wo-agent/web`. The full monorepo test suite cannot pass.

**Root cause:** The barrel export lines were committed, but the implementation files they reference were left as untracked local files. They are preserved on `wip/2026-03-10-taxonomy-snapshot`.

---

## Decision: Split fix

The 4 missing modules are **not all the same kind of change**:

**Validator files (bring in):**

- `orchestrator-action-domain.ts` — 44 lines, validates idempotency_key and conversation_id requirements per spec §10.2/§18
- `issue-split-domain.ts` — 21 lines, validates issue_count matches issues.length

These are:

- Small and self-contained (import only from sibling types, no external deps)
- Already referenced by 3 committed locations: `index.ts` (lines 160–163), `validators/index.ts` (lines 11–14), `validators.test.ts` (lines 11–12)
- Already tested: `validators.test.ts` has 12 test cases covering both validators (lines 258–343 for orchestrator-action-domain, lines 393–445 for issue-split-domain)
- Adding them is repair work, not new scope

**Taxonomy files (remove exports only):**

- `taxonomy-manifest.ts` — requires `taxonomy_manifest.json` (not committed)
- `taxonomy-analytic-classes.ts` — requires `taxonomy_analytic_classes.json` (not committed)

These are:

- Part of the taxonomy-evolution stream (v1.2/v2 proposal work)
- Not referenced by any committed code outside the schemas barrel (confirmed: zero imports in core, evals, web, or db)
- Dependent on JSON assets that reflect unfinished taxonomy governance decisions
- Bringing them in would smuggle partially baked taxonomy work into main

---

## Tasks

### Task 1: Create hotfix branch

- **Action:** `git checkout -b hotfix/schemas-missing-exports main`
- **Verify:** Clean working tree, HEAD at `b29dcd5`

### Task 2: Add the two validator files from snapshot

- **Action:** Checkout exactly 2 files from `wip/2026-03-10-taxonomy-snapshot`:
  - `packages/schemas/src/validators/orchestrator-action-domain.ts`
  - `packages/schemas/src/validators/issue-split-domain.ts`
- **Command:** `git checkout wip/2026-03-10-taxonomy-snapshot -- packages/schemas/src/validators/orchestrator-action-domain.ts packages/schemas/src/validators/issue-split-domain.ts`
- **Verify:** Both files exist and match expected content (44 lines and 21 lines respectively)

### Task 3: Remove premature taxonomy exports from barrel

- **File:** `packages/schemas/src/index.ts`
- **Remove lines 8–14** (the taxonomy-manifest and taxonomy-analytic-classes export blocks):

  ```
  // --- Taxonomy Manifest ---
  export { loadTaxonomyManifest, taxonomyManifest } from './taxonomy-manifest.js';
  export type { TaxonomyManifest, AuthoritativeHierarchy, SentinelPolicy } from './taxonomy-manifest.js';

  // --- Taxonomy Analytic Classes ---
  export { loadTaxonomyAnalyticClasses, taxonomyAnalyticClasses, isSentinelValue, isDeprecatedValue } from './taxonomy-analytic-classes.js';
  export type { TaxonomyAnalyticClasses, AnalyticClass } from './taxonomy-analytic-classes.js';
  ```

- **Keep lines 160–163** (validator exports — satisfied by Task 2)
- **Verify:** No remaining references to `taxonomy-manifest` or `taxonomy-analytic-classes` in `packages/schemas/src/`

### Task 4: Verify no other files reference removed exports

- **Action:** Search entire monorepo for any imports of the removed symbols:
  - `loadTaxonomyManifest`, `taxonomyManifest`, `TaxonomyManifest`, `AuthoritativeHierarchy`, `SentinelPolicy`
  - `loadTaxonomyAnalyticClasses`, `taxonomyAnalyticClasses`, `isSentinelValue`, `isDeprecatedValue`, `TaxonomyAnalyticClasses`, `AnalyticClass`
- **Expected:** Zero matches outside the lines being removed (confirmed in research phase — no imports in core, evals, web, or db)
- **If matches found:** Expand hotfix scope to remove those imports too, or halt and reassess

### Task 5: Run verification suite

All must pass before commit.

**Note:** Commands below use bash syntax. On Windows with PowerShell execution policy restrictions, use `pnpm.cmd` instead of `pnpm`.

| Step | Command                                     | What it proves                                        |
| ---- | ------------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| 5a   | `rg "taxonomy-manifest                      | taxonomy-analytic-classes" packages/schemas/src`      | No dangling references in schemas |
| 5b   | `pnpm --filter @wo-agent/schemas test`      | Schemas tests pass (including 12 new validator tests) |
| 5c   | `pnpm --filter @wo-agent/schemas typecheck` | No type errors in schemas package                     |
| 5d   | `pnpm --filter @wo-agent/db test`           | DB import tests pass (the original failure symptom)   |
| 5e   | `pnpm --filter @wo-agent/core test`         | Core tests pass (heaviest schemas consumer)           |
| 5f   | `pnpm -r typecheck`                         | Full monorepo typecheck clean                         |

### Task 6: Commit

- **Single commit** on `hotfix/schemas-missing-exports`
- **Message pattern:** `fix(schemas): add missing validator files and remove premature taxonomy exports`
- **Body should explain:** barrel referenced 4 uncommitted modules; 2 validators restored from snapshot, 2 taxonomy helpers deferred to taxonomy-evolution branch

### Task 7: Merge to main

- **Action:** `git checkout main && git merge hotfix/schemas-missing-exports`
- **Verify:** `git log --oneline -3` shows the hotfix commit on main

---

## Files NOT included in this hotfix

| File                                                | Reason                                   | Where it lives                     |
| --------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| `packages/schemas/src/taxonomy-manifest.ts`         | Taxonomy governance, requires JSON asset | `wip/2026-03-10-taxonomy-snapshot` |
| `packages/schemas/src/taxonomy-analytic-classes.ts` | Taxonomy governance, requires JSON asset | `wip/2026-03-10-taxonomy-snapshot` |
| `packages/schemas/taxonomy_manifest.json`           | Unfinished taxonomy governance           | `wip/2026-03-10-taxonomy-snapshot` |
| `packages/schemas/taxonomy_analytic_classes.json`   | Unfinished taxonomy governance           | `wip/2026-03-10-taxonomy-snapshot` |

These belong to a future `feature/taxonomy-evolution` branch.

---

## Risk assessment

- **Risk:** Low. Adding 2 small, tested, self-contained validator files and removing 7 lines from a barrel export.
- **Blast radius:** Fixes a broken main. No behavioral changes to existing code — only restores modules that were already expected.
- **Rollback:** Revert single commit if anything unexpected surfaces.
