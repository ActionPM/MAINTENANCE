# Fix Demo Runtime Error + E2E Verification

**Date**: 2026-03-18
**Goal**: Resolve the `ENOENT _document.js` error and verify the full CEO demo flow works.

---

## Root Cause

Two issues preventing the demo from working:

1. **Build error** (confirmed): `apps/web/src/app/dev/demo/page.tsx:95` — `window.location.href = ...` triggers the React Compiler's `react-hooks/immutability` rule. **Already fixed** by switching to `window.location.assign()`. Build now passes.

2. **Stale `.next` cache** (plausible, not confirmed in CI): The `ENOENT _document.js` error reported at runtime is consistent with a stale `.next` directory. The `pnpm build` run earlier wrote production artifacts, then `pnpm dev` tried to reuse them and looked for a Pages Router `_document.js` that doesn't exist (this project is App Router only). Clearing the cache is the standard fix, but this may not be the only factor.

---

## Batch 1: Build Verification + Cache Clear + Restart

### Task 1.1: Verify build passes

```bash
pnpm --filter @wo-agent/web build
```

This confirms the `window.location.assign()` fix resolved the build error. If it fails, the code fix was incomplete and must be addressed before proceeding.

**Acceptance**: Build completes with `0 errors`.

---

### Task 1.2: Delete `.next` cache and restart dev server

```powershell
# PowerShell-safe (rm -rf is bash-only):
Remove-Item -Recurse -Force apps\web\.next
pnpm --filter @wo-agent/web dev
```

Or cross-platform via bash in this environment:

```bash
rm -r apps/web/.next
pnpm --filter @wo-agent/web dev
```

**Acceptance**: Dev server starts without errors. `http://localhost:3000/dev/demo` loads the demo landing page with 3 scenario cards.

---

## Batch 2: E2E Verification of All 3 Scenarios

> Walk through each scenario end-to-end in the browser.

### Task 2.1: Verify Scenario 1 — Standard Request

1. Navigate to `http://localhost:3000/dev/demo`
2. Click "Launch Demo" on **Standard Request** card
3. Verify: redirected to `/?token=...&demo_scenario=standard&demo_message=...`
4. Verify: "Demo Mode — Standard Request" banner visible at top
5. Verify: progress indicator shows Step 1 active
6. Click "Start a request"
7. Verify: unit selector shows 3 units (unit-201, unit-202, unit-203)
8. Select unit-201
9. Verify: message input pre-filled with "My kitchen faucet has been dripping..."
10. Click Send
11. Verify: split review shows 1 issue (faucet/plumbing)
12. Click Confirm
13. Verify: progress advances through Classify → Confirm
14. Verify: confirmation panel shows classification labels (plumbing, faucet, leak, etc.)
15. Click "Submit work order"
16. Verify: "Your work orders have been submitted!" with clickable WO ID
17. Click WO ID → verify detail page loads with classification table + confidence bars

**Acceptance**: Full flow completes. WO detail shows all high-confidence fields.

---

### Task 2.2: Verify Scenario 2 — Multi-Issue Report

1. Navigate to `http://localhost:3000/dev/demo`
2. Click "Launch Demo" on **Multi-Issue Report** card
3. Select unit, send pre-filled message
4. Verify: split review shows **3 issues** (faucet, light, cockroach)
5. Click Confirm
6. Verify: classification runs, then **follow-up questions** appear (for Location/Sub_Location — these fields have confidence < 0.65, below the `medium_threshold` in `DEFAULT_CONFIDENCE_CONFIG`)
7. Answer follow-up questions (select any option)
8. Verify: confirmation panel shows **3 classified issues**
9. Click "Submit work orders"
10. Verify: **3 WO IDs** shown in the submitted state (verify the 3 specific IDs, not a total count — the list page shows all tenant WOs which may include prior runs)
11. Click "View all work orders" → verify the 3 newly created WO IDs appear in the list

**Acceptance**: 3 issues split, follow-up questions triggered, 3 WOs created. The 3 WO IDs from step 10 are visible on the list page.

---

### Task 2.3: Verify Scenario 3 — Emergency Detection

1. Navigate to `http://localhost:3000/dev/demo`
2. Click "Launch Demo" on **Emergency Detection** card
3. Select unit, send pre-filled message (contains "flooding")
4. Verify: **risk detection fires** — safety mitigation message shown
5. Verify: emergency confirmation quick replies appear ("Yes, this is an emergency" / "No, not an emergency")
6. Click "Yes, this is an emergency"
7. Verify: split review shows 1 issue → Confirm
8. Verify: confirmation panel shows risk flags
9. Submit → verify WO created
10. Click WO ID → verify detail page shows **Risk Assessment** section with emergency severity + flood trigger

**Acceptance**: Emergency detected, mitigations shown, risk flags on WO.

---

## Batch 3: Fix Any Issues Found + CI

> Batch 3 runs regardless — CI is not conditional.

### Task 3.1: Fix any issues found during E2E

If any scenario fails, diagnose and fix. Common things to check:
- API returns 403 → `ENABLE_DEV_AUTH` not set (check `apps/web/.env.local`)
- Unit resolver returns null → `USE_DEMO_UNIT_RESOLVER` not set
- Splitter returns 1 issue instead of 3 → `USE_DEMO_FIXTURES` not set
- Follow-up questions don't appear → classifier confidence below `medium_threshold` (0.65) needed for guaranteed trigger; check demo classifier preset values are < 0.65 for target fields
- Emergency not detected → risk scanner keywords not matching (check `risk_protocols.json` — needs "flood", "flooding", "burst pipe", or "water everywhere")

**Acceptance**: All 3 scenarios work as described above.

---

### Task 3.2: Run full CI suite

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @wo-agent/web build
```

**Acceptance**: All 4 pass with 0 errors.
