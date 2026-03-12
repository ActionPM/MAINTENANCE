# MVP Identity and Access Plan

**Date:** 2026-03-11

**Goal:** Close the ownership and read-API gaps without waiting for final registration design.

**Why this plan exists:** The repo already has an internal identity model (`tenant_user_id`, `tenant_account_id`, `authorized_unit_ids`) and JWT scaffolding. The immediate problem is not "we lack a perfect registration flow." The immediate problem is that read paths and ownership checks are incomplete. This plan uses the existing internal identity model now, then leaves room for email, SMS OTP, or WhatsApp-based sign-in later.

## Core Decision

The canonical tenant identity for the system is an internal `tenant_user_id`.

- Phone number is not the canonical identity.
- Email address is not the canonical identity.
- WhatsApp number or provider ID is not the canonical identity.
- Those are future login identifiers that map to the same internal `tenant_user_id`.

This keeps ownership stable even if the user changes phone number, uses multiple channels, or later gets a different sign-in method.

## Current Repo Baseline

Already present:

- JWT payload and `AuthContext` already use `tenant_user_id`, `tenant_account_id`, and `authorized_unit_ids`.
- Sessions persist `tenant_user_id`.
- Work orders persist `tenant_user_id`.
- Unit selection already derives allowed units from server-side auth context.
- `GET /work-orders/:id/record-bundle` already demonstrates a route-level ownership check.

Current gaps:

- The dispatcher loads sessions by `conversation_id` without proving the conversation belongs to the authenticated tenant.
- `GET /conversations/:id` is stubbed.
- Draft discovery is stubbed and mounted on the wrong path.
- `GET /work-orders` and `GET /work-orders/:id` are missing.
- There is no lightweight developer-facing sign-in path for switching between demo tenants while the real registration flow is still undecided.

## Target MVP State

For MVP, the end-to-end flow should be:

1. A tester selects a demo tenant identity.
2. The app receives a short-lived access token and refresh token using the existing JWT utilities.
3. Every request resolves to `AuthContext`.
4. Every write path uses the authenticated context.
5. Every read path verifies record ownership before returning data.
6. All tenant-facing list/detail views are scoped to the authenticated tenant.

This solves the real security and UX problem now, while keeping the sign-in mechanism replaceable later.

## MVP Identity Model

### Internal subject

Keep the current internal shape as the canonical auth subject:

- `tenant_user_id`
- `tenant_account_id`
- `authorized_unit_ids`

Recommended optional demo metadata:

- `display_name`
- `email`
- `phone_e164`
- `default_unit_id`
- `label` or `persona_key` for demo switching

### Source of truth for MVP

Use a small seeded demo-tenant catalog for now.

Recommended artifact:

- `apps/web/src/lib/dev-auth/demo-tenants.ts`

Each demo tenant entry should define:

- a stable `tenant_user_id`
- a stable `tenant_account_id`
- the unit IDs that user is authorized to access
- optional phone/email metadata for future identity-provider mapping

This is enough to validate ownership, drafts, unit selection, and work-order views without committing to a production registration model.

## Authentication Strategy for MVP

### Phase 1: Dev/demo sign-in only

Add a dev-only token issuance path behind an explicit env flag such as `ENABLE_DEV_AUTH=true`.

Recommended options:

- Preferred: `POST /api/dev/auth/demo-login`
- Acceptable alternative: a local script that prints JWTs for demo tenants

The route or script should:

- accept a demo tenant key
- look up the seeded demo tenant
- mint access and refresh tokens with the existing JWT helpers
- return tokens or set them as cookies for the local app

Rate limiting:

- If using the route option (`POST /api/dev/auth/demo-login`), it must have lightweight rate limiting applied — the same middleware pattern used by other API routes.
- If using the local script option, the endpoint does not exist and this concern disappears entirely.

Constraints:

- disabled in production
- no user self-registration
- no password storage
- no SMS sending yet
- no claim that this is the final sign-in solution

### Phase 2: Real sign-in later

When the real sign-in path is chosen, it should resolve to the same internal `tenant_user_id`.

Examples:

