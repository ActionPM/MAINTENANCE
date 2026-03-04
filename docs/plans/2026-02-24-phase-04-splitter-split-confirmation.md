# Phase 4: Splitter + Split Confirmation UI Flows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Implement the IssueSplitter LLM tool, wire it into the orchestrator, and build the full split confirmation flow (confirm/merge/edit/add/reject) with schema validation, input sanitization, and comprehensive tests.

**Architecture:** The IssueSplitter is injected into the orchestrator as a dependency (`OrchestratorDependencies.issueSplitter`). The `handleSubmitInitialMessage` handler calls the splitter, validates its output against `issue_split.schema.json`, and transitions to `SPLIT_PROPOSED` on success or `LLM_ERROR_*` on failure. Split issues are stored on `ConversationSession` and mutated by the split confirmation action handlers (merge/edit/add/reject). Input sanitization enforces spec §13 constraints (500 char max, 10 issues max, control char stripping).

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema validation), `@wo-agent/schemas` validators

**Prerequisite:** Phase 3 orchestrator must be merged to the working branch. This plan branches from `feature/phase-03-orchestrator`.

**Spec references:** §2 (non-negotiables), §10 (orchestrator contract), §11.2 (transition matrix), §13 (splitting), §8 (payload caps)

**Skills that apply during execution:**
- `@test-driven-development` — every task follows red-green-refactor
- `@state-machine-implementation` — any state transition changes
- `@schema-first-development` — all model outputs validated
- `@llm-tool-contracts` — IssueSplitter schema-lock, retry logic
- `@append-only-events` — event table writes
- `@project-conventions` — naming, structure, commands

---

## Task 0: Create worktree and branch from Phase 3

**Files:**
- N/A (git operations only)

**Step 1: Create worktree branching from Phase 3 orchestrator**

```bash
cd /workspaces/MAINTENANCE
git worktree add .worktrees/phase-04-splitter feature/phase-03-orchestrator -b feature/phase-04-splitter
```

**Step 2: Verify the worktree has Phase 3 code**

```bash
ls .worktrees/phase-04-splitter/packages/core/src/orchestrator/
```

Expected: `action-handlers/`, `dispatcher.ts`, `response-builder.ts`, `types.ts`, `index.ts`

**Step 3: Install dependencies**

```bash
cd .worktrees/phase-04-splitter && pnpm install
```

**Step 4: Run existing tests to confirm green baseline**

```bash
pnpm -r test
```

Expected: All tests pass.

**Step 5: Commit — no code changes, just branch creation**

No commit needed — branch created from Phase 3 HEAD.

---

## Task 1: Extend ConversationSession with split issues storage

**Files:**
- Modify: `packages/core/src/session/types.ts`
- Modify: `packages/core/src/session/session.ts`
- Test: `packages/core/src/__tests__/session/session.test.ts`

**Context:** The session currently has no field for split issues. We need `split_issues` to persist the splitter output across the split confirmation flow (merge/edit/add/reject all mutate this array). The `SplitIssue` type already exists in `@wo-agent/schemas`.

**Step 1: Write the failing test**

Add to `packages/core/src/__tests__/session/session.test.ts`:

```typescript
import type { SplitIssue } from '@wo-agent/schemas';

describe('setSplitIssues', () => {
  it('stores split issues on session', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
    });
    expect(session.split_issues).toBeNull();

    const issues: SplitIssue[] = [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
      { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light is broken' },
    ];
    const updated = setSplitIssues(session, issues);
    expect(updated.split_issues).toEqual(issues);
    expect(updated.split_issues).not.toBe(issues); // defensive copy
    expect(updated.last_activity_at).not.toBe(session.last_activity_at);
  });

  it('allows clearing split issues with null', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
    });
    session = setSplitIssues(session, [{ issue_id: 'i1', summary: 'Test', raw_excerpt: 'test' }]);
    const cleared = setSplitIssues(session, null);
    expect(cleared.split_issues).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/session/session.test.ts`
Expected: FAIL — `setSplitIssues` not exported, `split_issues` not on type

**Step 3: Add `split_issues` to ConversationSession type**

In `packages/core/src/session/types.ts`, add to `ConversationSession`:

```typescript
readonly split_issues: readonly SplitIssue[] | null;
```

Add import at top:

```typescript
import type { ConversationState, PinnedVersions, SplitIssue } from '@wo-agent/schemas';
```

**Step 4: Update createSession to initialize split_issues**

In `packages/core/src/session/session.ts`, in `createSession()`:

```typescript
split_issues: null,
```

**Step 5: Add setSplitIssues function**

In `packages/core/src/session/session.ts`:

```typescript
/**
 * Store split issues on the session (spec §13).
 * Issues are defensively copied to prevent external mutation.
 */
export function setSplitIssues(
  session: ConversationSession,
  issues: readonly SplitIssue[] | null,
): ConversationSession {
  return {
    ...session,
    split_issues: issues ? [...issues] : null,
    last_activity_at: new Date().toISOString(),
  };
}
```

Add `SplitIssue` import to session.ts:

```typescript
import type { SplitIssue } from '@wo-agent/schemas';
```

**Step 6: Export setSplitIssues from session/index.ts and core/index.ts**

In `packages/core/src/session/index.ts`, add `setSplitIssues` to the exports.
In `packages/core/src/index.ts`, add `setSplitIssues` to the Session exports.

