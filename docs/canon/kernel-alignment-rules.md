
# ActionPM Kernel Alignment Rules for Frontend

## 1. Purpose

This file defines how the frontend stays aligned with the maintenance kernel, shared contracts, taxonomy, KPI semantics, security rules, and eval posture.

Use it to stop frontend drift early.

---

## 2. Core rule

The frontend is **downstream of the kernel**.

That means the frontend may shape presentation, but it may not replace or reinterpret upstream governed meaning without explicit canon change.

---

## 3. Authoritative upstream artifacts

Treat the following as authoritative for frontend alignment:
1. kernel-controlled workflow and action rules
2. shared schemas and validators
3. governed taxonomy and crosswalks
4. normalized internal API and event contracts
5. KPI definitions and drilldown rules
6. security, RBAC, and session policy
7. eval and regression fixtures
8. canonical division notes

### Hard rule
The frontend must import, derive from, or explicitly trace to these sources. It must not maintain shadow truth for governed domains.

---

## 4. What must always flow downstream

The following always flow from kernel / canon into the UI:
- workflow states
- allowed actions
- taxonomy values for governed fields
- canonical terminology for governed records
- contract fields and response shapes
- freshness and source-health indicators
- KPI logic and record inclusion rules
- reopen logic
- exclusion-from-reporting logic
- drilldown paths
- security and permission requirements
- privileged-action requirements

---

## 5. What may remain frontend-local

The following may remain frontend-local when they do not change meaning:
- layout
- route naming
- interaction choreography
- responsive behavior
- local component composition
- non-authoritative helper copy
- transient UI state
- theme implementation details

### Hard rule
Frontend-local decisions stop being local the moment they change:
- workflow meaning
- KPI meaning
- contract semantics
- taxonomy meaning
- user trust markers
- permission meaning

---

## 6. No-shadow-model rule

### Hard rules
Do not create frontend-only shadow models for:
- workflow states
- KPI names or KPI logic
- taxonomy values for governed fields
- permission roles for guarded actions
- draft artifact lifecycle states
- freshness states when those states come from contract or canon

### Allowed exception
A frontend-local display map is allowed only if it is a thin rendering layer over canonical values and does not create new behavior or new meaning.

## 6A. No shadow taxonomy

The frontend must not define a **no shadow taxonomy** exception for itself.

The frontend must not define a shadow taxonomy, duplicate taxonomy enum set, or local reinterpretation of canonical taxonomy values.

---

## 7. Taxonomy alignment rules

### Hard rules
- Use shared taxonomy values or generated client-safe derivatives.
- Do not rename governed taxonomy categories locally without explicit canon approval.
- Do not merge or split governed taxonomy branches in UI-only code.
- When a taxonomy-linked UI surface changes, run Semantics + Governance review.

### Required artifact when taxonomy-linked behavior changes
At minimum, add one of:
- task-level terminology note
- updated contract note
- updated canon note

---

## 8. Contract alignment rules

### Hard rules
- The frontend consumes normalized internal ActionPM contracts.
- Hand-written duplicate interfaces for guarded objects are not allowed when shared types or validators exist.
- Contract fixtures are required for guarded frontend adapters.
- Contract changes must preserve freshness/source-health truth fields when they are required for truthful display.

### Required artifact for contract changes
- `contract-note.md`
- updated contract fixture or adapter fixture
- critic review from Semantics / Contract

## 8A. No shadow contract

The frontend must not define **no shadow contract** exceptions for guarded objects.

The frontend must not define shadow contracts for guarded domain objects when shared contracts exist upstream.

---

## 9. Workflow boundary alignment rules

### Hard rules
The frontend may expose only the committed phase-one workflow slice:
- generate draft PO
- review draft
- edit draft
- save draft
- export/download PDF
- record or display handoff state

### Forbidden implications
The frontend must not imply:
- official PO issuance
- approval inside ActionPM
- downstream procurement completion
- quote review completion
- invoice completion
- maintenance completion verification

### Required artifact for workflow changes
- workflow-facing feature packet
- security review
- quality scenario update
- doc delta

---

## 10. KPI semantic alignment rules

### Hard rules
- KPI behavior is configuration-driven.
- KPI surfaces must be traceable to underlying record sets.
- Every shipped KPI definition must have explicit inclusion, exclusion, and drilldown rules.
- Reopened requests must behave as though they were never durably closed.
- Excluded-from-reporting records must remain auditable.
- Aggregate card logic must not hide materially aged or important underlying records.

### Required artifact for KPI changes
- `kpi-definition-pack.md`
- drilldown truth table
- updated scenario coverage