- Email/password -> lookup tenant user -> issue same JWT shape
- SMS OTP -> verify phone number -> lookup tenant user -> issue same JWT shape
- WhatsApp number recognition -> map provider identity to tenant user -> issue same JWT shape

The ownership and authorization code should not need to change when that happens.

## Authorization Rules

These rules should be treated as non-negotiable for MVP:

1. Never trust client-supplied `unit_id` or `property_id` as ownership truth.
2. Every conversation read must verify `session.tenant_user_id === auth_context.tenant_user_id`.
3. Every work-order read must verify `work_order.tenant_user_id === auth_context.tenant_user_id`.
4. List endpoints must filter to the authenticated tenant's scope, not return global results and filter in the UI.
5. Authorized units come from `auth_context.authorized_unit_ids`, not from request payloads.

## Implementation Plan

### Track A: Demo identity bootstrap

Objective: create a usable test identity path without designing full registration.

Planned work:

1. Add a seeded demo-tenant catalog.
2. Add a dev-only token issuance route or script.
3. Add a small app-side helper for storing demo tokens in local dev.
4. Document how to switch personas locally.

Recommended files:

- `apps/web/src/lib/dev-auth/demo-tenants.ts`
- `apps/web/src/app/api/dev/auth/demo-login/route.ts`
- `docs/security-boundaries.md` should later note that dev auth is non-production only

### Track B: Ownership enforcement

Objective: make the backend reject cross-tenant access even if a record ID is guessed.

Planned work:

1. Add a dispatcher ownership guard after session load and before any action handling.
2. Return an authorization-safe error on mismatch.
3. Add tests proving a second tenant cannot act on another tenant's conversation (ship with this step — see Rollout Order).

Hard rule — `assertSessionOwnership` placement:

- Add `assertSessionOwnership(session, auth_context)` in the dispatcher, **after** session load and **before** handler dispatch. This is a dispatcher-level enforcement point, not a convention for individual action handlers to remember.
- In `dispatcher.ts`, the guard must run immediately after `deps.sessionStore.get()` returns a session (currently line ~113), before any transition validation or handler call.
- Auto-fired chained events (via `AUTO_FIRE_MAP`) inherit the `request.auth_context` from the original dispatch call, so the initial ownership check covers them. However, the guard must be positioned such that no code path — including photo actions — can reach a handler without passing through it.

Behavior on mismatch:

- Prefer not to reveal whether another tenant's record exists.
- Use a generic `NOT_FOUND` or equivalent safe response on ownership mismatch unless the API already has a deliberate `FORBIDDEN` convention that you want to keep consistent.

### Track C: Required read APIs

Objective: make the minimum tenant-facing read surface actually usable.

Planned work:

1. Implement `GET /conversations/:id`
2. Move and implement `GET /conversations/drafts`
3. Implement `GET /work-orders`
4. Implement `GET /work-orders/:id`

Prerequisites:

- `WorkOrderListFilters` (in `packages/core/src/work-order/types.ts`) must be extended to support `tenant_user_id` filtering before `GET /work-orders` can be implemented. This is a prerequisite for Track C, not a later refinement. The repository's `listAll()` method must accept `tenant_user_id` so the query filters at the data layer, not in route code.

Route behavior:

- `GET /conversations/:id`
  - auth required
  - load session
  - verify ownership (`session.tenant_user_id === auth_context.tenant_user_id`)
  - return the existing `ConversationSnapshot` contract (defined in `packages/schemas/src/types/orchestrator-action.ts`), built using the existing projection logic in `packages/core/src/orchestrator/response-builder.ts`. This is computed state — not full event history.
  - The response shape includes: `conversation_id`, `state`, `unit_id`, `issues` (post-split), `classification_results`, `pending_followup_questions`, `confirmation_payload`, `work_order_ids`, `risk_summary`, `pinned_versions`, `created_at`, `last_activity_at`.

- `GET /conversations/drafts`
  - auth required
  - load sessions by `tenant_user_id`
  - apply `filterResumableDrafts`
  - mount on the spec path `/api/conversations/drafts`

- `GET /work-orders`
  - auth required
  - return only work orders owned by the authenticated tenant
  - additionally respect authorized unit scope if that remains part of the tenant model

