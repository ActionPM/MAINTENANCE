
# ActionPM Frontend Operating Blueprint

## 1. Purpose

This file defines **how the ActionPM front end is built, reviewed, and released**.

Use it to keep the front end:
- aligned to the maintenance kernel
- aligned to the taxonomy and shared contracts
- inside the narrow phase-one workflow boundary
- truthful under stale, partial, degraded, disconnected, or unconfirmed conditions
- disciplined without creating process theater

This file is about the **operating model**.

It does **not** replace:
- `docs/canon/frontend-spec.md` for product-specific frontend rules
- `docs/canon/kernel-alignment-rules.md` for downstream alignment control
- `docs/canon/repo-policy.md` for repository mechanics
- the canonical division notes for deeper source authority

---

## 2. Non-negotiable stance

### Hard rules
- ActionPM is a **governed operational control layer**, not a generic dashboard and not a chatbot.
- The **maintenance kernel** is the center of the system.
- The **kernel is the control layer**. It is not the UI and not the ERP.
- The **model proposes; deterministic code decides**.
- The **taxonomy is authoritative**.
- Every meaningful number shown in the front end must be **drillable to underlying records**.
- The UI must never imply **authority, freshness, completion, or confirmation** it does not actually have.
- Phase one is **internal-only**.
- Phase one is **property-manager-first**.
- Phase-one workflow scope is limited to **contextual draft Purchase Order generation, review, edit, save, PDF export/download, and handoff only**.
- The final official PO remains **outside ActionPM**.
- KPI behavior is **configuration-driven** over structured service-request / inquiry data, not a hard-coded card list.
- Reopened requests are treated as though they were **never closed**.
- Records excluded from reporting must remain **auditable**.
- Release-sensitive changes do not merge without **evidence**.
- Ben is the final planning, merge-exception, and release authority.

### Recommended defaults
- Start lean, but do not collapse real control boundaries.
- Prefer small durable process over broad theoretical process.
- Prefer explicit handoffs over blurred ownership.
- Prefer same-repo alignment with shared contracts over repo separation.

### Future-state option
- Split specialist roles further only when task volume or drift makes the lean set insufficient.

---

## 3. Operating model summary

The default model is **lean-first, division-aligned, artifact-driven**.

That means:
- work starts from canon, not from a blank prompt
- every real task starts with a task packet
- Claude or Codex always work under an assigned **agent hat** for non-trivial work
- generator and critic are intentionally separated
- auditor passes are mandatory for higher-risk work
- merge and release depend on artifacts and evidence, not memory or informal confidence

---

## 4. The agent model

Use these agents as **operating modes**, not as separate software systems and not as separate humans.

### Lean-first starting set
1. Governance and Traceability Orchestrator
2. UX and Workflow Surface Architect
3. Client Shell and Maintainability Architect
4. Operational Semantics and Interface Contract Agent
5. Security, Session, and Permission Agent
6. Operational Truth and Observability Agent
7. Quality Scenario and Evidence Agent
8. Delivery and Release Safety Agent

### Role types
- **Generator:** produces implementation-facing design or code changes
- **Critic:** reviews work against guarded rules and raises blockers
- **Auditor:** checks evidence sufficiency and release discipline
- **Hybrid:** can generate or critique, depending on task

### Hard rule
For any non-trivial change, Claude and Codex do **not** work “as themselves.” They work under an assigned agent hat.

### Exception
For small mechanical edits only, a tool may work directly without a named hat if all of the following are true:
- no workflow change
- no contract change
- no KPI semantic change
- no auth/session change
- no degraded-state truth change
- no canon-impact change

---

## 5. Where agents start

Every agent starts from the same top-level sequence.

### Required reading order
1. `docs/canon/frontend-spec.md`
2. relevant division notes
3. task packet
4. changed files / diff
5. local code context

### Why this order exists
- `frontend-spec.md` gives the front-end-specific contract first
- division notes provide the deeper canon
- the task packet narrows the work to one bounded change
- the diff shows what actually moved
- the code confirms implementation reality

### Hard rule
No agent should start from the full repo and “figure it out.”

The starting context must always be bounded by:
- one task id
- one assigned agent hat
- one canon subset
- one required output

---

## 6. How agents interact with the DIV files

Agents do **not** read every division note on every task.

They read a controlled subset.

### Default canon subset by agent

#### Governance and Traceability
- `DIV 00` Program and Governance
- `DIV 01` Product Requirements
- `DIV 12` Delivery Pipeline
- `frontend-spec.md`

#### UX and Workflow
- `DIV 01` Product Requirements
- `DIV 02` User Experience and Presentation
- `DIV 08` Identity and Security
- `frontend-spec.md`

#### Client Shell and Maintainability
- `DIV 03` Client Applications
- `DIV 07` Integration and Interfaces
- `DIV 12` Delivery Pipeline
- `frontend-spec.md`

#### Operational Semantics and Interface Contract
- `DIV 01` Product Requirements
- `DIV 06` Data and Persistence
- `DIV 07` Integration and Interfaces
- KPI definitions
- `frontend-spec.md`

#### Security, Session, and Permission
- `DIV 08` Identity and Security
- `DIV 03` Client Applications
- relevant workflow packet
- `frontend-spec.md`

#### Operational Truth and Observability
- `DIV 09` Observability and Operations
- `DIV 03` Client Applications
- `DIV 07` Integration and Interfaces
- `frontend-spec.md`

#### Quality Scenario and Evidence
- `DIV 11` Quality Engineering
- task packet
- relevant canon subset
- changed files

