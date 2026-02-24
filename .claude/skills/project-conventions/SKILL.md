---
name: project-conventions
description: Project conventions for the Service Request Intake & Triage Agent. Tech stack, repo layout, naming, and commands.
getting-started: true
---

# Project Conventions

## Stack
TypeScript, Next.js (UI + API routes), PostgreSQL, pnpm workspaces, JSON Schema validation.

## Repo layout
```
AGENTS.md                        # Agent guardrails (read first)
docs/
  spec.md                        # Authoritative build spec
  plans/                         # Implementation plans
  security-boundaries.md
  retention-policy.md
  rfcs/                          # Taxonomy governance
apps/
  web/                           # Next.js app (UI + API routes)
packages/
  schemas/                       # JSON Schemas + taxonomy.json (source of truth)
  core/                          # Orchestrator, state machine, LLM tools, services
  evals/                         # Gold sets + evaluation harness
  adapters/
    mock/                        # Mock ERP adapter
```

## Naming
- Files: `kebab-case.ts` (e.g., `issue-splitter.ts`, `work-order.schema.json`)
- Types/interfaces: `PascalCase` (e.g., `WorkOrder`, `OrchestratorActionRequest`)
- Functions/variables: `camelCase`
- DB tables: `snake_case` (e.g., `work_orders`, `classification_events`)
- DB columns: `snake_case`
- Schema files: `<name>.schema.json` in `packages/schemas/`
- Config/data files: `<name>.json` in `packages/schemas/`
- Tests: colocated as `<name>.test.ts`

## Commands
```bash
pnpm install                     # Install all workspace deps
pnpm --filter @wo-agent/schemas test   # Test schemas package
pnpm --filter @wo-agent/core test      # Test core package
pnpm --filter @wo-agent/web dev        # Dev server
pnpm test                        # All tests across workspaces
pnpm lint                        # Lint all
pnpm typecheck                   # tsc --noEmit across workspaces
```

## Workspace packages
| Package | Name | Purpose |
|---------|------|---------|
| `packages/schemas` | `@wo-agent/schemas` | JSON Schemas, taxonomy, validators |
| `packages/core` | `@wo-agent/core` | Orchestrator, state machine, LLM tools, services |
| `packages/evals` | `@wo-agent/evals` | Gold sets, evaluation harness |
| `packages/adapters/mock` | `@wo-agent/mock-erp` | Mock ERP adapter |
| `apps/web` | `@wo-agent/web` | Next.js frontend + API routes |

## Key rules (see AGENTS.md for full list)
- Read `AGENTS.md` before any implementation work
- Use domain skills: `/schema-first-development`, `/state-machine-implementation`, `/append-only-events`, `/llm-tool-contracts`
- Follow build sequence in `docs/spec.md` §28 — do not skip phases
- TDD: failing test first, then implement
- Spec is authoritative: `docs/spec.md`