- `GET /work-orders/:id`
  - auth required
  - load by ID
  - verify ownership before returning details

Repository note:

- `WorkOrderListFilters` currently supports `unit_ids` but not `tenant_user_id`. Adding `tenant_user_id` to the filter interface and implementing it in both the in-memory store and Postgres repository is a prerequisite for `GET /work-orders` (see Prerequisites above).

## Rollout Order

1. Add demo tenant seed source.
2. Add dev-only token issuance flow.
3. Add dispatcher ownership guard **+ cross-tenant dispatcher tests** (ownership guard tests ship with the guard, not deferred).
4. Implement `GET /conversations/:id` + route-level ownership tests for this route.
5. Move and implement `GET /conversations/drafts` + route-level ownership tests for this route.
6. Extend `WorkOrderListFilters` with `tenant_user_id` support (prerequisite for steps 7–8).
7. Implement `GET /work-orders` + route-level ownership tests for this route.
8. Implement `GET /work-orders/:id` + route-level ownership tests for this route.
9. Add cross-cutting integration/regression tests (refresh-token continuity, chained-event ownership inheritance, unit-scope edge cases).

Tests ship with their corresponding feature step. Step 9 covers cross-cutting scenarios that span multiple features.

This order gives us a stable way to test the auth surface before the read APIs are finished.

## Testing Plan

### Dispatcher ownership (ship with rollout step 3)

- Dispatcher rejects action on a conversation owned by another `tenant_user_id`
- Dispatcher returns `NOT_FOUND` (not `FORBIDDEN`) on ownership mismatch to avoid leaking record existence
- Ownership guard covers photo actions — a photo upload from the wrong tenant is rejected before the handler runs
- Chained system events (`AUTO_FIRE_MAP`, e.g., `split_finalized` → `START_CLASSIFICATION`) inherit the original `auth_context` and do not bypass the ownership guard

### Route-level ownership (ship with each route's rollout step)

- `GET /conversations/:id` returns auth failure when token is missing
- `GET /conversations/:id` does not return another tenant's session
- `GET /conversations/:id` returns `ConversationSnapshot` shape (not raw event history)
- `GET /conversations/drafts` returns only resumable drafts for the authenticated tenant
- `GET /work-orders` returns only work orders where `tenant_user_id` matches the authenticated tenant
- `GET /work-orders` respects `authorized_unit_ids` scope — a tenant who owns a work order but has lost unit access (membership change) does not see it in results
- `GET /work-orders/:id` rejects or hides another tenant's work order

### Dev auth (ship with rollout step 2)

- Dev auth route is disabled when `ENABLE_DEV_AUTH` is false
- Dev auth route is disabled when `ENABLE_DEV_AUTH` env var is absent entirely (not just `false`)
- Dev auth route rejects an invalid or unknown persona key
- Dev auth route returns tokens with correct `tenant_user_id`, `tenant_account_id`, `authorized_unit_ids` claims

### Token refresh (ship with rollout step 9)

- Expired access token + valid refresh token → new access token with the same `tenant_user_id`
- Expired refresh token → rejection (no silent re-auth)

## Non-Goals for This Plan

This plan does not attempt to define:

- final production registration UX
- password recovery
- phone verification UX
- WhatsApp provider integration
- account linking across multiple real-world identity providers

Those are future auth-entry decisions. This plan is only about getting safe ownership and usable read access into the MVP.

## Future Extension Path

When the team is ready for production auth, add persistent identity mapping with a shape like:

- `tenant_users`
- `tenant_identities`
- `tenant_unit_memberships`

Suggested concept:

- `tenant_users` stores the canonical internal user
- `tenant_identities` stores external login identifiers by provider
- `tenant_unit_memberships` stores the units the user may access

That future step should replace the demo catalog, but it should not require reworking the ownership model, route contracts, or `AuthContext`.

## Exit Criteria

This plan is complete when:

- local testers can authenticate as seeded demo tenants
- every conversation action is ownership-checked
- the required read APIs exist and are tenant-scoped
- cross-tenant record access is blocked by backend enforcement
- the repo still uses the same internal auth contract when a real sign-in method is introduced later
