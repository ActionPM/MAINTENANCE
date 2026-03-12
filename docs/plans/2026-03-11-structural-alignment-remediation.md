# Structural Alignment Remediation Plan

**Date:** 2026-03-11

**Goal:** Resolve the highest-risk structural gaps between the documented architecture in `docs/spec.md`, `AGENTS.md`, and `docs/spec-gap-tracker.md` and the runtime structure that actually exists in the repository.

**Scope:** This plan covers only structural alignment work. It does not try to finish every missing product feature. It now distinguishes between:

- `must_fix`: runtime/security gaps that should be treated as active engineering work
- `accepted_deviation`: reasonable implementation choices that only become debt if we keep the old docs
- `doc_only`: governance/documentation gaps that should be tracked, but not treated as runtime blockers

## Disposition Summary

| Disposition          | Tracker IDs                                                          | Handling rule                                                                            |
| -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `must_fix`           | `S09-02`, `S24-02`, `S24-03`, `S24-11`, `S24-12`, `S07-05`, `S17-02` | Implement or explicitly de-scope from the supported product surface                      |
| `accepted_deviation` | `S07-02`, `S18-05`, `S24-16`, `S24-17`, `S24-18`, `S25-03`           | Make an explicit architectural/product decision, then update the governing docs to match |
| `doc_only`           | `S27-12`, `S27-13`, `S27-14`, `S27-16`, `S27-17`, `S27-18`           | Reconcile documentation without treating these as code-completion blockers               |

## Active Workstreams (`must_fix`)

| Workstream                          | Tracker IDs                                      | Why first                                                                                                                     | Exit criteria                                                                                                                           |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ownership and required read APIs | `S09-02`, `S24-02`, `S24-03`, `S24-11`, `S24-12` | These are the highest-risk tenant-facing gaps: cross-tenant access risk and missing read paths                                | Conversation ownership is enforced in the dispatcher and all required conversation/work-order read routes exist on the documented paths |
| 2. Classification audit fidelity    | `S07-05`                                         | The current production persistence path weakens the audit trail by dropping `issue_id` structure from classification events   | Classification-domain identifiers survive persistence and remain queryable in the stored event stream                                   |
| 3. Risk runtime decision            | `S17-02`                                         | Emergency escalation cannot remain implicitly supported while the production factory injects empty plans and a no-op executor | Emergency routing is either wired end-to-end or explicitly removed from the supported runtime scope and governing docs                  |

Detailed execution plan for Workstream 1: `docs/plans/2026-03-11-mvp-identity-access-plan.md`

## Decision Tracks (`accepted_deviation`)

| Topic                        | Tracker IDs                            | Decision to ratify                                                                                                                |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Event-table shape            | `S07-02`                               | Keep the generic append-only event log as an MVP simplification, or move back toward seven domain tables                          |
| Session concurrency contract | `S18-05`                               | Keep last-write-wins for sessions as an intentional single-writer assumption, or add optimistic locking and keep the current docs |
| Secondary API surface        | `S24-16`, `S24-17`, `S24-18`, `S25-03` | Treat notification/preferences/overrides/health sub-routes as deferred scope, or restore them as committed endpoints              |

## Documentation Track (`doc_only`)

| Topic                         | Tracker IDs                  | Documentation outcome                                                                                     |
| ----------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Required governance artifacts | `S27-12`, `S27-13`, `S27-14` | Author the required docs and RFC location without tying them to runtime sequencing                        |
| Source-of-truth alignment     | `S27-16`, `S27-17`, `S27-18` | Pick one planning convention, one canonical spec/taxonomy path, and one accurate orchestrator description |

## Execution Order

1. Fix tenant ownership checks in the dispatcher before adding more read routes.
2. Implement `GET /conversations/:id`, move drafts to `/conversations/drafts`, then add `GET /work-orders` and `GET /work-orders/:id`.
3. Preserve classification event identifiers in the production persistence path.
4. Decide whether emergency escalation stays in MVP/runtime scope; if yes, wire it end-to-end immediately after the read surfaces are trustworthy.
5. Ratify accepted deviations in `docs/spec.md`, `AGENTS.md`, and `docs/spec-gap-tracker.md` so they stop reading as accidental defects.
6. Reconcile governance docs after the architectural decisions are explicit.

## Decisions Required

1. Emergency escalation scope: keep it as an active runtime commitment, or explicitly de-scope it for the current release.
2. Event persistence model: keep the generic append-only event log, or commit to restoring the spec's seven-table model.
3. Session concurrency: document last-write-wins as intentional, or implement optimistic locking and keep the current mutable-table rule.
4. Secondary API surface: keep notification/preferences/override/health sub-routes as deferred, or promote them back into the required API surface.
5. Planning and source-of-truth conventions: keep `docs/plans/` as canonical and collapse duplicate spec/taxonomy paths, or intentionally support multiple mirrored copies.

## Proposed Deliverables

- Code:
  - Dispatcher ownership guard
  - Required read routes on spec paths
  - Classification-event persistence that preserves `issue_id`
  - Emergency router wiring or an explicit runtime de-scope
- Docs:
  - `docs/security-boundaries.md`
  - `docs/retention-policy.md`
  - `docs/rfcs/`
  - Updated `AGENTS.md` and/or `docs/spec.md` for accepted deviations and governance decisions
  - Updated `docs/spec-gap-tracker.md` after each decision or merged workstream

## Validation

- Every changed tracker row must be updated in the same PR.
- Every new route must have auth and ownership tests.
- Any persistence change for classification events needs repository coverage proving `issue_id` survives storage.
- If session locking remains last-write-wins, the docs must say so explicitly.
- Governance/doc changes should end with no conflicting "source of truth" statements across spec, AGENTS, and tracker.