**Step 7: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/session/session.test.ts`
Expected: PASS

**Step 8: Run full test suite to confirm no regressions**

Run: `pnpm -r test`
Expected: All pass. Some existing tests may need `split_issues: null` added to session assertions if they do deep equality checks.

**Step 9: Commit**

```bash
git add packages/core/src/session/types.ts packages/core/src/session/session.ts packages/core/src/session/index.ts packages/core/src/index.ts packages/core/src/__tests__/session/session.test.ts
git commit -m "feat(core): add split_issues field to ConversationSession"
```

---

## Task 2: Add IssueSplitter port to OrchestratorDependencies

**Files:**
- Modify: `packages/core/src/orchestrator/types.ts`
- Modify: `packages/core/src/__tests__/orchestrator-integration.test.ts` (update deps)
- Modify: All test files that create `OrchestratorDependencies` fixtures

**Context:** The orchestrator dispatches to action handlers via injected dependencies. We add the IssueSplitter as a typed function port so it can be mocked in tests and implemented with real LLM calls in production.

**Step 1: Add issueSplitter to OrchestratorDependencies**

In `packages/core/src/orchestrator/types.ts`:

```typescript
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';
```

Add to `OrchestratorDependencies`:

```typescript
readonly issueSplitter: (input: IssueSplitterInput) => Promise<IssueSplitterOutput>;
```

**Step 2: Run tests to see what breaks**

Run: `pnpm -r test`
Expected: FAIL — all test fixtures that construct `OrchestratorDependencies` are now missing `issueSplitter`.

**Step 3: Update all test fixtures**

In every test file that constructs deps, add a default stub:

```typescript
issueSplitter: async () => ({ issues: [], issue_count: 0 }),
```

Files to update (search for `OrchestratorDependencies` or `makeDeps` or `deps:` in test files):
- `packages/core/src/__tests__/orchestrator-integration.test.ts`
- `packages/core/src/__tests__/orchestrator/dispatcher.test.ts`
- `packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`
- `packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts`
- `packages/core/src/__tests__/orchestrator/action-handlers/remaining-handlers.test.ts`
- Any other test files constructing deps (grep for `eventRepo:` to find them)

**Step 4: Run tests to verify all pass again**

Run: `pnpm -r test`
Expected: All PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/types.ts packages/core/src/__tests__/
git commit -m "feat(core): add issueSplitter port to OrchestratorDependencies"
```

---

## Task 3: Input sanitization utility

**Files:**
- Create: `packages/core/src/splitter/input-sanitizer.ts`
- Create: `packages/core/src/splitter/index.ts`
- Test: `packages/core/src/__tests__/splitter/input-sanitizer.test.ts`

**Context:** Spec §13 requires: max 500 chars per issue, max 10 issues per conversation, sanitize input (strip control chars, escape HTML, normalize whitespace). This utility is used by EDIT_ISSUE and ADD_ISSUE handlers.

**Step 1: Write the failing tests**

Create `packages/core/src/__tests__/splitter/input-sanitizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sanitizeIssueText, validateIssueConstraints } from '../../splitter/input-sanitizer.js';

describe('sanitizeIssueText', () => {
  it('passes through clean text unchanged', () => {
    expect(sanitizeIssueText('Toilet is leaking')).toBe('Toilet is leaking');
  });

  it('strips control characters', () => {
    expect(sanitizeIssueText('Toilet\x00 is\x07 leaking')).toBe('Toilet is leaking');
  });

  it('preserves newlines and tabs as spaces', () => {
    expect(sanitizeIssueText('Line one\nLine two\tEnd')).toBe('Line one Line two End');
  });

  it('normalizes consecutive whitespace', () => {
    expect(sanitizeIssueText('Too   many    spaces')).toBe('Too many spaces');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeIssueText('  padded  ')).toBe('padded');
  });

  it('escapes HTML angle brackets', () => {
    expect(sanitizeIssueText('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(sanitizeIssueText('R&D department')).toBe('R&amp;D department');
  });

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(600);
    expect(sanitizeIssueText(long, 500).length).toBe(500);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeIssueText('')).toBe('');
  });
});

describe('validateIssueConstraints', () => {
  it('returns valid for normal input', () => {
    const result = validateIssueConstraints('Fix the sink', 3);
    expect(result.valid).toBe(true);
  });

  it('rejects empty text after sanitization', () => {
    const result = validateIssueConstraints('', 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects text exceeding 500 chars', () => {
    const result = validateIssueConstraints('a'.repeat(501), 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
  });

  it('rejects when adding would exceed 10 issues', () => {
    const result = validateIssueConstraints('Valid text', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10');
  });

  it('allows adding when at 9 issues (reaching 10)', () => {
    const result = validateIssueConstraints('Valid text', 9);
    expect(result.valid).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/splitter/input-sanitizer.test.ts`
Expected: FAIL — module not found

**Step 3: Implement input-sanitizer.ts**

Create `packages/core/src/splitter/input-sanitizer.ts`:

```typescript
const MAX_ISSUE_TEXT_CHARS = 500;
const MAX_ISSUES_PER_CONVERSATION = 10;

/**
 * Sanitize tenant-provided issue text (spec §13):
 * - Strip control chars (except space)
 * - Replace newlines/tabs with spaces
 * - Normalize consecutive whitespace
 * - Escape HTML entities
 * - Trim
 * - Truncate to maxLength
 */
export function sanitizeIssueText(text: string, maxLength = MAX_ISSUE_TEXT_CHARS): string {
  let sanitized = text
    // Strip control characters (U+0000–U+001F, U+007F–U+009F) except space (0x20)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, (ch) => (ch === '\n' || ch === '\t' || ch === '\r' ? ' ' : ''))
    // Normalize consecutive whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Escape HTML entities
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Truncate
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

export interface IssueConstraintResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Validate issue text and count constraints (spec §13, §8):
 * - Text must not be empty after sanitization
 * - Text must not exceed 500 chars
 * - Total issues must not exceed 10
 */
export function validateIssueConstraints(
  text: string,
  currentIssueCount: number,
): IssueConstraintResult {
  if (text.trim().length === 0) {
    return { valid: false, error: 'Issue text must not be empty' };
  }
  if (text.length > MAX_ISSUE_TEXT_CHARS) {
    return { valid: false, error: `Issue text must not exceed ${MAX_ISSUE_TEXT_CHARS} characters` };
  }
  if (currentIssueCount >= MAX_ISSUES_PER_CONVERSATION) {
    return { valid: false, error: `Cannot exceed ${MAX_ISSUES_PER_CONVERSATION} issues per conversation` };
  }
  return { valid: true };
}
```

