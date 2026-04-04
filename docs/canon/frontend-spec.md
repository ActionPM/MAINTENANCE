# ActionPM Frontend Spec

## 1. Purpose

This file is the **front-end-specific contract** for ActionPM.

It is the **first file every front-end agent reads** before consulting deeper division notes.

Use it to answer:

- what the frontend is
- what the frontend is not
- what it must always stay aligned to
- what phase one is allowed to expose
- what the frontend may decide locally
- what changes are automatically treated as release-sensitive

This file is intentionally shorter than the division notes.

---

## 2. Product identity

### Hard rules

- ActionPM is a **governed operational control layer** for residential property management.
- The frontend is **not** a generic dashboard.
- The frontend is **not** a chatbot.
- The frontend is **not** the ERP.
- The frontend is **not** the system of record for official procurement artifacts.
- The frontend sits **downstream of the maintenance kernel**.
- The frontend exists to expose governed state, governed workflow boundaries, and governed drilldown.

### Practical interpretation

The frontend should feel like an **operational command surface**:

- map-centered
- high-density where appropriate
- live or frequently refreshed
- explicit about uncertainty
- explicit about scope
- explicit about draft vs official state

---

## 2A. Kernel-first rule

The frontend is **kernel-first**.

The frontend is downstream of the maintenance kernel. The kernel is the control layer. The UI is not authoritative.

---

## 3. Phase-one scope

### Hard rules

Phase one is:

- internal-only
- property-manager-first
- browser-based
- maintenance-centered

### Phase-one committed workflow scope

The frontend may support only:

- contextual draft PO generation
- draft review
- draft edit
- draft save
- PDF export/download
- handoff recording or handoff-pending state

## 3A. Phase-one workflow boundary

The **phase-one workflow boundary** is fixed for the current operating model.

Phase one supports contextual **draft Purchase Order** generation, review, edit, save, PDF export/download, and handoff only.

## 3B. Draft Purchase Order rule

All Purchase Order artifacts produced in phase one are **draft Purchase Orders**. Final official Purchase Orders remain outside ActionPM.

### Forbidden phase-one implications

The frontend must not imply that phase one includes:

- official PO issuance
- approval workflow inside ActionPM
- quote approval
- invoice attachment completion
- dispatch completion
- maintenance completion verification
- procurement system ownership
- tenant-facing self-service

---

## 4. Authority model

### Hard rules

- The kernel decides what actions are allowed.
- The UI does not invent workflow authority.
- The UI does not infer official completion from local interaction alone.
- The UI does not infer freshness from the passage of time alone.
- The UI does not infer security authority from visible controls alone.

### Required frontend behavior

The frontend must always distinguish:

- proposed vs confirmed
- draft vs official
- current vs stale
- complete vs partial
- connected vs disconnected
- visible vs authorized

---

## 5. Authoritative upstream sources

The frontend is downstream of these sources of truth:

1. maintenance kernel workflow and state rules
2. shared schemas and validators
3. governed taxonomy and terminology
4. normalized internal contracts
5. KPI definitions and drilldown rules
6. security and session policy
7. eval and regression expectations
8. canonical division notes

### Hard rule

If an upstream authoritative source changes, the frontend must adapt downstream. The frontend may not preserve an older local interpretation as a shadow truth.

## 5A. Taxonomy authority rule

The **taxonomy authority** sits upstream of the frontend.

The taxonomy is authoritative. The frontend must not create a shadow taxonomy.

---

## 6. KPI and drilldown rules

### Hard rules

- KPI behavior is configuration-driven over structured service-request / inquiry data.
- KPI cards are not a fixed hard-coded product list.
- Every meaningful number must be drillable to underlying records.
- Reopened requests are treated as though they were never closed.
- Excluded-from-reporting records remain auditable.
- The frontend must not hide materially aged underlying records behind aggregate color logic.

### Required frontend behavior

- show scope-aware KPI values
- show time-window-aware KPI values
- support drilldown to record lists
- preserve enough context to explain the metric
- degrade truthfully when freshness or completeness is insufficient

### Canonical user-facing label

Use `service request` as the default canonical label unless canon explicitly changes it.

## 6A. KPI truth rules

The **KPI truth rules** are non-negotiable:

- KPIs are configuration-driven over structured service-request / inquiry data.
- Every meaningful number must be drillable to underlying records.
- Reopened requests are treated as though they were never closed.
- Excluded-from-reporting records must remain auditable.

---

## 7. Taxonomy and terminology rules

### Hard rules

- The taxonomy is authoritative.
- The frontend may not create local substitute category systems for governed fields.
- The frontend may not replace client `propertyCode` with a local alias in governed workflow artifacts.
- Protected user-facing terms must remain stable unless canon changes them intentionally.

