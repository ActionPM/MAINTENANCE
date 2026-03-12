# CLAUDE.md — Work Order Triage Agent

## What This Is

A tenant-facing in-app chatbot that converts maintenance/management messages into schema-enforced Work Orders, labeled with an authoritative taxonomy. The product value is **categorization integrity** — reliable trend analysis, bundling, repeat-issue detection. The model proposes; deterministic code enforces transitions, validations, and side effects.

## Tech Stack

- **Language**: TypeScript 5.7, strict mode, ESM (`"type": "module"` everywhere)
- **Runtime**: Node.js ≥20
- **Package manager**: pnpm ≥9 (workspaces)
- **Module resolution**: `Bundler` (not `NodeNext`) — required for CJS/ESM interop with ajv/ajv-formats
- **Frontend**: Next.js 15, React 19
- **Database**: PostgreSQL via `@neondatabase/serverless` (Neon pooled)
- **Auth**: Jose 6 (JWT access + refresh tokens)
- **LLM**: `@anthropic-ai/sdk` 0.78 (Claude)
- **Validation**: Ajv 8 + ajv-formats
- **Testing**: Vitest 3, @testing-library/react (jsdom for web)
- **Linting**: ESLint 9 flat config + typescript-eslint, Prettier 3.8
- **Scripts runner**: tsx (for eval CLI and DB migrations)

## Architecture

```
packages/
  schemas/       @wo-agent/schemas   — Types, JSON Schemas, validators, taxonomy
  core/          @wo-agent/core      — All runtime: orchestrator, state machine, LLM layer,
                                       splitter, classifier, followup, confirmation, risk,
                                       notifications, work-order, record-bundle, analytics
  db/            @wo-agent/db        — Postgres stores (event, session, WO, notification, idempotency)
  evals/         @wo-agent/evals     — Offline eval framework (replay, metrics, baselines)
  adapters/mock/ @wo-agent/mock-erp  — Mock ERP adapter
apps/
  web/           @wo-agent/web       — Next.js frontend + 20+ API routes
```

**Workspace globs** (pnpm-workspace.yaml): `packages/*`, `packages/adapters/*`, `apps/*`

### Data Flow

1. Tenant sends message → API route → orchestrator `dispatch()`
2. Dispatcher validates state transition → delegates to action handler
3. Handler calls LLM tools (splitter → classifier → followup generator) with schema validation
4. State machine enforces transition matrix; auto-fires chained events (e.g., `split_finalized` → `START_CLASSIFICATION`)
5. On `CONFIRM_SUBMISSION`: creates Work Orders, sends notifications, triggers risk scan + emergency routing
6. All mutations stored as append-only events (INSERT + SELECT only)

### Key Modules

- **Orchestrator** (`core/src/orchestrator/dispatcher.ts`): Single entry point. Routes actions to handlers, enforces state transitions, auto-fires chained system events.
- **State machine** (`core/src/state-machine/`): Transition matrix, system events, guards for multi-target resolution. 14 states, ~15 triggers.
- **LLM layer** (`core/src/llm/`): Adapter pattern — each tool (splitter, classifier, followup) has an adapter (builds prompt, calls client, extracts JSON) + a prompt module + schema validation in the caller.
- **Schemas** (`schemas/src/`): Types, validators, taxonomy loader, conversation states, action types, rate limits, confidence config.

## Commands

```bash
pnpm test                              # Run all tests (vitest, all packages)
pnpm typecheck                         # TypeScript check (all packages)
pnpm lint                              # ESLint
pnpm lint:fix                          # ESLint --fix
pnpm format                            # Prettier --write
pnpm format:check                      # Prettier --check

# Per-package
pnpm --filter @wo-agent/core test      # Test just core
pnpm --filter @wo-agent/web build      # Build Next.js app
pnpm --filter @wo-agent/web dev        # Dev server

# DB
pnpm --filter @wo-agent/db migrate     # Run Postgres migrations (needs DATABASE_URL)

# Evals
pnpm --filter @wo-agent/evals eval:run             # Run eval suite
pnpm --filter @wo-agent/evals eval:update-baseline  # Update baseline
```

No DATABASE_URL or ANTHROPIC_API_KEY needed for `pnpm test` — in-memory stores and stubs are used.

## Environment Variables

See `.env.example`:

- `DATABASE_URL` — Neon Postgres pooled connection string (optional for local dev; falls back to in-memory)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — 32+ char secrets
- `ANTHROPIC_API_KEY` — for LLM tools (optional; stubs used if absent)
- `LLM_DEFAULT_MODEL` — optional override (default: `claude-sonnet-4-20250514`)

