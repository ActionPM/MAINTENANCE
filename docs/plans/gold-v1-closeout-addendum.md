# Plan Addendum: Gold-v1 Hardening Closeout

**Created**: 2026-03-27
**Parent plan**: `docs/plans/gold-v1-slice-hardening.md`
**Status**: Complete (executed 2026-03-27)

## Summary

This addendum covers the remaining work after implementation is complete and provider-backed evals have passed. It folds the earlier "tomorrow" checklist into the existing hardening plan by treating baseline promotion and release evidence as the final Batch 4 closeout, and by moving branch/PR hygiene into an explicit post-plan closeout checklist.

Current assumed state:

- Batches 1, 2, 3, and 2b are implemented (execution order: 1 -> 2 -> 3 -> 2b)
- Provider-backed `gold-v1`, `regression`, and `hard` evals have already passed (all gates PASSED per comparison reports)
- Timestamped eval artifacts already exist and are the source of truth for baseline promotion and evidence capture

---

## Implementation Changes

### Batch 4 closeout

Add three explicit closeout steps after Tasks 4.3-4.5. Baseline promotion is consolidated here in Task 4.6; the per-task "Post-run: overwrite baseline" instructions in Tasks 4.3 (line 614), 4.4 (line 628), and 4.5 (line 642) of the parent plan must be patched to say "See Task 4.6 for bundled baseline promotion" instead of instructing inline overwrites.

---

#### Task 4.6: Promote passing provider baselines

Overwrite the current (provisional) baselines with the passing post-hardening runs:

| Baseline file                        | Source run file                     | Gate   |
| ------------------------------------ | ----------------------------------- | ------ |
| `gold-v1-anthropic-baseline.json`    | `gold-v1-run-1774565983521.json`    | PASSED |
| `regression-anthropic-baseline.json` | `regression-run-1774566090698.json` | PASSED |
| `hard-anthropic-baseline.json`       | `hard-run-1774566191302.json`       | PASSED |

Retain the following timestamped artifacts as committed historical snapshots (do not delete):

- `gold-v1-run-1774545137202.json` (pre-hardening fixture run)
- `gold-v1-run-1774565983521.json` (post-hardening provider run)
- `gold-v1-comparison-1774545137265.md`
- `gold-v1-comparison-1774565983554.md`
- `regression-run-1774566090698.json`
- `regression-comparison-1774566090717.md`
- `hard-run-1774566191302.json`
- `hard-comparison-1774566191316.md`

---

#### Task 4.7: Capture final release evidence

Update the plan execution summary and `docs/spec-gap-tracker.md` with the final deltas from the post-hardening comparison reports:

**gold-v1** (source: `gold-v1-comparison-1774565983554.md`):

| Metric                         | Slice       | Baseline | Post-hardening | Delta   |
| ------------------------------ | ----------- | -------- | -------------- | ------- |
| field_accuracy                 | \_overall   | 0.7894   | 0.8236         | +0.0342 |
| field_accuracy                 | hvac        | 0.6889   | 0.8057         | +0.1168 |
| field_accuracy                 | emergency   | 0.7358   | 0.7799         | +0.0442 |
| field_accuracy                 | multi_issue | 0.7605   | 0.7960         | +0.0355 |
| schema_invalid_rate            | \_overall   | 0.0047   | 0.0000         | -0.0047 |
| schema_invalid_rate            | multi_issue | 0.0123   | 0.0000         | -0.0123 |
| contradiction_after_retry_rate | \_overall   | 0.0047   | 0.0000         | -0.0047 |
| contradiction_after_retry_rate | multi_issue | 0.0123   | 0.0000         | -0.0123 |

Non-targeted slices also improved (no regressions anywhere):

| Metric         | Slice        | Baseline | Post-hardening | Delta   |
| -------------- | ------------ | -------- | -------------- | ------- |
| field_accuracy | pest_control | 0.8889   | 0.9145         | +0.0256 |
| field_accuracy | electrical   | 0.8296   | 0.8654         | +0.0358 |
| field_accuracy | appliance    | 0.8722   | 0.8944         | +0.0222 |
| field_accuracy | carpentry    | 0.8194   | 0.8472         | +0.0278 |

**regression** (source: `regression-comparison-1774566090717.md`):

- Passed without blocking regressions
- hvac slice improved: 0.8571 -> 0.9286 (+0.0714)

**hard** (source: `hard-comparison-1774566191316.md`):

- Overall improved: 0.7566 -> 0.7854 (+0.0288)
- slang slice improved: 0.6071 -> 0.7857 (+0.1786)
- typo slice improved: 0.8929 -> 0.9286 (+0.0357)
- ambiguous slice improved: 0.6571 -> 0.6857 (+0.0286)

