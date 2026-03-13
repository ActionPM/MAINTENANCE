# Security Boundaries

## Trust Zones

### Zone 1: Tenant Client (Untrusted)

- Next.js frontend (`apps/web/`)
- All input treated as untrusted: message text, photo metadata, unit selections
- No direct access to database, LLM, or internal services
- Rate-limited at API gateway (`middleware/rate-limiter.ts`)

### Zone 2: API Gateway (Semi-Trusted)

- Next.js API routes (`apps/web/src/app/api/`)
- JWT authentication required on all conversation and work-order routes (`middleware/auth.ts`)
- Request validation: message length, payload shape, action type
- Derives `tenant_user_id` and `authorized_unit_ids` from JWT — never from client input
- Rate-limit violations logged as structured security events

### Zone 3: Orchestrator (Trusted Internal)

- `packages/core/src/orchestrator/dispatcher.ts` — sole controller
- Validates state transitions against the transition matrix
- Rejects cross-tenant session access
- Enforces system event boundary (clients cannot fire system events)
- All side effects (WO creation, notifications, escalation) gated by explicit tenant confirmation

### Zone 4: LLM (Untrusted Output)

- `@anthropic-ai/sdk` calls via adapter pattern (`packages/core/src/llm/`)
- All LLM outputs schema-validated via Ajv before acceptance
- Invalid output → 1 deterministic retry → `needs_human_triage` fail-safe
- LLM never executes side effects directly
- Model hint confidence clamped to [0.2, 0.95]

### Zone 5: Database (Trusted Storage)

- PostgreSQL via `@neondatabase/serverless` (Neon pooled)
- Event tables: INSERT + SELECT only (append-only contract)
- Mutable tables (work orders, sessions): optimistic locking via `row_version`
- Idempotency keys prevent duplicate side effects
- Connection string via `DATABASE_URL` environment variable

## Authentication Model

- **JWT access tokens**: Short-lived, signed with `JWT_ACCESS_SECRET`
- **JWT refresh tokens**: Longer-lived, signed with `JWT_REFRESH_SECRET`
- **Auth middleware** fails closed when JWT secrets are missing (returns 401)
- **Unit/property authorization**: Server resolves authorized units from `tenant_user_id`; client cannot set `unit_id` directly

## Data Isolation

- Conversations are scoped to `tenant_user_id` — dispatcher rejects cross-tenant access
- Work orders are scoped to `unit_id` derived from tenant membership
- Read routes enforce ownership checks before returning data
- No shared state between tenant sessions beyond read-only taxonomy/config

## LLM Safety Controls

- Three bounded tools only: IssueSplitter, IssueClassifier, FollowUpGenerator
- Structured output via JSON Schema validation — no free-text passthrough to downstream systems
- Taxonomy values must exist in `taxonomy.json` — LLM cannot invent categories
- Emergency escalation: LLM flags risk keywords, deterministic code confirms and routes
- Version pinning: each conversation locks `model_id` and `prompt_version` at creation

## Rate Limits (Server-Enforced)

| Limit                              | Default |
| ---------------------------------- | ------- |
| Messages per minute per user       | 10      |
| New conversations per day per user | 20      |
| Photo uploads per conversation     | 10      |
| Photo size                         | 10 MB   |
| Message characters                 | 8,000   |
| Issues per conversation            | 10      |

Violations are logged as structured security events and return user-safe error messages.