**Step 4: Create barrel export**

Create `packages/core/src/splitter/index.ts`:

```typescript
export { sanitizeIssueText, validateIssueConstraints } from './input-sanitizer.js';
export type { IssueConstraintResult } from './input-sanitizer.js';
```

**Step 5: Export from core index.ts**

In `packages/core/src/index.ts`, add:

```typescript
// --- Splitter (Phase 4) ---
export { sanitizeIssueText, validateIssueConstraints } from './splitter/index.js';
export type { IssueConstraintResult } from './splitter/index.js';
```

**Step 6: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/splitter/input-sanitizer.test.ts`
Expected: All PASS

**Step 7: Commit**

```bash
git add packages/core/src/splitter/ packages/core/src/__tests__/splitter/ packages/core/src/index.ts
git commit -m "feat(core): add input sanitization for tenant issue edits"
```

---

## Task 4: Implement IssueSplitter tool wrapper with schema validation and retry

**Files:**
- Create: `packages/core/src/splitter/issue-splitter.ts`
- Modify: `packages/core/src/splitter/index.ts`
- Test: `packages/core/src/__tests__/splitter/issue-splitter.test.ts`

**Context:** Spec §2.3 requires schema-locking all model outputs. The IssueSplitter wrapper validates output against the JSON Schema, retries once on validation failure, and throws a typed error on terminal failure. The actual LLM call is a dependency-injected function — this wrapper adds the schema enforcement layer. Spec non-negotiable §2.2: "Split first; never classify until split is finalized."

**Step 1: Write the failing tests**

Create `packages/core/src/__tests__/splitter/issue-splitter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { callIssueSplitter, SplitterError, SplitterErrorCode } from '../../splitter/issue-splitter.js';
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';

const VALID_INPUT: IssueSplitterInput = {
  raw_text: 'My toilet is leaking and the kitchen light is broken',
  conversation_id: 'conv-1',
  taxonomy_version: '1.0.0',
  model_id: 'gpt-4',
  prompt_version: '1.0.0',
};

const VALID_OUTPUT: IssueSplitterOutput = {
  issues: [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
    { issue_id: 'i2', summary: 'Kitchen light broken', raw_excerpt: 'kitchen light is broken' },
  ],
  issue_count: 2,
};