---

#### Task 4.8: Final verification checkpoint

Run the standard repo verification pass before committing baseline promotions:

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Review the eval comparison artifacts once more before baseline promotion is committed. Mark Batch 4 complete only after baselines and evidence are both updated and verification is green.

---

### Plan cleanup

Update the existing Batch 4 and Assumptions text to reflect the approved 2b scope and the now-complete eval state:

1. **Task 4.3 line 611**: Replace `"emergency: field_accuracy improvement limited by held-back disputed items"` with `"emergency: field_accuracy improvement reflects Batch 2b escalation policy (whole-suite vital-service loss + access/security). Remaining ceiling driven by electrical-safety scenarios that stay at Priority=high."`

2. **Task 4.3 Emergency slice note** (lines 606-607): Replace `"Emergency slice note: ... The remaining ceiling is mainly driven by electrical-safety language, which still remains at high in risk_protocols.json."` — update to note that Batch 2b has been executed and the remaining gap is specifically electrical-safety language.

3. **Assumption A5**: Update to reflect that the provisional condition (blocking-rate metrics reaching zero) is now met. The baseline is no longer provisional — `schema_invalid_rate = 0` and `contradiction_after_retry_rate = 0` in the passing run.

4. **Assumption A7**: Replace `"The remaining improvement ceiling is limited mainly by electrical-safety scenarios that still stay at high"` — remove "mainly" hedging since the comparison data now confirms this is the specific remaining gap.

5. **Tasks 4.3-4.5 Post-run instructions**: In the parent plan, replace the "Post-run" paragraph of Task 4.3 (`gold-v1-slice-hardening.md` line 614), Task 4.4 (line 628), and Task 4.5 (line 642) with: `"Post-run: Baseline promotion is handled in Task 4.6. Do not overwrite the baseline file here."` This eliminates the conflicting instructions about when promotion happens.

6. **Plan status**: Change from `"Ready for peer review"` to `"Closeout in progress"` once Tasks 4.6-4.8 begin. Change to `"Complete"` once Tasks 4.6-4.8 are committed.

---

### Post-plan closeout

Treat these as delivery tasks, not core plan batches:

- Prepare the final commit/PR summary with:
  - Implementation scope (Batches 1, 2, 3, 2b executed; cue versions 1.6.0 -> 1.7.0; prompt versions 2.3.0 -> 2.4.0)
  - Eval outcomes (all three dataset gates PASSED; zero schema/contradiction failures; overall field_accuracy 0.7894 -> 0.8236)
  - Explicit note that electrical safety remains Priority=`high` and is not addressed in this plan
  - Links to timestamped comparison reports for auditability
- Close out the branch only after baseline files, docs, and evidence updates are committed together in a single coherent commit
- Run `/update-vault post-commit` after the final commit to sync the ActionPM2 vault

---

### Successor work

Do not keep a generic "remaining Batch 2b decision" item. Replace it with a narrower follow-up:

- **Optional follow-up: Electrical-safety escalation policy**
  - Decide whether `sparks`, `exposed wires`, and related electrical-safety language should remain Priority=`high` or move to Priority=`emergency`
  - The gold-v1 comparison (`gold-v1-comparison-1774565983554.md`) documents the remaining ceiling from these items
  - If promotion is desired, create a separate mini-plan with its own cue/prompt/risk-protocol version bump (use the next available cue and prompt versions at the time of that plan)
  - Do not fold that decision into the current `2.4.0` closeout

---

## Test Plan

- [ ] Confirm the three promoted baseline files exactly match the content of the passing provider run files listed in Task 4.6
- [ ] Confirm `docs/spec-gap-tracker.md` contains the final metric deltas from the Task 4.7 tables
- [ ] Confirm the plan execution summary references the correct comparison report filenames
- [ ] Confirm no stale plan text still says Batch 2b is pending, that emergency gains are blocked by "held-back disputed items", or that the baseline is "provisional"
- [ ] Confirm Assumption A5 is updated to reflect the baseline is no longer provisional
- [ ] Confirm `pnpm test && pnpm typecheck && pnpm lint` passes before branch closeout
- [ ] Confirm timestamped artifacts listed in Task 4.6 are committed and not deleted

---

## Assumptions

- The passing provider-backed eval artifacts already generated are the intended source for baseline promotion (run files listed in Task 4.6)
- No additional code changes are required before baseline overwrite and evidence capture
- Electrical safety remains intentionally out of scope for `emergency` promotion in this plan; the successor follow-up item captures this explicitly
- Branch/PR closeout is required operationally, but is treated as post-plan delivery work rather than another implementation batch
- Assumption A5's provisional condition is now met — the promoted baselines are accepted comparison floors, not provisional snapshots
