# Review Findings Fix Plan

**Date:** 2026-03-13
**Scope:** 4 review findings (2 High, 1 Medium, 1 Low)
**Status:** Planned

---

## Finding 1 (High): S12-03 — New issue detection incomplete

**Root cause:** Three gaps.

**Gap A — State guard too narrow:**
`submit-additional-message.ts:11` only checks `NEEDS_TENANT_INPUT`, but spec section 12.2 (`spec.md:421`) says "When in `needs_tenant_input` **or** `tenant_confirmation_pending`".

**Gap B — Heuristic doesn't adapt to confirmation state:**
In `tenant_confirmation_pending`, there are no `pending_followup_questions` (they're cleared after classification completes). The current heuristic at line 12 returns false when there are no pending questions. For confirmation state, any substantial free-text message that isn't "yes"/"confirm"/"no" type is likely a new issue.

**Gap C — No downstream consumer of queued messages:**
`confirm-submission.ts` transitions to `submitted` but never checks `session.queued_messages`. The spec says "offer immediate next intake using queued text after submission." The response builder also doesn't surface queued messages.

### Tasks

| #   | Task                                                              | File(s)                                                                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | Expand `isLikelyNewIssue` to accept `tenant_confirmation_pending` | `packages/core/src/orchestrator/action-handlers/submit-additional-message.ts` | Change the state check on line 11 from `!== NEEDS_TENANT_INPUT` to a set check: `!new Set([NEEDS_TENANT_INPUT, TENANT_CONFIRMATION_PENDING]).has(state)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1b  | Add confirmation-state heuristic branch                           | `packages/core/src/orchestrator/action-handlers/submit-additional-message.ts` | When state is `tenant_confirmation_pending`, there are no `pending_followup_questions` to compare against. Reuse the same length threshold (>100 chars) as the `needs_tenant_input` path, but skip the field-reference check since there are no pending questions. This means short new issues like "kitchen sink leaking too" (25 chars) will NOT be detected — the heuristic under-queues in confirmation state. This is a known limitation: reliably distinguishing a short new issue from a short confirmation remark without an LLM call is not feasible with a deterministic heuristic. The gap is documented in 1h alongside the frontend gaps.                                                                                                                                                                                                                                                                                                                  |
| 1c  | Surface queued-message prompt after submission (backend only)     | `packages/core/src/orchestrator/action-handlers/confirm-submission.ts`        | After the successful submission path (line 252-270), check `session.queued_messages.length > 0`. If non-empty, append a UI message: `"You mentioned another issue earlier. You can start a new request to address it."`. Do NOT add a quick reply — `chat-shell.tsx:60` falls back unknown `action_type` values to `submitAdditionalMessage` which would post into the old conversation, and `api-client.ts:51` creates only empty conversations with no way to pass queued text. The prompt is informational only. Note: the current `submitted`-state UI (`status-indicator.tsx:52-60`) renders only work order IDs and no "Start a request" button — so the tenant has no in-state affordance to act on this prompt. The gap is tracked in 1h.                                                                                                                                                                                                                       |
| 1d  | Add `queued_messages` to `ConversationSnapshot` schema + types    | 4 files (see below)                                                           | The `ConversationSnapshot` JSON schema (`orchestrator_action.schema.json:393`) has `additionalProperties: false`, so adding `queued_messages` to the response-builder alone would fail schema validation. Update all layers: **(1)** `packages/schemas/orchestrator_action.schema.json` — add `"queued_messages": { "type": "array", "items": { "type": "string" } }` to the `ConversationSnapshot.properties` block (before line 430). **(2)** `packages/schemas/src/types/orchestrator-action.ts` — add `readonly queued_messages?: readonly string[]` to the `ConversationSnapshot` interface (after line 221). **(3)** `packages/core/src/orchestrator/response-builder.ts` — include `queued_messages` in the snapshot object (line 43-60) when `session.queued_messages.length > 0`. **(4)** `packages/schemas/src/__tests__/validators.test.ts` — add a test that a response with `queued_messages` on the snapshot passes `validateOrchestratorActionResponse`. |
| 1e  | Add tests for `tenant_confirmation_pending` detection             | `packages/core/src/__tests__/orchestrator/intake-edge-cases.test.ts`          | Add 3 tests: (1) long message (>100 chars) in `tenant_confirmation_pending` is queued as new issue; (2) short message ("yes, looks good") in `tenant_confirmation_pending` is NOT queued (<=100 chars = confirmation-related); (3) long message containing confirmation-like words ("no heat in the bedroom, it's been freezing for three days and the thermostat is broken, please send someone to check as soon as possible") IS queued (>100 chars overrides any keyword content).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1f  | Add test for queued message surfacing after submission            | `packages/core/src/__tests__/confirmation/confirm-submission.test.ts`         | Add test: session with `queued_messages: ["parking garage door broken..."]` after CONFIRM_SUBMISSION, response includes the informational UI message about starting a new request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1g  | Add test for `queued_messages` in snapshot                        | `packages/core/src/__tests__/orchestrator/response-builder.test.ts`           | Add test: build response from a handler result where `session.queued_messages` is non-empty; verify the output `conversation_snapshot.queued_messages` contains the expected values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1h  | Mark S12-03 as `PARTIAL` in tracker                               | `docs/spec-gap-tracker.md:230`                                                | Change status to `PARTIAL`. Gap: "Detection works in both states but the confirmation-state heuristic is length-only (>100 chars), so short new issues like 'kitchen sink leaking too' are missed — reliable short-message disambiguation would require an LLM call. Queued messages are surfaced in the submission response and exposed in `ConversationSnapshot` (schema + types + response-builder). Frontend cannot act on them: (1) `status-indicator.tsx` renders no 'Start new request' button in `submitted` state, (2) `chat-shell.tsx` has no handler for a queued-text handoff action, (3) `api-client.ts` `createConversation()` accepts no pre-fill text, (4) `use-conversation` hook has no queued-text flow." Evidence: updated handler + tests + schema + response-builder. Update dashboard count: DONE 141 to 140, PARTIAL 0 to 1.                                                                                                                    |

**Scope boundary:** The full "offer immediate next intake using queued text" requires frontend work across `status-indicator.tsx` (add button for `submitted` state), `chat-shell.tsx` (handle queued-text handoff), `api-client.ts` (accept pre-fill text in `createConversation`), and `use-conversation.ts` (wire the flow). That work is explicitly out of scope for this plan. The backend detects, queues, surfaces, and exposes the data; the frontend actionability is tracked as the remaining gap in S12-03.

---

## Finding 2 (High): Flaky test gate — orchestrator-factory-llm timeout

**Root cause:** Each test does `await import('../orchestrator-factory.js')` which cold-loads the entire factory dependency tree (taxonomy JSON, risk protocols, escalation plans, cue dictionary, etc.). Under the full suite with many parallel tests competing for CPU, this exceeds the default 5s vitest timeout.

### Tasks

| #   | Task                                   | File(s)                                                       | Detail                                                                                                                                                          |
| --- | -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a  | Increase timeout for factory LLM tests | `apps/web/src/lib/__tests__/orchestrator-factory-llm.test.ts` | Add `{ timeout: 15_000 }` to each `it()` call on lines 28 and 35. This is the minimal fix — the cold import is inherently slow due to synchronous JSON loading. |
| 2b  | Verify fix under full suite            | —                                                             | Run `pnpm test` end-to-end and confirm both tests pass reliably.                                                                                                |

**Alternative considered:** Lazy-loading taxonomy/protocols in the factory. Rejected — too invasive for this fix, and the sync load is by design (CLAUDE.md: "loaded at import time"). The timeout increase is proportionate.

---

## Finding 3 (Medium): ESLint fails on next-env.d.ts

**Root cause:** `next-env.d.ts` is auto-generated by Next.js and contains `/// <reference path="./.next/types/routes.d.ts" />`. This violates `@typescript-eslint/triple-slash-reference` (included in `tseslint.configs.recommended`). The file is in `.gitignore` but exists on disk, so ESLint still lints it.

### Tasks

| #   | Task                                  | File(s)               | Detail                                                                                                                 |
| --- | ------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 3a  | Add `next-env.d.ts` to ESLint ignores | `eslint.config.js:10` | Add `'**/next-env.d.ts'` to the `ignores` array on line 10 alongside the existing `**/dist/`, `**/node_modules/`, etc. |
| 3b  | Verify lint passes                    | —                     | Run `pnpm lint` and confirm exit code 0.                                                                               |

---

## Finding 4 (Low): .claude/settings.local.json tracked in git

**Root cause:** The file was added to the index before `.gitignore` included it. `.gitignore` only prevents future tracking of untracked files — it doesn't affect already-tracked files.

### Tasks

| #   | Task                         | File(s)                       | Detail                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4a  | Remove from git index        | `.claude/settings.local.json` | Run `git rm --cached .claude/settings.local.json`. This removes it from the index while keeping the local file intact.                                                                                                                                                                                                                         |
| 4b  | Verify gitignore protects it | —                             | Run `git check-ignore .claude/settings.local.json` (should print the path, confirming the ignore rule matches) and `git ls-files --error-unmatch .claude/settings.local.json` (should exit non-zero, confirming the file is no longer tracked). Do not rely on `git status` — a correctly ignored file typically does not appear there at all. |

---

## Execution Order

The tasks have no cross-dependencies except that the tracker update (1h) should happen after all code changes. Recommended order:

1. **4a, 4b** — Quickest, zero risk (git index only)
2. **3a** then **3b** — Quick ESLint config fix + verify
3. **2a** then **2b** — Timeout fix + verify full suite
4. **1d** — Schema + types first (schema-first development)
5. **1a** then **1b** then **1c** — Detection + queuing + submission prompt
6. **1e** then **1f** then **1g** — Tests for detection, submission, and snapshot
7. **1h** — Tracker update (after all code is done)
8. **Final gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`

Batches 1-3 are independent and can be parallelized. Batch 4 must precede 5 (types must exist before code uses them). Batch 5 is sequential. Batch 6 tests can be written in parallel. Batch 7 is a single edit. Batch 8 is the validation gate.

---

## Acceptance Criteria

- `pnpm test` passes reliably (not flaky)
- `pnpm lint` exits 0
- `pnpm typecheck` passes
- `pnpm format:check` passes
- S12-03 detects new issues in both `needs_tenant_input` and `tenant_confirmation_pending`, with a known limitation: the confirmation-state heuristic is length-only (>100 chars), so short new issues are missed
- Queued messages surface an informational prompt after CONFIRM_SUBMISSION
- `queued_messages` added to `ConversationSnapshot` across all layers: JSON schema, TypeScript type, response-builder
- Schema validator test covers snapshot with `queued_messages`
- S12-03 marked `PARTIAL` with explicit gaps listing both the backend detection limitation (short-message disambiguation) and the 4 frontend files that need work
- `.claude/settings.local.json` no longer tracked (verified via `git ls-files` and `git check-ignore`)
- Tracker dashboard counts updated accurately (DONE 140, PARTIAL 1)