## 10A. Drilldown rule

Every KPI, count, flag, or aggregate presented as operational truth must support **drilldown** to underlying records or clearly explain why drilldown is unavailable.

---

## 11. Security and session alignment rules

### Hard rules
- Authentication and authorization are server-authoritative.
- UI visibility is not the source of enforcement.
- Session expiry must block privileged actions.
- Step-up reauth must remain enforced for export/download, handoff, and access changes.
- Scope changes or revocation must not leave unsafe local context active.

### Required artifact for security-visible changes
- `security-review.md`
- updated access-state matrix if relevant
- quality scenario update when behavior is high-risk

---

## 12. Degraded-state truth alignment rules

### Hard rules
The frontend must make the following explicit when relevant:
- stale data
- partial data
- source failure
- live-update disconnect
- reconnect in progress
- unconfirmed export
- unconfirmed handoff

### Forbidden behavior
- showing stale state as current without a warning
- collapsing partial data into apparent completeness
- implying successful handoff when handoff is only pending or unconfirmed

### Required artifact for degraded-state behavior changes
- `truth-matrix.md`
- updated scenario coverage

---

## 13. Trigger matrix for kernel-alignment review

Kernel-alignment review is mandatory for:
- shared schema changes
- contract changes
- taxonomy-linked UI changes
- workflow state or action changes
- KPI definition changes
- drilldown changes
- export or handoff changes
- auth / RBAC / session changes
- source-health or freshness behavior changes
- AI-visible advisory behavior changes

## 13A. Release-sensitive alignment triggers

Kernel-alignment review is mandatory for **release-sensitive** changes, including:
- workflow state changes
- KPI definition changes
- drilldown behavior changes
- contract or payload shape changes
- auth / session / permission changes
- degraded-state truth changes
- taxonomy-linked UI behavior
- export and handoff behavior

## 13B. Doc gate

The **doc gate** applies to guarded changes.

Guarded changes require either:
- canonical doc update, or
- explicit `no-canon-change.md` rationale

---

## 14. Drift detection model

### Required checks
1. **Path-based classification**
   - if guarded paths change, mark the task as kernel-alignment-required

2. **No-shadow-model check**
   - fail when duplicate governed enums or workflow states appear locally without justification

3. **Contract fixture check**
   - fail guarded adapter changes without updated fixtures or contract notes

4. **KPI artifact check**
   - fail KPI changes without KPI definition pack and drilldown note

5. **Workflow action matrix check**
   - verify visible actions against canonical workflow rules

6. **Terminology check**
   - verify protected terms do not drift silently

7. **Doc gate**
   - require canon note update or `no-canon-change.md` rationale for guarded changes

8. **Weekly drift scan**
   - documentation-maintenance lane proposes drift review

## 14A. Drift detection

**Drift detection** must include:
- path-based PR classification
- no-shadow-model lint
- contract fixture checks
- workflow action checks
- terminology protection
- weekly drift review

---

## 15. Merge blockers

Block merge when any of the following are true:
- a guarded change lacks a task packet
- contract change lacks contract artifact
- KPI change lacks KPI artifact
- workflow change lacks security and quality review
- degraded-state change lacks truth matrix
- shadow model introduced for governed behavior
- canon-impact exists but no doc delta or rationale exists
- unresolved critic or auditor blocker remains

---

## 16. Minimum file set for enforcement

At minimum, keep these current:
- `docs/canon/frontend-spec.md`
- `docs/canon/repo-policy.md`
- `.actionpm/templates/task-meta.yaml`
- `.actionpm/templates/contract-note.md`
- `.actionpm/templates/kpi-definition-pack.md`
- `.actionpm/templates/security-review.md`
- `.actionpm/templates/truth-matrix.md`
- `.actionpm/templates/doc-delta.md`

---

## 17. Source basis

This file is downstream of:
- `2026-04-03 - DIV 00 - Program and Governance - V6.md`
- `2026-04-03 - DIV 01 - Product Requirements - V6.md`
- `2026-04-03 - DIV 03 - Client Applications - V5.md`
- `2026-04-03 - DIV 06 - Data and Persistence - V2.md`
- `2026-04-03 - DIV 07 - Integration and Interfaces - V2.md`
- `2026-04-03 - DIV 08 - Identity and Security - V4.md`
- `2026-04-03 - DIV 09 - Observability and Operations - V3.md`
- `2026-04-03 - DIV 11 - Quality Engineering - V2.md`
- `2026-04-03 - DIV 12 - Delivery Pipeline - V2.md`
- `actionpm_kpi_final_definitions.md`
- `ActionPM - Master Note.md`
