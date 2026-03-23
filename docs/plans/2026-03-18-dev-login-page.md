# Plan: Dev Login Page for Local Testing

**Created:** 2026-03-18
**Branch:** `fix/honest-health-endpoints` (existing)
**Goal:** Add a one-click dev login page that eliminates the manual curl + copy-paste step for testing the chat UI locally.

---

## Context

Testing the chat agent locally requires:

1. Start dev server (`pnpm --filter @wo-agent/web dev`)
2. POST to `/api/dev/auth/demo-login` with a persona key to get a JWT
3. Copy the token into the browser URL as `?token=...&units=...`

This plan adds a `/dev/login` page that handles steps 2-3 automatically.

---

## Batch 1 — Environment Setup (1 task)

### Task 1.1: Add dev auth variables to `.env.local`

Append the missing variables to the existing `.env.local`:

```
ENABLE_DEV_AUTH=true
USE_DEMO_UNIT_RESOLVER=true
JWT_ACCESS_SECRET=local-dev-secret-at-least-32-characters-long
JWT_REFRESH_SECRET=local-dev-refresh-secret-at-least-32-chars
```

`.env.local` is already gitignored. These are dev-only values.

---

## Batch 2 — Dev Login Page (2 tasks)

### Task 2.1: Create dev login page

**File:** `apps/web/src/app/dev/login/page.tsx` (new)

A client component that:

1. Shows three buttons: "Alice (1 unit)", "Bob (3 units)", "Carol (1 unit, different account)"
2. On click, POSTs to `/api/dev/auth/demo-login` with the persona key
3. On success, redirects to `/?token=<access_token>&units=<unit_ids>`
4. Shows an error message if the API returns an error (e.g., `DEV_AUTH_DISABLED`)

Design notes:

- `'use client'` — needs `fetch` and `useRouter`
- Inline styles (consistent with existing `page.tsx` and `layout.tsx` — no CSS modules in use)
- No server-side gate needed — the API already returns 403 if `ENABLE_DEV_AUTH !== 'true'`
- Show persona details (name, unit count) so the user knows what they're testing
- Show loading state on the button while the token request is in flight

### Task 2.2: Verify locally

1. `pnpm --filter @wo-agent/web dev`
2. Navigate to `http://localhost:3000/dev/login`
3. Click "Alice" — should redirect to chat UI with token
4. Type a message — should get a response (stub LLM)
5. Click "Bob" — should show unit selector first (3 units)

---

## Files Changed (Expected)

| File                                  | Action                                             |
| ------------------------------------- | -------------------------------------------------- |
| `apps/web/.env.local`                 | Edit — append 4 dev auth variables (not committed) |
| `apps/web/src/app/dev/login/page.tsx` | New — dev login page                               |

## Out of Scope

- Production auth flow
- Styling beyond inline (no CSS framework needed for a dev page)
- Tests for the login page (it's a dev-only UI that delegates to the already-tested API)