describe('callIssueSplitter', () => {
  it('returns validated output on success', async () => {
    const llmCall = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const result = await callIssueSplitter(VALID_INPUT, llmCall);
    expect(result).toEqual(VALID_OUTPUT);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries once on schema validation failure then succeeds', async () => {
    const invalidOutput = { issues: [{ summary: 'no id' }], issue_count: 1 };
    const llmCall = vi.fn()
      .mockResolvedValueOnce(invalidOutput)
      .mockResolvedValueOnce(VALID_OUTPUT);
    const result = await callIssueSplitter(VALID_INPUT, llmCall);
    expect(result).toEqual(VALID_OUTPUT);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws SplitterError after retry also fails validation', async () => {
    const invalidOutput = { issues: [], issue_count: 0 };
    const llmCall = vi.fn().mockResolvedValue(invalidOutput);
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toThrow(SplitterError);
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toMatchObject({
      code: SplitterErrorCode.SCHEMA_VALIDATION_FAILED,
    });
    expect(llmCall).toHaveBeenCalledTimes(4); // 2 calls per invocation (initial + retry)
  });

  it('throws SplitterError when LLM call throws', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toThrow(SplitterError);
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toMatchObject({
      code: SplitterErrorCode.LLM_CALL_FAILED,
    });
  });

  it('validates issue_count matches issues array length', async () => {
    const mismatch: IssueSplitterOutput = {
      issues: [{ issue_id: 'i1', summary: 'One issue', raw_excerpt: 'one' }],
      issue_count: 5, // mismatch
    };
    const llmCall = vi.fn().mockResolvedValue(mismatch);
    // First call returns mismatch, retry also returns mismatch
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toThrow(SplitterError);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/splitter/issue-splitter.test.ts`
Expected: FAIL — module not found

**Step 3: Implement issue-splitter.ts**

Create `packages/core/src/splitter/issue-splitter.ts`:

```typescript
import { validateIssueSplitterOutput } from '@wo-agent/schemas';
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';

export enum SplitterErrorCode {
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  LLM_CALL_FAILED = 'LLM_CALL_FAILED',
  ISSUE_COUNT_MISMATCH = 'ISSUE_COUNT_MISMATCH',
}

export class SplitterError extends Error {
  constructor(
    public readonly code: SplitterErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SplitterError';
  }
}

type LlmSplitterFn = (input: IssueSplitterInput) => Promise<unknown>;

/**
 * Call the IssueSplitter LLM tool with schema validation and one retry (spec §2.3).
 *
 * Flow:
 * 1. Call LLM function
 * 2. Validate output against issue_split.schema.json
 * 3. Validate issue_count matches issues.length
 * 4. On validation failure: retry once with same input
 * 5. On second failure: throw SplitterError
 * 6. On LLM exception: throw SplitterError immediately (no retry)
 */
export async function callIssueSplitter(
  input: IssueSplitterInput,
  llmCall: LlmSplitterFn,
): Promise<IssueSplitterOutput> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await llmCall(input);
    } catch (err) {
      throw new SplitterError(
        SplitterErrorCode.LLM_CALL_FAILED,
        `IssueSplitter LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const validation = validateIssueSplitterOutput(raw);
    if (!validation.valid) {
      lastError = validation.errors;
      continue;
    }

    const output = validation.data;

    // Semantic validation: issue_count must match issues array length
    if (output.issue_count !== output.issues.length) {
      lastError = `issue_count (${output.issue_count}) does not match issues.length (${output.issues.length})`;
      continue;
    }

    return output;
  }

  throw new SplitterError(
    SplitterErrorCode.SCHEMA_VALIDATION_FAILED,
    `IssueSplitter output failed validation after retry: ${JSON.stringify(lastError)}`,
    lastError,
  );
}
```

**Step 4: Export from splitter/index.ts**

Add to `packages/core/src/splitter/index.ts`:

```typescript
export { callIssueSplitter, SplitterError, SplitterErrorCode } from './issue-splitter.js';
```

**Step 5: Export from core index.ts**

Add to the Splitter section of `packages/core/src/index.ts`:

```typescript
export { callIssueSplitter, SplitterError, SplitterErrorCode } from './splitter/index.js';
```

**Step 6: Verify the @wo-agent/schemas package exports validateIssueSplitterOutput**

Check `packages/schemas/src/index.ts` — if `validateIssueSplitterOutput` is not exported, add it to the barrel export. Also verify `SplitIssue` is exported from `@wo-agent/schemas`.

**Step 7: Run tests to verify they pass**

Run: `cd packages/core && pnpm vitest run src/__tests__/splitter/issue-splitter.test.ts`
Expected: All PASS

**Step 8: Run full test suite**

Run: `pnpm -r test`
Expected: All PASS

**Step 9: Commit**

```bash
git add packages/core/src/splitter/ packages/core/src/__tests__/splitter/ packages/core/src/index.ts packages/schemas/src/index.ts
git commit -m "feat(core): add IssueSplitter wrapper with schema validation and retry"
```

---

## Task 5: Wire splitter into submit-initial-message handler

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts`
- Modify: `packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`

**Context:** The current handler is a stub that always returns `SPLIT_IN_PROGRESS`. We wire it to call the injected splitter and return either `SPLIT_PROPOSED` (success) or an error state (failure). The handler calls the splitter synchronously — the tenant waits for the result. The transition through `SPLIT_IN_PROGRESS` is implicit and recorded in the event payload for audit.

**Design note:** The dispatcher validates that `SUBMIT_INITIAL_MESSAGE` is allowed from the current state (per transition matrix), but does not validate the handler's returned target state. This lets the handler complete the full split flow (call LLM, validate, store issues) and return the final state. The event payload records the intermediate flow for audit traceability.

**Step 1: Write the failing tests**

Replace `packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import type { IssueSplitterOutput } from '@wo-agent/schemas';
import { handleSubmitInitialMessage } from '../../../orchestrator/action-handlers/submit-initial-message.js';
import { createSession, updateSessionState, setSessionUnit } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

const VALID_SPLIT: IssueSplitterOutput = {
  issues: [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
    { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light is broken' },
  ],
  issue_count: 2,
};

function makeContext(
  unitResolved: boolean,
  splitterResult?: IssueSplitterOutput | Error,
): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  if (unitResolved) {
    session = updateSessionState(session, ConversationState.UNIT_SELECTED);
    session = setSessionUnit(session, 'u1');
  }

  const issueSplitter = splitterResult instanceof Error
    ? vi.fn().mockRejectedValue(splitterResult)
    : vi.fn().mockResolvedValue(splitterResult ?? VALID_SPLIT);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking and kitchen light is broken' },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
      issueSplitter,
    },
  };
}

describe('handleSubmitInitialMessage', () => {
  it('transitions to split_proposed on successful split', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.split_issues).toEqual(VALID_SPLIT.issues);
    expect(result.quickReplies).toBeDefined();
    expect(result.quickReplies!.length).toBeGreaterThan(0);
  });

  it('passes correct input to splitter', async () => {
    const ctx = makeContext(true);
    await handleSubmitInitialMessage(ctx);
    expect(ctx.deps.issueSplitter).toHaveBeenCalledWith({
      raw_text: 'My toilet is leaking and kitchen light is broken',
      conversation_id: 'conv-1',
      taxonomy_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    });
  });

  it('transitions to llm_error_retryable on splitter failure', async () => {
    const ctx = makeContext(true, new Error('LLM timeout'));
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.newState).toBe(ConversationState.LLM_ERROR_RETRYABLE);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('SPLITTER_FAILED');
  });

  it('stores prior state for error recovery', async () => {
    const ctx = makeContext(true, new Error('LLM timeout'));
    const result = await handleSubmitInitialMessage(ctx);
    // The session should have prior_state set for RESUME/RETRY recovery
    expect(result.transitionContext?.prior_state).toBe(ConversationState.UNIT_SELECTED);
  });

  it('rejects when unit is not resolved', async () => {
    const ctx = makeContext(false);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('UNIT_NOT_RESOLVED');
    expect(ctx.deps.issueSplitter).not.toHaveBeenCalled();
  });

  it('includes issues in UI messages', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.uiMessages.length).toBeGreaterThan(0);
    // Should describe the split to the tenant
    const content = result.uiMessages.map(m => m.content).join(' ');
    expect(content).toContain('2'); // issue count
  });

  it('includes event payload with split result', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.eventPayload).toBeDefined();
    expect(result.eventPayload!.message).toBe('My toilet is leaking and kitchen light is broken');
    expect(result.eventPayload!.split_result).toEqual(VALID_SPLIT);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`
Expected: FAIL — handler returns SPLIT_IN_PROGRESS, not SPLIT_PROPOSED

**Step 3: Implement the wired handler**

Replace `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts`:

```typescript
import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSubmitInitialMessage, IssueSplitterInput } from '@wo-agent/schemas';
import { resolveSubmitInitialMessage } from '../../state-machine/guards.js';
import { setSplitIssues } from '../../session/session.js';
import { callIssueSplitter, SplitterError } from '../../splitter/issue-splitter.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handle SUBMIT_INITIAL_MESSAGE (spec §11.2, §13).
 *
 * Flow:
 * 1. Validate unit is resolved
 * 2. Call IssueSplitter via deps (schema-validated with one retry)
 * 3. On success: store issues on session, return SPLIT_PROPOSED
 * 4. On failure: return LLM_ERROR_RETRYABLE with error details
 */
