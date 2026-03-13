# Code Gate Plan

**Date:** 2026-03-13

## Goal

Reach the `Code Gate` milestone for the current MVP branch.

For this milestone, every tracker row in scope must be one of:

- `DONE`
- `INTENTIONAL_MVP`

`PARTIAL` and `MISSING` are not allowed at exit.

`Code Gate` is a repository-completeness gate. It is not the same as external staging/runtime validation. Runtime validation remains a separate release gate after this plan is complete.

## Gate Rule

A tracker row may close only in one of these two ways:

1. **Implemented and verified**
   - code, schema, route, migration, or docs are added as needed
   - tests are added or updated
   - `docs/spec-gap-tracker.md` is updated in the same PR
2. **Explicitly deferred from MVP**
   - `docs/spec.md` is updated to state the deferral clearly
   - the tracker row is changed to `INTENTIONAL_MVP` in the same PR

Tracker-only relabeling is not allowed.

## Current Baseline

From [docs/spec-gap-tracker.md](../spec-gap-tracker.md) (audited 2026-03-13):

- `DONE`: 120
- `PARTIAL`: 21
- `MISSING`: 11
- `INTENTIONAL_MVP`: 5

Evidence corrections applied during audit (no status changes): S05-02, S10-03, S10-04, S12-02, S17-04, S26-03.

Open rows to resolve for Code Gate:

- Versioning and resume integrity:
  - `S05-02`, `S05-03`, `S12-02`, `S26-03`
- Runtime payload and response contract:
  - `S10-03`
- Rate limits and security auditability:
  - `S08-03`, `S08-04`, `S08-05`, `S08-08`
- Photo/storage/scanning flow:
  - `S01-13`, `S06-05`, `S19-02`, `S19-03`, `S19-04`, `S19-05`
- Follow-up and risk behavior:
  - `S12-03`, `S17-04`
- Corrections and overrides:
  - `S07-04`, `S26-02`
- Tenant signals, compliance, and future-language design:
  - `S01-07`, `S01-08`, `S01-11`, `S01-12`
- Evaluation and deployment-process closure:
  - `S14-06`, `S26-01`, `S26-05`
- Required governance artifacts and source-of-truth alignment:
  - `S27-12`, `S27-13`, `S27-14`, `S27-16`, `S27-17`, `S27-18`

## Workstreams

| Workstream                         | Tracker IDs                                                          | Why this is a single unit                                                                                                                                                                                                                                                                                      | Exit condition                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Version Contract                | `S05-02`, `S05-03`, `S12-02`, `S26-03`                               | All four rows are the same defect class: pinned versions exist, but are not authoritative or enforced on resume.                                                                                                                                                                                               | Sessions and resumed conversations use real pinned versions, and tests cover both creation and resume behavior.                         |
| 2. Response and Security Hardening | `S10-03`, `S08-03`, `S08-04`, `S08-05`, `S08-08`                     | These are API-contract and guardrail gaps that affect every intake path. **Note:** `S08-04` (max photo size) can enforce declared `size_bytes` independently; actual file-size verification needs WS3 storage backend.                                                                                         | Request/response artifacts are complete, limits are enforced server-side, and violations are auditable.                                 |
| 3. Photo Pipeline Closure          | `S01-13`, `S06-05`, `S19-02`, `S19-03`, `S19-04`, `S19-05`           | These rows are one end-to-end surface: draft photos, storage, scanning, WO attachment, and post-submission uploads.                                                                                                                                                                                            | Photo behavior is either fully implemented as specified or explicitly deferred in `docs/spec.md`.                                       |
| 4. Intake Flow Edge Cases          | `S12-03`, `S17-04`                                                   | Both are conversation-flow correctness gaps in active runtime logic.                                                                                                                                                                                                                                           | New issues are queued correctly during follow-ups, and mitigation display respects confirmation gating.                                 |
| 5. Corrections and Human Override  | `S07-04`, `S26-02`                                                   | Both depend on an append-only override model with reason-coded events.                                                                                                                                                                                                                                         | Override events are persisted correctly and exposed through a minimal supported submission path, or the surface is explicitly deferred. |
| 6. Product Completeness            | `S01-07`, `S01-08`, `S01-11`, `S01-12`, `S14-06`, `S26-01`, `S26-05` | These are the remaining product and evaluation claims that keep the tracker from a clean gate. **Decision checkpoint required** — several rows (`S01-08` tone/frustration, `S01-11` i18n, `S26-05` canary) are strong deferral candidates per spec §1.7 (signals are flag-only) and §1.8 (French is post-MVP). | Each row is either implemented and tested or moved to explicit MVP deferral in the spec.                                                |
| 7. Governance Closure              | `S27-12`, `S27-13`, `S27-14`, `S27-16`, `S27-17`, `S27-18`           | These rows are docs-only, but Code Gate requires the tracker to be fully closed.                                                                                                                                                                                                                               | Required artifacts exist and governance docs no longer disagree about plan location, canonical sources, or controller shape.            |