### Protected terms

At minimum, treat these as protected:

- service request
- draft
- exported
- handoff pending
- handoff recorded
- stale
- partial
- disconnected

---

## 8. Contract and live-update rules

### Hard rules

- The frontend consumes **normalized internal ActionPM contracts**, not raw source-system payloads.
- Contract responses must carry enough freshness and source-health context for truthful display.
- SSE is the preferred current phase-one browser default for one-way live delivery unless a later approved architecture note changes that choice for a concrete reason.
- The frontend must expose reconnect or refetch behavior where needed.

### Required frontend behavior

- no raw ERP payload rendering logic in UI components
- no silent fallback from failed live updates to “looks current” UI
- no hidden retry loops that create false freshness assumptions

---

## 9. Security-visible behavior rules

### Hard rules

- Phase-one access is internal-only.
- SSO-backed authentication with MFA is the default direction.
- Session authority is server-authoritative.
- Idle timeout baseline: 20 minutes.
- Absolute timeout baseline: 8 hours.
- Step-up reauthentication is required for export/download, handoff, and access changes.

### Required frontend behavior

- expired session must block privileged actions
- permission changes must clear unsafe local context where needed
- hidden controls alone are not sufficient; the UI must still handle denied responses correctly
- privileged actions must show clear draft-state and reauth behavior

---

## 10. Degraded-state truth rules

### Hard rules

The frontend must never hide:

- stale data
- partial data
- disconnected live state
- failed source refresh
- unconfirmed export or handoff state

### Required frontend behavior

- degraded state remains visible and understandable
- warnings must be specific enough to be operationally useful
- a failed or unconfirmed action must not be presented as complete
- source-health and freshness are first-class visible information, not buried diagnostics

## 10A. Truthful degraded-state rule

The UI must visibly and truthfully represent stale, partial, degraded, disconnected, or unconfirmed conditions.

This is the **truthful degraded-state** rule for the ActionPM frontend.

---

## 11. Frontend-local freedom

The following may remain frontend-local as long as meaning does not change:

- layout composition
- responsive adaptation
- spacing and visual hierarchy
- local route naming
- transient client state
- non-authoritative copy refinement
- component decomposition
- visual design implementation using approved frontend foundations

### Current implementation baseline

Current frontend implementation direction is:

- browser-based
- React-based
- Next.js
- shadcn/ui as the initial UI foundation

This implementation baseline is not itself the product contract. The product contract is the governed behavior described in this file and the canon it points to.

---

## 12. Forbidden frontend moves

The frontend must not:

- duplicate the taxonomy in shadow enums for governed fields
- hard-code KPI semantics that belong in shared configuration or canon
- infer workflow rights from client-only state
- imply official PO creation inside ActionPM
- label degraded data as current truth
- hide missing source context when it materially affects interpretation
- bypass kernel or contract rules through convenience logic
- treat AI output as authoritative operational state

---

## 13. Release-sensitive change classes

The following **release-sensitive change classes** are release-sensitive by default:

- workflow or draft-PO behavior
- export/download behavior
- contract changes
- KPI semantic changes
- drilldown behavior changes
- taxonomy-linked UI changes
- auth / RBAC / session changes
- degraded-state truth changes
- source-health visibility changes
- security-visible behavior changes
- AI-visible advisory behavior changes

---

## 14. Required starting files for agents

Every front-end task should start from:

1. this file
2. relevant division notes
3. task packet

### Default related canon

- `docs/canon/kernel-alignment-rules.md`
- `docs/canon/repo-policy.md`
- `2026-04-03 - DIV 00 - Program and Governance - V6.md`
- `2026-04-03 - DIV 01 - Product Requirements - V6.md`
- `2026-04-03 - DIV 02 - User Experience and Presentation - V7.md`
- `2026-04-03 - DIV 03 - Client Applications - V5.md`
- `2026-04-03 - DIV 06 - Data and Persistence - V2.md`
- `2026-04-03 - DIV 07 - Integration and Interfaces - V2.md`
- `2026-04-03 - DIV 08 - Identity and Security - V4.md`
- `2026-04-03 - DIV 09 - Observability and Operations - V3.md`
- `2026-04-03 - DIV 11 - Quality Engineering - V2.md`
- `2026-04-03 - DIV 12 - Delivery Pipeline - V2.md`
- `actionpm_kpi_final_definitions.md`

---

## 15. Maintenance rule

When this file changes, confirm whether one or more of the following also need updates:

- `kernel-alignment-rules.md`
- `repo-policy.md`
- task templates
- agent wrappers
- relevant division notes
