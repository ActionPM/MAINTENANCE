# ActionPM Frontend Repo Policy

## 1. Purpose

This file defines the repository rules for frontend work.

Use it to keep frontend delivery:

- traceable
- reviewable
- aligned to canon
- hard to drift
- lightweight but disciplined

---

## 2. Repo strategy

### Hard rule

The governed front end lives in the **same repo / workspace** as the maintenance kernel and shared packages.

### Why

Shared repo structure makes it easier to keep aligned:

- contracts
- taxonomy
- validators
- workflow rules
- eval fixtures
- release evidence

### Practical shape

The frontend should remain a separate app or package inside the shared workspace, not mixed into kernel code directly.

---

## 3. Required repo-local control folders

Create and maintain these top-level folders:

```text
.actionpm/
  agents/
  templates/
  checklists/
  policies/

docs/
  canon/
  frontend/
  tasks/
  adr/
  releases/
```

### Purpose of each

- `.actionpm/agents/`: agent wrapper files
- `.actionpm/templates/`: required task and review artifacts
- `.actionpm/checklists/`: critic and auditor checklists
- `docs/canon/`: stable repo-facing operating canon
- `docs/frontend/`: working frontend architecture and design notes
- `docs/tasks/`: one folder per task
- `docs/adr/`: architecture decisions
- `docs/releases/`: release records, waivers, and notes

---

## 4. Required canon files

The repo must keep these files current:

- `docs/canon/frontend-operating-blueprint.md`
- `docs/canon/frontend-spec.md`
- `docs/canon/kernel-alignment-rules.md`
- `docs/canon/repo-policy.md`

### Rule

These files are the first stop for frontend work in this repo. They do not replace the division notes; they make them usable for day-to-day execution.

---

## 5. Task ids and task folders

### Hard rules

- every non-trivial frontend task gets a task id
- every non-trivial frontend task gets a folder in `docs/tasks/`
- task folders are immutable identifiers for work history even after merge

### Naming convention

- task id: `FE-001`
- task branch: `feat/FE-001-short-name`
- task folder: `docs/tasks/FE-001/`

### Minimum required files

```text
meta.yaml
feature-packet.md
review-matrix.md
```

### Required `meta.yaml` fields

- task_id
- title
- risk
- change_types
- affected_divisions
- generator
- critic
- auditor when required
- release_sensitive
- canonical_artifacts

---

## 6. Agent wrappers and skills

### Hard rule

Agents are implemented as **repo files**, not informal memory.

### Required location

```text
.actionpm/agents/
```

### Each agent file must define

- purpose
- owned concerns
- forbidden concerns
- required inputs
- required outputs
- required checklist
- merge blockers the agent can raise

### Skills

A skill is the combined bundle of:

- agent wrapper
- checklist
- template
- enforcement rule

### Enforcement rule

A skill is not optional when its artifact is required by the task type or risk level.

---

## 7. Worktree and branch policy

### Hard rules

- one primary worktree per task
- one task per branch
- no multiple active tasks in one worktree
- no long-lived per-agent worktrees
- no direct commits to `main`

### Review isolation rule

For medium- and high-risk work:

- critic review should happen in a separate review worktree
- auditor review should happen in a separate review worktree when practical

### Naming convention

- task worktree: `../wt/FE-042`
- critic worktree: `../wt-review/FE-042-security`
- auditor worktree: `../wt-review/FE-042-quality`

### Cleanup rule

- delete review worktrees after merge decision
- delete task worktree after merge
- keep artifacts in `docs/tasks/FE-xxx/`

---

## 8. PR policy

### Hard rules

All merges to `main` happen through PRs.

### PR template must include

- Task ID
- Title
- Risk
- Change types
- Affected divisions
- Generator
- Critic
- Auditor
- Canon docs changed or `no-canon-change.md` rationale
- Feature packet link
- Review matrix link
- Evidence pack link
- Doc delta link
- Release-sensitive state
- Ben merge approval
- Ben release approval where applicable

### Forbidden PR state

Do not open or merge a PR that has:

- no task packet for non-trivial work
- no named generator / critic for medium- or high-risk work
- missing required evidence for guarded changes

---

## 9. Review policy

### Default model

- generator produces code and artifacts
- critic reviews the diff and artifacts
- auditor checks evidence and release discipline when required

### Hard rules

- no same-profile self-approval
- no “looks good” free-form approval for guarded changes
- every critic or auditor must return one of:
  - pass
  - pass with conditions
  - block

### Default pairing

- Claude: default generator for governance-heavy, semantics-heavy, and UX-heavy work
- Codex: default critic for implementation review

### Inverse pairing

Use Codex as generator and Claude as critic for contained refactors and mechanical code changes.

---

## 10. CI policy

At minimum, CI must fail when:

- guarded change has no `docs/tasks/FE-xxx/meta.yaml`
- high-risk task has no critic artifact
- required auditor artifact is missing
- canon-impact exists without doc delta or rationale
- guarded enums or governed workflow states are shadowed locally
- required fixtures are missing for contract or KPI changes

### Recommended first checks

- task metadata existence
- critic artifact existence
- doc delta existence
- no-shadow-model check

---

## 11. Merge gate

### Hard stop conditions

Block merge when any of the following are true:

- missing feature packet
- missing required critic report
- missing required auditor report
- failed CI
- unresolved blocker from Security, Semantics, Observability, Quality, or Delivery
- missing doc delta for guarded change
- Ben merge decision not recorded where required

### Waiver rule

Waivers must be written and retained under `docs/releases/waivers/`.

### Must never waive

- missing evidence for workflow-sensitive change
- missing evidence for security-sensitive change
- missing evidence for KPI correctness on shipped KPI behavior
- missing degraded-state truth validation for truth-sensitive change

---

## 12. Release gate

### Required release artifacts

- evidence pack
- release record
- rollback plan
- known-risk note if needed
- Ben approval

### Hard rule

No production-capable release without explicit evidence and explicit approval.

---

## 13. Documentation policy

### Hard rules

- guarded changes require a doc delta
- canon-impact changes require either canon update or explicit `no-canon-change.md`
- canon updates must be targeted, not broad speculative rewrites

### Documentation-maintenance lane

The doc-maintenance lane may:

- propose canon updates
- draft canon updates
- open follow-up doc PRs

It may not:

- change canon scope on its own
- merge its own changes

---

## 14. Starting-point rule for tools

For non-trivial frontend work, tools start from:

1. `docs/canon/frontend-spec.md`
2. relevant division notes
3. task packet
4. diff

### Hard rule

Do not start real work from a blank tool session with no assigned agent hat and no task packet.

---

## 15. Minimum repo starter set

Create these first:

- `.actionpm/agents/governance.md`
- `.actionpm/agents/ux-workflow.md`
- `.actionpm/agents/client-shell.md`
- `.actionpm/agents/semantics-contract.md`
- `.actionpm/agents/security.md`
- `.actionpm/agents/observability.md`
- `.actionpm/agents/quality.md`
- `.actionpm/agents/delivery.md`
- `.actionpm/templates/feature-packet.md`
- `.actionpm/templates/review-matrix.md`
- `.actionpm/templates/task-meta.yaml`
- `.actionpm/templates/doc-delta.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

---

## 16. Source basis

This file is downstream of:

- `2026-04-03 - Front End Execution Plan - Draft 1.md`
- `2026-04-03 - DIV 00 - Program and Governance - V6.md`
- `2026-04-03 - DIV 01 - Product Requirements - V6.md`
- `2026-04-03 - DIV 03 - Client Applications - V5.md`
- `2026-04-03 - DIV 07 - Integration and Interfaces - V2.md`
- `2026-04-03 - DIV 08 - Identity and Security - V4.md`
- `2026-04-03 - DIV 09 - Observability and Operations - V3.md`
- `2026-04-03 - DIV 11 - Quality Engineering - V2.md`
- `2026-04-03 - DIV 12 - Delivery Pipeline - V2.md`
- `ActionPM - Master Note.md`