## Code Conventions

### Enums

```typescript
export const Foo = { BAR: 'bar', BAZ: 'baz' } as const;
export type Foo = (typeof Foo)[keyof typeof Foo];
```

Never use TypeScript `enum`. Always `as const` objects.

### Validators

Ajv with `$ref` to `#/definitions/TypeName`. Return `ValidationResult<T> = { valid: true; data: T } | { valid: false; errors: unknown[] }`.

### Config

`interface FooConfig { ... }` + `export const DEFAULT_FOO_CONFIG: FooConfig = { ... }`.

### Imports

- ESM imports with `.js` extensions in source (e.g., `import { x } from './foo.js'`)
- `workspace:*` protocol for internal deps
- Barrel exports via `src/index.ts` per package

### File Organization

- One concept per file, colocated tests (`foo.test.ts` next to `foo.ts`)
- `types.ts` for interfaces/types, `index.ts` for barrel exports
- Action handlers in `orchestrator/action-handlers/` (one file per action type)

### Error Handling

- Deterministic retries: 1 retry on schema validation failure, then fail-safe (`needs_human_triage`)
- No raw LLM output trusted — always schema-validated
- Custom error objects with `code` and `message` fields

### Formatting

- Prettier: single quotes, trailing commas, 100 char width, 2-space indent, semicolons

## Non-Negotiables (spec §2)

These are hard rules. Violating any of them is a bug:

1. **Taxonomy is authoritative** — every category value must exist in `taxonomy.json`. No free-text.
2. **Split first** — classifier cannot run until split is finalized. Reject `START_CLASSIFICATION` unless state === `split_finalized`.
3. **Schema-lock all LLM outputs** — validate against JSON Schema. Invalid → 1 retry → fail safe.
4. **No side effects without confirmation** — WO creation, notifications, escalation only after explicit `CONFIRM_SUBMISSION`.
5. **Unit/property derived from membership** — server derives authorized units from `tenant_user_id`. Client cannot set `unit_id` directly.
6. **Append-only events** — INSERT + SELECT only on event tables. Corrections append new events. No UPDATE, no DELETE.
7. **Emergency escalation is deterministic** — model suggests risk; deterministic code confirms and routes. LLM never executes escalation.

## Authority Order (when ambiguous)

1. Transition matrix (spec §11.2)
2. Orchestrator contract (spec §10)
3. Rate limits / payload caps (spec §8)
4. Non-negotiables (spec §2)
5. Remaining spec sections in document order

## Key Domain Concepts

- **Conversation states** (14): `intake_started` → `unit_selection_required` → `unit_selected` → `split_in_progress` → `split_proposed` → `split_finalized` → `classification_in_progress` → `needs_tenant_input` → `tenant_confirmation_pending` → `submitted` (terminal), plus `intake_abandoned`, `intake_expired`, `llm_error_retryable`, `llm_error_terminal`
- **Action types** (15): `CREATE_CONVERSATION`, `SELECT_UNIT`, `SUBMIT_INITIAL_MESSAGE`, `SUBMIT_ADDITIONAL_MESSAGE`, `CONFIRM_SPLIT`, `MERGE_ISSUES`, `EDIT_ISSUE`, `ADD_ISSUE`, `REJECT_SPLIT`, `ANSWER_FOLLOWUPS`, `CONFIRM_SUBMISSION`, `UPLOAD_PHOTO_INIT`, `UPLOAD_PHOTO_COMPLETE`, `RESUME`, `ABANDON`
- **Taxonomy**: 9 fields — Category, Location, Sub_Location, Maintenance_Category/Object/Problem, Management_Category/Object, Priority. Loaded from `packages/schemas/taxonomy.json`.
- **Category gating**: Maintenance vs. management categories have mutually exclusive fields. Classifier checks for contradictions; constrained retry; fallback to `needs_human_triage`.
- **Version pinning**: Each conversation pins taxonomy_version, schema_version, model_id, prompt_version at creation. Resumed conversations retain pinned versions.
- **Idempotency keys**: Prevent duplicate WO creation on retried requests.

## Key Data Files

- `packages/schemas/taxonomy.json` — authoritative taxonomy (9 fields, all valid values)
- `packages/schemas/taxonomy-constraints.json` — field interdependencies
- `packages/schemas/classification_cues.json` — keyword/regex cues for confidence scoring
- `packages/schemas/sla_policies.json` — SLA rules per category
- `packages/schemas/risk_protocols.json` — risk triggers + mitigation templates
- `packages/schemas/escalation_plans.json` — per-building contact chains