## Execution Order

1. Close version integrity first (WS1).
2. Close API/security contract gaps (WS2) — `S08-04` enforces declared size; actual file verification deferred to WS3.
3. Make a product decision on the photo surface (WS3 decision), then implement or defer.
4. Finish the active intake-flow gaps (WS4).
5. Resolve override/corrections (WS5).
6. Resolve remaining product and evaluation rows (WS6) — decision checkpoint first.
7. Close governance/documentation rows (WS7).
8. Run a full tracker sweep and update `docs/spec-gap-tracker.md` in the final PR of each workstream.

## Workstream Details

### 1. Version Contract

**Rows:** `S05-02`, `S05-03`, `S12-02`, `S26-03`

**Implementation tasks**

- Replace hardcoded `pinned_versions` at conversation creation with dynamically resolved values.
- Define one authoritative source each for:
  - `taxonomy_version`
  - `schema_version`
  - `model_id`
  - `prompt_version`
- Ensure resumed conversations retain their original pinned versions even when newer versions exist.
  - **Note:** The current resume path already preserves versions naturally — the session is loaded from the store unchanged and the RESUME handler (`resume.ts`) returns `ctx.session` as-is. The gap is defense-in-depth: adding an explicit assertion that pinned versions have not been tampered with between save and restore.
- Add explicit resume-path guards so pinned versions are not silently overwritten.

**Verification**

- Unit tests for session creation pinning.
- Unit/integration tests for resume behavior.
- Tracker evidence points to the real creation and resume code paths.

### 2. Response and Security Hardening

**Rows:** `S10-03`, `S08-03`, `S08-04`, `S08-05`, `S08-08`

**Implementation tasks**

- Populate `OrchestratorActionResponse.artifacts` and related response metadata from split, classification, and follow-up results.
- Enforce:
  - max photo uploads per conversation (per-conversation counter)
  - max photo size (declared `size_bytes` can be validated in `handlePhotoUpload()` without a storage backend; actual uploaded file-size verification requires WS3 storage integration)
  - max message length (server-side validation in API routes — currently UI-only in `message-input.tsx`)
- Emit structured security events on rate-limit violations (extend `rate-limiter.ts` to call event store or structured logger on 429).

**Verification**

- Request-validation tests for message and photo limits.
- Repository or route tests proving violations are logged as security events.
- Response-shape tests proving artifacts and typed metadata are populated.

### 3. Photo Pipeline Closure

**Rows:** `S01-13`, `S06-05`, `S19-02`, `S19-03`, `S19-04`, `S19-05`

**Decision checkpoint**

Before implementation, decide whether the full photo surface is still inside the committed MVP.

- If **yes**:
  - implement object storage integration
  - generate presigned upload URLs
  - persist `sha256`, `scanned_status`, `storage_key`
  - add async scanning and PM visibility gating
  - add post-submission WO-scoped upload endpoint
  - link intake draft photos to created work orders on submission
- If **no**:
  - update `docs/spec.md` to defer the missing photo requirements explicitly
  - move only the truly deferred rows to `INTENTIONAL_MVP`
  - keep any retained photo behavior fully implemented and accurately tracked

**Verification**

- End-to-end tests for:
  - `init -> upload -> complete`
  - draft photo persistence
  - photo-to-WO linking on submission
  - post-submission upload targeting a specific `work_order_id`
- Security/visibility tests for scan-blocked photos.

### 4. Intake Flow Edge Cases

**Rows:** `S12-03`, `S17-04`

**Implementation tasks**

- Detect when `SUBMIT_ADDITIONAL_MESSAGE` during follow-ups is a new issue rather than clarification.
- Queue new issues and continue the current issue flow before offering the next intake.
- Suppress mitigation display for `requires_confirmation` risk triggers until after `CONFIRM_EMERGENCY`.

**Verification**

- Conversation-flow tests covering:
  - clarification vs new-issue detection
  - queued issue handling
  - mitigation display before and after emergency confirmation

### 5. Corrections and Human Override

**Rows:** `S07-04`, `S26-02`

**Decision checkpoint**

Decide whether a minimal PM/human override path is part of the committed MVP.

- If **yes**:
  - implement append-only human override events with reason codes
  - add the minimal supported submission path
  - make effective classification derive from latest approved override
- If **no**:
  - explicitly defer the override workflow in `docs/spec.md`
  - move only the appropriate rows to `INTENTIONAL_MVP`

**Verification**

