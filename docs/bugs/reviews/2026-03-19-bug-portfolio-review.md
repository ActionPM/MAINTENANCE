# 2026-03-19 Bug Portfolio Review

## Scope

Reviewed the open bug notes in `ActionPM2/02_System/Bugs/` against the current `Work Order Agent` repository state:

- `BUG-001` - No Heat Follow Up Questions
- `BUG-002` - Entering Service Requests Before Unit
- `BUG-003` - Wrong Follow Up Questions

Checked each bug against:

- `docs/bug-tracker.md`
- `docs/spec.md`
- current UI and orchestrator code paths
- current cue dictionary and follow-up prompt behavior
- existing downstream plan `docs/plans/2026-03-19-bug-001-no-heat-fix.md`

## Snapshot

- Open bugs reviewed: 3
- Shared cluster: 2 (`BUG-001`, `BUG-003`)
- Isolated bug: 1 (`BUG-002`)
- Duplicate candidates: none
- New launch blocker discovered: none
- New demo-readiness risk confirmed: `BUG-002`

## Cluster: Confidence Coverage

### Bugs

- `BUG-001`
- `BUG-003`

### Shared Cause

The classifier and follow-up stack still has a confidence-coverage gap between what tenants plainly imply and what the cue system boosts strongly enough to avoid follow-up.

Current repo evidence:

- `packages/schemas/classification_cues.json` still limits `Category.maintenance` to `leak`, `broken`, `repair`, `not working`, and `clog`.
- HVAC and no-heat language still does not boost `Category.maintenance`.
- `Location.suite` still relies on explicit apartment and unit phrasing and does not cover possessive object phrasing such as `my toilet`.
- `Sub_Location.general` still does not express whole-unit HVAC coverage from heating language alone.
- `apps/web/src/components/followup-form.tsx` still renders raw taxonomy slugs.
- `apps/web/src/components/confirmation-panel.tsx` still renders raw classification values.
- `packages/core/src/llm/prompts/followup-prompt.ts` still has no explicit whole-unit HVAC rule or overflow-specific emergency questioning rule.

### Portfolio Judgment

`BUG-001` and `BUG-003` are related, but not duplicates.

- `BUG-001` is the HVAC and whole-unit coverage case.
- `BUG-003` is the possessive-location and overflow inference case.

They belong in the same `confidence-coverage` cluster, but the current downstream plan is only a partial fit.

### Gap In Existing Plan

`docs/plans/2026-03-19-bug-001-no-heat-fix.md` is directionally correct for `BUG-001`, but it does not yet explicitly cover the additional acceptance needed for `BUG-003`:

- maintenance cue coverage for `overflow` and `overflowing`
- suite and location inference from possessive phrasing such as `my toilet`
- regression coverage for toilet-overflow follow-up quality

### Recommended Next Artifact

Extend `docs/plans/2026-03-19-bug-001-no-heat-fix.md` into a broader confidence-coverage plan, or create a small delta plan for `BUG-003` that adds:

- overflow and overflowing maintenance cues
- possessive suite and location cue coverage
- targeted regression cases for toilet overflow

## Cluster: Demo UX / Unit Gating

### Bug

- `BUG-002`

### Cause

The UI still exposes message entry before unit resolution in the multi-unit path.

Current repo evidence:

- `packages/core/src/orchestrator/action-handlers/create-conversation.ts` still returns `intake_started` for multi-unit tenants.
- `apps/web/src/components/chat-shell.tsx` still allows `MessageInput` in `intake_started`.
- demo mode now also passes `defaultValue={demoMessage}` into that input, which makes premature submission easier during stakeholder demos.
- `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts` still rejects the request with `UNIT_NOT_RESOLVED`, so the server-side contract is intact but the front-end path remains invalid.

### Portfolio Judgment

This is an isolated bug, not part of the confidence-coverage cluster.

It is not a launch blocker by severity, but it is a real demo-readiness issue because it creates an avoidable invalid action on the first screen for multi-unit tenants.

### Recommended Next Artifact

Create a narrow UI plan to:

- hide or disable initial message entry until `unit_selected`
- avoid demo prefill before unit selection completes
- add a regression test for the multi-unit create-conversation state

## Tracker Decisions

- Move `BUG-001` to `CLUSTERED`
- Keep `BUG-002` at `REPO_REVIEWED`
- Move `BUG-003` to `CLUSTERED`
- Treat `BUG-001` and `BUG-003` as one remediation cluster with two distinct acceptance surfaces
- Do not mark `BUG-003` as fully covered by the current `BUG-001` plan without extending that plan

## Recommended Follow-Through

1. Extend the confidence-coverage remediation plan so it explicitly covers both `BUG-001` and `BUG-003`.
2. Create a small isolated UI fix plan for `BUG-002`.
3. Add regression coverage for no-heat and toilet-overflow follow-up quality before moving the confidence cluster to `VERIFIED`.