## Testing

- **Framework**: Vitest (globals: false in core, true in schemas)
- **308 test files**, 332 total .ts files
- **In-memory stores** for all tests: `InMemoryEventStore`, `InMemorySessionStore`, `InMemoryWorkOrderStore`, `InMemoryIdempotencyStore`
- **Mock implementations**: `MockSmsSender`, `FixtureClassifierAdapter`, `MockERPAdapter`
- **Pattern**: Dependency injection — pass all deps to functions, swap mocks in tests
- **Web tests**: jsdom environment, @testing-library/react for component tests
- **No external services needed**: Tests run without DATABASE_URL or ANTHROPIC_API_KEY

Run a single test file:

```bash
pnpm --filter @wo-agent/core exec vitest run src/classifier/classifier.test.ts
```

## Gotchas and Constraints

- **Module resolution is `Bundler`**, not `NodeNext`. This is intentional — switching to `NodeNext` breaks ajv/ajv-formats imports. Don't change `tsconfig.base.json` module settings.
- **`.js` extensions in imports** are required even though source is `.ts` — this is how `Bundler` resolution works with ESM.
- **Auto-fire chaining**: The dispatcher auto-fires system events after certain state transitions (e.g., `split_finalized` triggers `START_CLASSIFICATION`). If you add new states, check `AUTO_FIRE_MAP` in `dispatcher.ts`.
- **System events cannot come from clients** — the dispatcher rejects any action_type that's in the system event set. Only the dispatcher itself fires them internally.
- **In-memory fallback**: If `DATABASE_URL` is not set, `orchestrator-factory.ts` uses in-memory stores. This is by design for local dev, but means data doesn't persist across restarts.
- **Lazy DB imports**: Postgres dependencies (`@neondatabase/serverless`) are only imported if `DATABASE_URL` is set — keeps the dev experience dependency-light.
- **LLM response parsing** (`parse-response.ts`): Handles pure JSON, markdown code blocks, and JSON embedded in prose. If you change LLM prompts, the parser should still work, but test edge cases.
- **Taxonomy is loaded at import time** via `loadTaxonomy()` — it reads `taxonomy.json` synchronously. Changes to taxonomy.json require restart.
- **CI** runs lint, typecheck, test, and build-web on every PR. All must pass.

## Spec and Governance

- **Authoritative spec**: `docs/spec.md` (~640 lines, version 2026-02-23)
- **Implementation guardrails**: `AGENTS.md` (does not override spec)
- **Spec gap tracker**: `docs/spec-gap-tracker.md` — canonical tracker for repo compliance against the spec
- **Eval governance**: `docs/evals-governance.md`, `docs/evals-labeling-guide.md`
- **Phase plans**: `docs/plans/` (historical, all 13 phases complete)

**Keep the spec gap tracker current**: When any code change affects spec coverage — adding a feature, fixing a gap, wiring a stub, or changing behavior — update `docs/spec-gap-tracker.md` in the same PR. This includes changing row statuses, adding evidence, updating `Last Verified` dates, and adding new rows for newly discovered gaps.

**Full-tracker audit on cross-cutting changes**: When a code change adds a capability that multiple tracker rows reference (e.g., adding structured logging, inbound webhooks, alerting, or persistence), do NOT limit updates to the rows you are directly working on. Scan the entire tracker for any row whose status or evidence is invalidated by the change. Specific patterns to watch for:

- Adding structured logging → check S25-01 (observability) and any row claiming "no logging"
- Adding webhook routes → check S01-02 (SMS handling) and any row claiming "no inbound handler"
- Adding alert/notification paths → check S25-04 (alerting) and any row claiming "no alerting"
- Adding persistence/stores → check rows claiming "in-memory only" or "no durable store"
- Changing status of any row → recount the dashboard totals (DONE / PARTIAL / MISSING)

## Claude Skills (`.claude/skills/`)

This project has custom Claude skills that auto-trigger on relevant work:

- `append-only-events` — enforces INSERT+SELECT only on event tables
- `llm-tool-contracts` — enforces schema-lock, retry, confidence rules for LLM tools
- `project-conventions` — tech stack, repo layout, naming
- `schema-first-development` — JSON Schema validation on all model outputs
- `state-machine-implementation` — embeds transition matrix, enforces correctness