- Event-store tests proving corrections are append-only.
- Domain tests proving latest approved override becomes effective state.
- API or service tests for reason-coded override submission.

### 6. Product Completeness

**Rows:** `S01-07`, `S01-08`, `S01-11`, `S01-12`, `S14-06`, `S26-01`, `S26-05`

**Decision checkpoint**

Before implementation, classify each row as implement or defer. Likely deferral candidates based on spec language:

- `S01-08`: Spec §1.7 says signals are "flag-only" and "never change taxonomy outputs or priority." Tone/frustration scoring is informational infrastructure that does not affect the intake pipeline. Strong deferral candidate.
- `S01-11`: Spec §1.8 says "MVP English; design supports French later." No French support is needed for MVP. The deferral is designing for later without taxonomy drift — a documented i18n approach (not a full implementation) may suffice.
- `S26-05`: Vercel provides instant rollback. A formal canary process is operational, not a code artifact. Strong deferral candidate unless a written runbook is considered in-scope.

**Implementation or deferral tasks**

- `S01-07`: compute HVT flag from 3 open work orders. Spec §1.7 defines the threshold. Small scope.
- `S01-08`: implement tone/frustration and history summary, or explicitly defer in `docs/spec.md`.
- `S01-11`: add a documented i18n design that preserves taxonomy invariance, or explicitly defer.
- `S01-12`: implement jurisdiction resolution feeding existing override-capable policy logic.
- `S14-06`, `S26-01`: create Gold Set B and Gold Set C, and use them to validate confidence bands.
- `S26-05`: document canary and rollback process as an actual release procedure, or explicitly defer.

**Verification**

- Analytics/service tests for HVT computation.
- Documentation or architecture tests for language/taxonomy isolation where applicable.
- Evals artifacts checked into repo for Gold Set B/C.
- CI or runbook evidence for canary/rollback process.

### 7. Governance Closure

**Rows:** `S27-12`, `S27-13`, `S27-14`, `S27-16`, `S27-17`, `S27-18`

**Implementation tasks**

- Create:
  - `docs/security-boundaries.md`
  - `docs/retention-policy.md`
  - `docs/rfcs/`
- Choose one canonical plan location and align `docs/spec.md` and `AGENTS.md`.
- Choose one canonical spec and taxonomy path and mark any mirrored copies explicitly.
- Reconcile the documented orchestrator architecture with the runtime structure:
  - either refactor runtime closer to the documented pure-function pattern
  - or update `AGENTS.md` to describe the architecture that actually exists
  - **Recommended:** Update `AGENTS.md`. The current architecture (handlers perform side effects inline) is working correctly and is well-tested. Refactoring toward deferred side effects is a large structural change with no functional benefit at this stage. The cheaper and safer path is aligning the docs to the code.

**Verification**

- Direct file existence checks.
- No contradictory source-of-truth statements remain across `AGENTS.md`, `docs/spec.md`, and `docs/spec-gap-tracker.md`.

## PR Strategy

Use small PRs, but require tracker updates in the same PR as the implementation or spec deferral that closes rows.

Suggested PR sequence:

1. Version Contract
2. Response and Security Hardening (`S08-04` enforces declared size; actual file-size verification deferred to WS3)
3. Photo Decision PR
4. Photo Implementation or Photo Deferral PR(s)
5. Intake Flow Edge Cases
6. Override Decision PR
7. Override Implementation or Override Deferral PR
8. Product Completeness Decision + Implementation/Deferral PR(s)
9. Governance Closure
10. Final tracker sweep PR only if it contains no status changes beyond evidence tightening

## Validation Checklist

For every PR that claims to close tracker rows:

- Add failing tests first, then implementation.
- Run:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm format:check`
- Run DB migrations when applicable:
  - `pnpm --filter @wo-agent/db migrate`
- Update only the affected tracker rows in `docs/spec-gap-tracker.md`.
- Recalculate summary totals when any row status changes.
- Do not use `INTENTIONAL_MVP` unless the spec is updated in the same PR.

## Code Gate Exit Criteria

Code Gate is complete when all of the following are true:

1. `docs/spec-gap-tracker.md` contains no `PARTIAL` or `MISSING` rows that are in current MVP scope.
2. Every remaining non-`DONE` row is `INTENTIONAL_MVP` with matching deferral language in `docs/spec.md`.
3. Every status change is backed by code, docs, schema, migrations, tests, or explicit spec deferral in the same PR.
4. Summary counts in the tracker are correct.
5. Repo-wide validation passes:
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm format:check`

## Non-Goals

This plan does not include:

- external staging/runtime validation
- production cutover
- secret rotation execution
- post-release monitoring signoff

Those belong to the runtime/release gate after Code Gate is closed.