export async function handleSubmitInitialMessage(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;
  const input = ctx.request.tenant_input as TenantInputSubmitInitialMessage;

  const targetState = resolveSubmitInitialMessage({ unit_resolved: session.unit_id !== null });
  if (targetState === null) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'Please select a unit before submitting your request.' }],
      errors: [{ code: 'UNIT_NOT_RESOLVED', message: 'A unit must be selected before submitting a message' }],
    };
  }

  // Build splitter input from session's pinned versions
  const splitterInput: IssueSplitterInput = {
    raw_text: input.message,
    conversation_id: session.conversation_id,
    taxonomy_version: session.pinned_versions.taxonomy_version,
    model_id: session.pinned_versions.model_id,
    prompt_version: session.pinned_versions.prompt_version,
  };

  try {
    const splitResult = await callIssueSplitter(splitterInput, deps.issueSplitter);
    const updatedSession = setSplitIssues(session, splitResult.issues);

    const issueList = splitResult.issues
      .map((issue, i) => `${i + 1}. ${issue.summary}`)
      .join('\n');

    return {
      newState: ConversationState.SPLIT_PROPOSED,
      session: updatedSession,
      uiMessages: [
        {
          role: 'agent',
          content: splitResult.issue_count === 1
            ? `I identified 1 issue:\n\n1. ${splitResult.issues[0].summary}\n\nPlease confirm or edit this issue.`
            : `I identified ${splitResult.issue_count} issues:\n\n${issueList}\n\nPlease confirm, edit, or merge these issues.`,
        },
      ],
      quickReplies: [
        { label: 'Confirm', value: 'confirm', action_type: 'CONFIRM_SPLIT' },
        { label: 'Reject (single issue)', value: 'reject', action_type: 'REJECT_SPLIT' },
      ],
      eventPayload: { message: input.message, split_result: splitResult },
      eventType: 'message_received',
    };
  } catch (err) {
    const errorMessage = err instanceof SplitterError ? err.message : 'Unexpected error analyzing your request';
    return {
      newState: ConversationState.LLM_ERROR_RETRYABLE,
      session,
      uiMessages: [{ role: 'agent', content: 'I had trouble analyzing your request. Please try again.' }],
      errors: [{ code: 'SPLITTER_FAILED', message: errorMessage }],
      transitionContext: { prior_state: session.state },
      eventPayload: { message: input.message, error: errorMessage },
      eventType: 'error_occurred',
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All PASS (the integration test will need updating since it expects `split_in_progress` — update it in a later task)

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/submit-initial-message.ts packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts
git commit -m "feat(core): wire IssueSplitter into submit-initial-message handler"
```

---

## Task 6: Enhance split confirmation actions — MERGE, EDIT, ADD, REJECT, CONFIRM

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/split-actions.ts`
- Modify: `packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts`

**Context:** The current `handleSplitAction` is a stub that just transitions state. We enhance it to actually manage the issues array on the session: merge issues, edit summaries, add new issues, reject (collapse to single issue), and confirm (validate non-empty). All mutations go through input sanitization (spec §13).

**Step 1: Write the failing tests**

Replace `packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import type { SplitIssue } from '@wo-agent/schemas';
import { handleSplitAction } from '../../../orchestrator/action-handlers/split-actions.js';
import { createSession, updateSessionState, setSplitIssues } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

const ISSUES: SplitIssue[] = [
  { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
  { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light is broken' },
  { issue_id: 'i3', summary: 'Door squeaky', raw_excerpt: 'front door squeaks' },
];

function makeContext(
  actionType: string,
  tenantInput: Record<string, unknown> = {},
  issues: SplitIssue[] = ISSUES,
): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  session = updateSessionState(session, ConversationState.SPLIT_PROPOSED);
  session = setSplitIssues(session, issues);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: actionType as any,
      actor: ActorType.TENANT,
      tenant_input: tenantInput as any,
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
    },
  };
}

describe('CONFIRM_SPLIT', () => {
  it('transitions to split_finalized with existing issues', async () => {
    const ctx = makeContext(ActionType.CONFIRM_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.session.split_issues).toEqual(ISSUES);
  });

  it('rejects when no issues are stored', async () => {
    const ctx = makeContext(ActionType.CONFIRM_SPLIT, {}, []);
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('NO_ISSUES');
  });
});

describe('REJECT_SPLIT', () => {
  it('collapses to single issue and transitions to split_finalized', async () => {
    const ctx = makeContext(ActionType.REJECT_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.session.split_issues!.length).toBe(1);
    // Combined summary should include content from all original issues
    expect(result.session.split_issues![0].summary).toContain('Toilet leaking');
  });
});

describe('MERGE_ISSUES', () => {
  it('merges specified issues into one', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1', 'i2'] });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.split_issues!.length).toBe(2); // 3 - 2 merged + 1 new = 2
    const mergedIssue = result.session.split_issues!.find(i =>
      i.summary.includes('Toilet leaking') && i.summary.includes('Light broken')
    );
    expect(mergedIssue).toBeDefined();
  });

  it('rejects merge with fewer than 2 issue_ids', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1'] });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_MERGE');
  });

  it('rejects merge with unknown issue_id', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1', 'unknown'] });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('ISSUE_NOT_FOUND');
  });
});

describe('EDIT_ISSUE', () => {
  it('updates issue summary', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'Bathroom faucet dripping' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    const edited = result.session.split_issues!.find(i => i.issue_id === 'i1');
    expect(edited!.summary).toBe('Bathroom faucet dripping');
  });

  it('sanitizes edited text', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'Has <script>  extra   spaces' });
    const result = await handleSplitAction(ctx);
    const edited = result.session.split_issues!.find(i => i.issue_id === 'i1');
    expect(edited!.summary).toBe('Has &lt;script&gt; extra spaces');
  });

  it('rejects empty summary after sanitization', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: '   ' });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_ISSUE_TEXT');
  });

  it('rejects edit of unknown issue_id', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'unknown', summary: 'Test' });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('ISSUE_NOT_FOUND');
  });

  it('rejects summary exceeding 500 chars', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'a'.repeat(501) });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_ISSUE_TEXT');
  });
});

describe('ADD_ISSUE', () => {
  it('adds a new issue', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: 'Window cracked' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.split_issues!.length).toBe(4);
    const added = result.session.split_issues!.find(i => i.summary === 'Window cracked');
    expect(added).toBeDefined();
    expect(added!.issue_id).toBeDefined();
  });

  it('sanitizes added text', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: '<b>Bold</b>  issue' });
    const result = await handleSplitAction(ctx);
    const added = result.session.split_issues![result.session.split_issues!.length - 1];
    expect(added.summary).toBe('&lt;b&gt;Bold&lt;/b&gt; issue');
  });

  it('rejects when at 10 issues', async () => {
    const tenIssues = Array.from({ length: 10 }, (_, i) => ({
      issue_id: `i${i}`, summary: `Issue ${i}`, raw_excerpt: `excerpt ${i}`,
    }));
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: 'One too many' }, tenIssues);
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_ISSUE_TEXT');
  });

  it('rejects empty summary', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: '' });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator/action-handlers/split-actions.test.ts`
Expected: FAIL — handlers don't manage issues

**Step 3: Implement the enhanced split-actions handler**

Replace `packages/core/src/orchestrator/action-handlers/split-actions.ts`:

```typescript
import { ConversationState, ActionType } from '@wo-agent/schemas';
import type {
  TenantInputMergeIssues,
  TenantInputEditIssue,
  TenantInputAddIssue,
  SplitIssue,
} from '@wo-agent/schemas';
import { setSplitIssues } from '../../session/session.js';
import { sanitizeIssueText, validateIssueConstraints } from '../../splitter/input-sanitizer.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handler for split-related actions (spec §13):
 * CONFIRM_SPLIT, MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE, REJECT_SPLIT
 */
export async function handleSplitAction(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;
  const actionType = request.action_type;
  const issues = session.split_issues ?? [];

  if (actionType === ActionType.CONFIRM_SPLIT) {
    return handleConfirmSplit(ctx, issues);
  }
  if (actionType === ActionType.REJECT_SPLIT) {
    return handleRejectSplit(ctx, issues);
  }
  if (actionType === ActionType.MERGE_ISSUES) {
    return handleMergeIssues(ctx, issues);
  }
  if (actionType === ActionType.EDIT_ISSUE) {
    return handleEditIssue(ctx, issues);
  }
  if (actionType === ActionType.ADD_ISSUE) {
    return handleAddIssue(ctx, issues);
  }

  return {
    newState: session.state,
    session,
    uiMessages: [],
    errors: [{ code: 'UNKNOWN_SPLIT_ACTION', message: `Unhandled split action: ${actionType}` }],
  };
}

function handleConfirmSplit(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  if (issues.length === 0) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: 'No issues to confirm. Please try again.' }],
      errors: [{ code: 'NO_ISSUES', message: 'Cannot confirm split with no issues' }],
    };
  }

  return {
    newState: ConversationState.SPLIT_FINALIZED,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: `Split confirmed with ${issues.length} issue(s). Classifying...` }],
    eventPayload: { split_action: 'confirm', issue_count: issues.length },
  };
}

function handleRejectSplit(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  // Collapse all issues into a single issue
  const combinedSummary = issues.map(i => i.summary).join('; ');
  const combinedExcerpt = issues.map(i => i.raw_excerpt).join(' ');
  const singleIssue: SplitIssue = {
    issue_id: issues[0]?.issue_id ?? ctx.deps.idGenerator(),
    summary: combinedSummary || 'Single issue',
    raw_excerpt: combinedExcerpt || '',
  };

  const updatedSession = setSplitIssues(ctx.session, [singleIssue]);

  return {
    newState: ConversationState.SPLIT_FINALIZED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: 'Treating as a single issue. Classifying...' }],
    eventPayload: { split_action: 'reject', collapsed_to: singleIssue },
  };
}

function handleMergeIssues(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  const input = ctx.request.tenant_input as TenantInputMergeIssues;
  const idsToMerge = input.issue_ids;

  if (!idsToMerge || idsToMerge.length < 2) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: 'Please select at least 2 issues to merge.' }],
      errors: [{ code: 'INVALID_MERGE', message: 'Merge requires at least 2 issue IDs' }],
    };
  }

  // Validate all IDs exist
  const issueMap = new Map(issues.map(i => [i.issue_id, i]));
  for (const id of idsToMerge) {
    if (!issueMap.has(id)) {
      return {
        newState: ctx.session.state,
        session: ctx.session,
        uiMessages: [{ role: 'agent', content: `Issue "${id}" not found.` }],
        errors: [{ code: 'ISSUE_NOT_FOUND', message: `Issue ID not found: ${id}` }],
      };
    }
  }

  const mergeSet = new Set(idsToMerge);
  const toMerge = issues.filter(i => mergeSet.has(i.issue_id));
  const remaining = issues.filter(i => !mergeSet.has(i.issue_id));

  const merged: SplitIssue = {
    issue_id: toMerge[0].issue_id,
    summary: toMerge.map(i => i.summary).join('; '),
    raw_excerpt: toMerge.map(i => i.raw_excerpt).join(' '),
  };

  const newIssues = [...remaining, merged];
  const updatedSession = setSplitIssues(ctx.session, newIssues);

  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: buildIssueListMessage(newIssues) }],
    quickReplies: buildSplitQuickReplies(),
    eventPayload: { split_action: 'merge', merged_ids: idsToMerge },
  };
}

function handleEditIssue(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  const input = ctx.request.tenant_input as TenantInputEditIssue;

  const idx = issues.findIndex(i => i.issue_id === input.issue_id);
  if (idx === -1) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: `Issue "${input.issue_id}" not found.` }],
      errors: [{ code: 'ISSUE_NOT_FOUND', message: `Issue ID not found: ${input.issue_id}` }],
    };
  }

  const sanitized = sanitizeIssueText(input.summary);
  const validation = validateIssueConstraints(sanitized, issues.length);
  if (!validation.valid) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: validation.error! }],
      errors: [{ code: 'INVALID_ISSUE_TEXT', message: validation.error! }],
    };
  }

  const newIssues = [...issues];
  newIssues[idx] = { ...issues[idx], summary: sanitized };
  const updatedSession = setSplitIssues(ctx.session, newIssues);

  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: buildIssueListMessage(newIssues) }],
    quickReplies: buildSplitQuickReplies(),
    eventPayload: { split_action: 'edit', issue_id: input.issue_id, new_summary: sanitized },
  };
}

function handleAddIssue(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  const input = ctx.request.tenant_input as TenantInputAddIssue;

  const sanitized = sanitizeIssueText(input.summary);
  const validation = validateIssueConstraints(sanitized, issues.length);
  if (!validation.valid) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: validation.error! }],
      errors: [{ code: 'INVALID_ISSUE_TEXT', message: validation.error! }],
    };
  }

  const newIssue: SplitIssue = {
    issue_id: ctx.deps.idGenerator(),
    summary: sanitized,
    raw_excerpt: sanitized, // tenant-added issues use summary as excerpt
  };

  const newIssues = [...issues, newIssue];
  const updatedSession = setSplitIssues(ctx.session, newIssues);

  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: buildIssueListMessage(newIssues) }],
    quickReplies: buildSplitQuickReplies(),
    eventPayload: { split_action: 'add', new_issue: newIssue },
  };
}

function buildIssueListMessage(issues: readonly SplitIssue[]): string {
  const list = issues.map((issue, i) => `${i + 1}. ${issue.summary}`).join('\n');
  return `Updated issues:\n\n${list}\n\nReview and confirm when ready.`;
}

function buildSplitQuickReplies() {
  return [
    { label: 'Confirm', value: 'confirm', action_type: 'CONFIRM_SPLIT' },
    { label: 'Reject (single issue)', value: 'reject', action_type: 'REJECT_SPLIT' },
  ] as const;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator/action-handlers/split-actions.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All PASS

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/split-actions.ts packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts
git commit -m "feat(core): implement split confirmation actions (merge/edit/add/reject/confirm)"
```

---

## Task 7: Update response builder to include issues in snapshot

**Files:**
- Modify: `packages/core/src/orchestrator/response-builder.ts`
- Test: `packages/core/src/__tests__/orchestrator/response-builder.test.ts`

**Context:** The `ConversationSnapshot` type has an optional `issues` field. When the session has `split_issues`, they should be included in the response so the client UI can render the issue list.

**Step 1: Write the failing test**

Add to `packages/core/src/__tests__/orchestrator/response-builder.test.ts`:

```typescript
it('includes split_issues in snapshot when present', () => {
  const issues = [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
  ];
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  session = setSplitIssues(session, issues);

  const response = buildResponse({
    newState: ConversationState.SPLIT_PROPOSED,
    session,
    uiMessages: [{ role: 'agent', content: 'Issues found' }],
  });

  expect(response.conversation_snapshot.issues).toEqual(issues);
});

it('omits issues from snapshot when null', () => {
  const session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });

  const response = buildResponse({
    newState: ConversationState.INTAKE_STARTED,
    session,
    uiMessages: [],
  });

  expect(response.conversation_snapshot.issues).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator/response-builder.test.ts`
Expected: FAIL — issues not included

**Step 3: Update buildResponse to include issues**

In `packages/core/src/orchestrator/response-builder.ts`, update the snapshot construction:

```typescript
const snapshot: ConversationSnapshot = {
  conversation_id: result.session.conversation_id,
  state: result.session.state,
  unit_id: result.session.unit_id,
  ...(result.session.split_issues ? { issues: result.session.split_issues as any } : {}),
  pinned_versions: result.session.pinned_versions,
  created_at: result.session.created_at,
  last_activity_at: result.session.last_activity_at,
};
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator/response-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/response-builder.ts packages/core/src/__tests__/orchestrator/response-builder.test.ts
git commit -m "feat(core): include split_issues in ConversationSnapshot response"
```

---

## Task 8: Update orchestrator integration test for full splitter flow

**Files:**
- Modify: `packages/core/src/__tests__/orchestrator-integration.test.ts`

**Context:** The existing integration test expects `split_in_progress` after `SUBMIT_INITIAL_MESSAGE`. With the splitter wired in, it should now reach `split_proposed`. We also add new integration tests covering the full split confirmation flow.

**Step 1: Update existing happy-path test**

In the existing test `'walks CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE'`, update the expectation on Step 3:

```typescript
expect(r3.response.conversation_snapshot.state).toBe('split_proposed');
```

Also update the deps to include a mock splitter:

```typescript
function makeDeps() {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => new Date().toISOString(),
    issueSplitter: async (input: any) => ({
      issues: [
        { issue_id: `issue-${++counter}`, summary: 'Issue from input', raw_excerpt: input.raw_text },
      ],
      issue_count: 1,
    }),
  };
}
```

**Step 2: Add split confirmation integration test**

```typescript
describe('Orchestrator integration: split confirmation flow', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  async function reachSplitProposed() {
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'Toilet leaking and light broken' },
      auth_context: AUTH,
    });

    return convId;
  }

  it('walks split_proposed → CONFIRM_SPLIT → split_finalized', async () => {
    const convId = await reachSplitProposed();

    const r = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r.response.conversation_snapshot.state).toBe('split_finalized');
  });

  it('walks split_proposed → ADD_ISSUE → CONFIRM_SPLIT', async () => {
    const convId = await reachSplitProposed();

    const r1 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.ADD_ISSUE,
      actor: ActorType.TENANT,
      tenant_input: { summary: 'Door is stuck' },
      auth_context: AUTH,
    });
    expect(r1.response.conversation_snapshot.state).toBe('split_proposed');
    expect(r1.response.conversation_snapshot.issues!.length).toBe(2);

    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r2.response.conversation_snapshot.state).toBe('split_finalized');
  });

  it('walks split_proposed → REJECT_SPLIT → split_finalized (single issue)', async () => {
    const convId = await reachSplitProposed();

    const r = await dispatch({
      conversation_id: convId,
      action_type: ActionType.REJECT_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r.response.conversation_snapshot.state).toBe('split_finalized');
    expect(r.response.conversation_snapshot.issues!.length).toBe(1);
  });

  it('handles splitter failure gracefully', async () => {
    // Override splitter to fail
    deps.issueSplitter = async () => { throw new Error('LLM down'); };
    dispatch = createDispatcher(deps);

    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });

    const r3 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });
    expect(r3.response.conversation_snapshot.state).toBe('llm_error_retryable');
    expect(r3.response.errors.length).toBeGreaterThan(0);
  });
});
```

**Step 3: Run tests to verify all pass**

Run: `cd packages/core && pnpm vitest run src/__tests__/orchestrator-integration.test.ts`
Expected: All PASS

**Step 4: Run full test suite**

Run: `pnpm -r test`
Expected: All PASS

**Step 5: Commit**

```bash
git add packages/core/src/__tests__/orchestrator-integration.test.ts
git commit -m "test(core): add integration tests for full splitter and split confirmation flow"
```

---

## Task 9: Final verification and typecheck

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `pnpm -r test`
Expected: All PASS

**Step 2: Run TypeScript type checker**

Run: `pnpm -r typecheck`
Expected: No errors

**Step 3: Run linter**

Run: `pnpm -r lint`
Expected: No errors (or fix any that appear)

**Step 4: Verify event count in integration tests**

The event store should have the correct number of events after each flow:
- CREATE + SELECT_UNIT + SUBMIT_INITIAL_MESSAGE = 3 events
- + CONFIRM_SPLIT = 4 events
- + ADD_ISSUE + CONFIRM_SPLIT = 5 events

**Step 5: Commit any lint/type fixes**

```bash
git add -u
git commit -m "chore: fix lint and type issues from Phase 4"
```

---

## Summary of deliverables

| Component | Status | Spec reference |
|-----------|--------|---------------|
| ConversationSession.split_issues | New field | §13 |
| OrchestratorDependencies.issueSplitter | New port | §10, §3 |
| sanitizeIssueText / validateIssueConstraints | New utility | §13, §8 |
| callIssueSplitter (schema validation + retry) | New wrapper | §2.3, §3 |
| handleSubmitInitialMessage (wired to splitter) | Enhanced | §11.2, §13 |
| handleSplitAction (merge/edit/add/reject/confirm) | Enhanced | §13 |
| Response builder (issues in snapshot) | Enhanced | §10.2 |
| Integration tests (full split flow) | New | — |

## Non-negotiable checklist (spec §2)

- [x] Taxonomy is authoritative — splitter outputs validated against schema
- [x] Split first — splitter runs on SUBMIT_INITIAL_MESSAGE before any classification
- [x] Schema-lock all model outputs — IssueSplitter output validated with retry
- [x] No side effects without tenant confirmation — issues proposed, not committed
- [x] Unit/property derived from membership — unit_id checked before split
- [x] Append-only events — all actions write ConversationEvent
- [x] Emergency escalation — N/A for this phase