#### Delivery and Release Safety
- `DIV 12` Delivery Pipeline
- `DIV 10` Infrastructure and Platform when release-sensitive
- task packet
- critic and auditor artifacts

### Practical rule
The task packet must name the affected divisions. Agents should start there, not by re-reading all division notes.

---

## 7. Task packets

A task packet is the **entry brief for one bounded change**.

It exists so the tools know:
- what problem is being solved
- what is in scope
- what is out of scope
- which canon applies
- which reviewers are mandatory
- which evidence is required

### Where task packets live
```text
/docs/tasks/FE-xxx/
```

### Minimum required files
```text
/docs/tasks/FE-xxx/
  meta.yaml
  feature-packet.md
  review-matrix.md
```

### Typical optional files
```text
  diff-summary.md
  open-questions.md
  kpi-definition-pack.md
  contract-note.md
  security-review.md
  truth-matrix.md
  quality-scenarios.md
  evidence-pack.md
  doc-delta.md
```

### Where task packets come from
Task packets are created by the **Governance and Traceability Orchestrator** before real work starts.

### Task packet inputs
- Ben’s stated goal
- relevant canon files
- affected code area
- workflow boundary
- risk level
- release sensitivity

### Required contents of `meta.yaml`
- task id
- title
- risk level
- change types
- affected divisions
- generator
- critic
- auditor if required
- release-sensitive yes/no
- canonical artifacts that must be consulted

### Hard rule
No medium- or high-risk change starts without a task packet.

---

## 8. Skills

In this operating model, a skill is a **reusable operating bundle** attached to an agent.

A skill contains:
- one prompt wrapper
- one or more checklists
- one or more output templates
- one enforcement rule in PR, CI, or merge policy

### Example
A semantics / contract skill may include:
- `.actionpm/agents/semantics-contract.md`
- `.actionpm/checklists/contract-change.md`
- `.actionpm/templates/contract-note.md`
- `.actionpm/templates/kpi-definition-pack.md`

### Hard rule
A skill is not considered “used” because a prompt mentioned it.

A skill is considered used only when its required artifact exists in the task folder.

---

## 9. Daily working loop

### Step 1 — Create task folder
Create `docs/tasks/FE-xxx/`.

### Step 2 — Draft the task packet
Governance mode writes:
- `meta.yaml`
- `feature-packet.md`
- `review-matrix.md`

### Step 3 — Assign hats
Choose:
- generator
- critic
- auditor if required

### Step 4 — Run the generator
The generator works only from:
- task packet
- assigned canon subset
- changed files

### Step 5 — Run the critic
The critic reviews:
- the diff
- the task packet
- required artifacts
- guarded rules for that domain

### Step 6 — Run the auditor when required
The auditor checks:
- scenario coverage
- evidence sufficiency
- release impact
- unresolved blockers

### Step 7 — Update doc delta
If canon-impact exists, update or propose:
- canonical note change
- ADR
- `no-canon-change.md` rationale

### Step 8 — Merge gate
Do not merge until required artifacts, reviews, and checks are present.

### Step 9 — Release gate
Do not release until evidence, release record, rollback plan, and Ben approval exist.

---

## 10. Branches and worktrees

### Hard rules
- one primary worktree per task
- separate review worktree for medium/high-risk critic or auditor passes
- no long-lived per-agent worktrees
- no direct commits to `main`
- no mixing multiple tasks in one worktree

### Naming convention
- branch: `feat/FE-042-short-name`
- task worktree: `../wt/FE-042`
- critic worktree: `../wt-review/FE-042-security`
- auditor worktree: `../wt-review/FE-042-quality`

### Cleanup rule
- review worktrees are deleted after merge decision
- task worktrees are deleted after merge
- artifacts remain in `docs/tasks/FE-xxx/`

---

## 11. Review and approval model

### Default pairing
- Claude Code: default generator for governance-heavy, semantics-heavy, and UX-heavy tasks
- Codex: default critic for implementation review and constraint checking

### Inverse pairing
Use Codex as generator and Claude as critic for:
- contained refactors
- repetitive mechanical edits
- code organization changes
- test harness work

### Hard rules
- no author self-approving in the same profile
- no release-sensitive merge without cross-profile review
- no release without explicit evidence and Ben approval

---

## 12. When an auditor pass is mandatory

An auditor pass is mandatory for:
- workflow or draft-PO changes
- contract changes
- KPI semantic or drilldown changes
- auth / RBAC / session changes
- degraded-state or observability-truth changes
- export / PDF / handoff changes
- taxonomy-linked behavior changes
- any release-sensitive change

---

## 13. Documentation maintenance

### Required posture
Documentation maintenance exists now, but as a **propose-only lane**.

### It owns
- doc delta review
- canon-impact detection
- targeted updates to canonical notes
- release-note proposals
- drift summaries

### It must never do alone
- change product scope
- rewrite canon broadly from inference
- merge its own updates

### Trigger it when
- guarded behavior changes
- contracts change
- workflow changes
- taxonomy changes
- security-visible behavior changes
- degraded-state behavior changes

---

## 14. Minimum viable setup

Start with:
- the 8-agent lean set
- task packets
- one-task-one-worktree rule
- artifact-based review
- PR template
- CI checks for metadata, critic artifacts, and doc delta
- Ben as final merge and release authority

This is the minimum disciplined system.

---

## 15. Source basis

This file is downstream of:
- `2026-04-03 - Front End Execution Plan - Draft 1.md`
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
- `2026-04-03 - DIV 15 - AI and Automation Systems - V2.md`
- `actionpm_kpi_final_definitions.md`
- `ActionPM - Master Note.md`
