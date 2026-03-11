# Phase 8: Transactional WO Creation + Idempotency + Optimistic Locking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Implement atomic Work Order creation — when the tenant confirms submission, one WO per split issue is created in a single transaction, with idempotency keys preventing duplicates and optimistic locking (`row_version`) guarding concurrent updates.

**Architecture:** The `handleConfirmSubmission` action handler (Phase 7) currently transitions to `submitted` and signals `create_work_orders` as a pending side effect. Phase 8 adds a `WorkOrderCreator` service that the dispatcher invokes after confirmation acceptance. The creator receives the confirmed session state (split issues + classification results + photos + scope) and produces `WorkOrder[]` inside a single logical transaction. An `IdempotencyStore` keyed by the request's `idempotency_key` prevents duplicate creation on retries. A `WorkOrderRepository` with INSERT-only semantics stores each WO and its initial `work_order_event`. The session gains `property_id` and `client_id` fields (derived from `unit_id` via a `UnitResolver` dependency). All WOs in a multi-issue conversation share an `issue_group_id`.

**Tech Stack:** TypeScript, Vitest, `@wo-agent/schemas` validators, `@wo-agent/core` orchestrator

**Prerequisite:** Phase 7 merged to main.

**Spec references:** §2 (non-negotiable #4 — no side effects without confirmation, #6 — append-only events), §6 (canonical WO model), §7 (append-only events, `work_order_events`), §10 (orchestrator contract, idempotency_key), §11.2 (transition matrix — `tenant_confirmation_pending` → `submitted`), §18 (idempotency keys, multi-WO transaction, optimistic locking, no group status)

**Skills that apply during execution:**

- `@test-driven-development` — every task follows red-green-refactor
- `@state-machine-implementation` — no state transition changes needed (already handled)
- `@schema-first-development` — WO creation validated against existing schema
- `@append-only-events` — work_order_events INSERT-only
- `@project-conventions` — naming, structure, commands

---

### Task 0: Add `property_id` / `client_id` to Session + UnitResolver Dependency

The `WorkOrder` type requires `property_id` and `client_id`, but `ConversationSession` only has `unit_id`. We need a `UnitResolver` to look up scope from the unit, and store it on the session once a unit is selected.

**Files:**

- Modify: `packages/core/src/session/types.ts` (add `property_id`, `client_id` fields)
- Modify: `packages/core/src/session/session.ts` (add `setSessionScope` helper)
- Create: `packages/core/src/unit-resolver/types.ts` (UnitResolver interface + UnitInfo type)
- Create: `packages/core/src/unit-resolver/index.ts` (barrel export)
- Modify: `packages/core/src/orchestrator/types.ts` (add `unitResolver` to `OrchestratorDependencies`)
- Modify: `packages/core/src/index.ts` (export new types)
- Test: `packages/core/src/__tests__/unit-resolver/session-scope.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/unit-resolver/session-scope.test.ts
import { describe, it, expect } from 'vitest';
import { createSession, setSessionScope } from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';

describe('setSessionScope', () => {
  const base = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'm',
      prompt_version: '1',
    },
  });

  it('sets property_id and client_id from UnitInfo', () => {
    const updated = setSessionScope(base, {
      property_id: 'prop-1',
      client_id: 'client-1',
    });
    expect(updated.property_id).toBe('prop-1');
    expect(updated.client_id).toBe('client-1');
  });

  it('returns a new session object (immutability)', () => {
    const updated = setSessionScope(base, {
      property_id: 'prop-1',
      client_id: 'client-1',
    });
    expect(updated).not.toBe(base);
    expect(base.property_id).toBeNull();
  });

  it('preserves all other session fields', () => {
    const updated = setSessionScope(base, {
      property_id: 'prop-2',
      client_id: 'client-2',
    });
    expect(updated.conversation_id).toBe(base.conversation_id);
    expect(updated.state).toBe(base.state);
    expect(updated.tenant_user_id).toBe(base.tenant_user_id);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/unit-resolver/session-scope.test.ts`
Expected: FAIL — `setSessionScope` and `property_id`/`client_id` don't exist yet.

**Step 3: Implement — update session types**

Add to `packages/core/src/session/types.ts` — add two fields to `ConversationSession`:

```typescript
  /** Property ID derived from unit_id via UnitResolver (spec §2.5) */
  readonly property_id: string | null;
  /** Client ID derived from unit_id via UnitResolver (spec §2.5) */
  readonly client_id: string | null;
```

**Step 4: Implement — update session.ts**

In `packages/core/src/session/session.ts`:

1. In `createSession`, initialize `property_id: null, client_id: null`.
2. Add the `setSessionScope` function:

```typescript
export interface ScopeInput {
  readonly property_id: string;
  readonly client_id: string;
}

export function setSessionScope(
  session: ConversationSession,
  scope: ScopeInput,
): ConversationSession {
  return { ...session, property_id: scope.property_id, client_id: scope.client_id };
}
```

**Step 5: Create UnitResolver types**

```typescript
// packages/core/src/unit-resolver/types.ts
export interface UnitInfo {
  readonly unit_id: string;
  readonly property_id: string;
  readonly client_id: string;
}

/**
 * Resolves property and client scope from a unit_id.
 * In production this queries the tenant/property database.
 * For testing, use a stub or in-memory map.
 */
export interface UnitResolver {
  resolve(unitId: string): Promise<UnitInfo | null>;
}
```

```typescript
// packages/core/src/unit-resolver/index.ts
export type { UnitInfo, UnitResolver } from './types.js';
```

**Step 6: Add `unitResolver` to OrchestratorDependencies**

In `packages/core/src/orchestrator/types.ts`, add to the `OrchestratorDependencies` interface:

```typescript
  readonly unitResolver: UnitResolver;
```

Import `UnitResolver` from `'../unit-resolver/types.js'`.

**Step 7: Update barrel exports in `packages/core/src/index.ts`**

Add:

```typescript
// --- Unit Resolver (Phase 8) ---
export type { UnitInfo, UnitResolver } from './unit-resolver/index.js';
```

And add `setSessionScope` and `ScopeInput` to the session exports.

**Step 8: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/unit-resolver/session-scope.test.ts`
Expected: PASS

**Step 9: Fix existing tests**

Any existing tests that construct `OrchestratorDependencies` or `ConversationSession` manually will now need `unitResolver` and `property_id`/`client_id`. Update test helpers to include the new fields with defaults (`null` for session fields, a stub resolver for deps).

Run: `cd packages/core && pnpm vitest run`
Expected: All tests PASS

**Step 10: Commit**

```bash
git add packages/core/src/session/types.ts packages/core/src/session/session.ts \
       packages/core/src/unit-resolver/ packages/core/src/orchestrator/types.ts \
       packages/core/src/index.ts packages/core/src/__tests__/unit-resolver/
git commit -m "feat(core): add property_id/client_id to session + UnitResolver dependency"
```

---

### Task 1: Wire UnitResolver into SELECT_UNIT Handler

When the tenant selects a unit, resolve `property_id`/`client_id` and store them on the session. This makes scope available downstream for WO creation.

**Files:**

- Modify: `packages/core/src/orchestrator/action-handlers/select-unit.ts`
- Test: `packages/core/src/__tests__/unit-resolver/select-unit-scope.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/unit-resolver/select-unit-scope.test.ts
import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { ActionType, ActorType, ConversationState } from '@wo-agent/schemas';
import type { OrchestratorDependencies } from '../../orchestrator/types.js';

function makeTestDeps(overrides?: Partial<OrchestratorDependencies>): OrchestratorDependencies {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-03-03T12:00:00Z',
    issueSplitter: async () => ({ issues: [], issue_count: 0 }),
    issueClassifier: async () => ({
      issue_id: '',
      classification: {},
      model_confidence: {},
      missing_fields: [],
      needs_human_triage: false,
    }),
    followUpGenerator: async () => ({ questions: [] }),
    cueDict: { version: '1', fields: {} },
    taxonomy: { version: '1', categories: {} } as any,
    unitResolver: {
      resolve: async (unitId: string) => ({
        unit_id: unitId,
        property_id: `prop-for-${unitId}`,
        client_id: `client-for-${unitId}`,
      }),
    },
    ...overrides,
  };
}

describe('SELECT_UNIT resolves scope via UnitResolver', () => {
  it('sets property_id and client_id on session after unit selection', async () => {
    const deps = makeTestDeps();
    const dispatch = createDispatcher(deps);

    // Create conversation with multiple units
    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'tu-1',
        tenant_account_id: 'ta-1',
        authorized_unit_ids: ['unit-A', 'unit-B'],
      },
    });

    // Select unit
    const selectResult = await dispatch({
      conversation_id: createResult.session.conversation_id,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-A' },
      auth_context: {
        tenant_user_id: 'tu-1',
        tenant_account_id: 'ta-1',
        authorized_unit_ids: ['unit-A', 'unit-B'],
      },
    });

    expect(selectResult.session.property_id).toBe('prop-for-unit-A');
    expect(selectResult.session.client_id).toBe('client-for-unit-A');
  });

  it('returns error if UnitResolver returns null', async () => {
    const deps = makeTestDeps({
      unitResolver: { resolve: async () => null },
    });
    const dispatch = createDispatcher(deps);

    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'tu-1',
        tenant_account_id: 'ta-1',
        authorized_unit_ids: ['unit-A', 'unit-B'],
      },
    });

    const selectResult = await dispatch({
      conversation_id: createResult.session.conversation_id,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-A' },
      auth_context: {
        tenant_user_id: 'tu-1',
        tenant_account_id: 'ta-1',
        authorized_unit_ids: ['unit-A', 'unit-B'],
      },
    });

    expect(selectResult.response.errors.length).toBeGreaterThan(0);
    expect(selectResult.response.errors[0].code).toBe('UNIT_NOT_FOUND');
  });
});
```

Note: `InMemorySessionStore` needs to be imported — check existing test helpers to use the same pattern. The test file above is a sketch; adapt the import paths and helper functions to match the existing test infrastructure.

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/unit-resolver/select-unit-scope.test.ts`
Expected: FAIL — select-unit handler doesn't call unitResolver yet.

**Step 3: Update select-unit handler**

In `packages/core/src/orchestrator/action-handlers/select-unit.ts`:

1. After validating the unit selection, call `deps.unitResolver.resolve(unitId)`.
2. If null, return error `{ code: 'UNIT_NOT_FOUND', message: 'Unit not found in property database' }`.
3. Call `setSessionScope(session, { property_id: unitInfo.property_id, client_id: unitInfo.client_id })`.

For single-unit auto-selection (where `authorized_unit_ids.length === 1`), the resolver must also be called.

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/unit-resolver/select-unit-scope.test.ts`
Expected: PASS

**Step 5: Run full suite**

Run: `cd packages/core && pnpm vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/select-unit.ts \
       packages/core/src/__tests__/unit-resolver/select-unit-scope.test.ts
git commit -m "feat(core): resolve property/client scope via UnitResolver on SELECT_UNIT"
```

---

### Task 2: WorkOrderRepository Interface + In-Memory Implementation

Create the persistence layer for work orders. Follows the same pattern as `EventRepository` / `InMemoryEventStore` but for the `work_order_events` table (spec §7). The repository stores `WorkOrder` objects with INSERT-only semantics for events, and supports idempotent lookups.

**Files:**

- Create: `packages/core/src/work-order/types.ts` (WorkOrderEvent type, WorkOrderRepository interface)
- Create: `packages/core/src/work-order/in-memory-wo-store.ts` (test implementation)
- Create: `packages/core/src/work-order/index.ts` (barrel export)
- Modify: `packages/core/src/index.ts` (export new types)
- Test: `packages/core/src/__tests__/work-order/wo-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/work-order/wo-store.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import type { WorkOrder } from '@wo-agent/schemas';

const makeWO = (overrides?: Partial<WorkOrder>): WorkOrder => ({
  work_order_id: 'wo-1',
  issue_group_id: 'ig-1',
  issue_id: 'iss-1',
  client_id: 'client-1',
  property_id: 'prop-1',
  unit_id: 'unit-1',
  tenant_user_id: 'tu-1',
  tenant_account_id: 'ta-1',
  status: 'created',
  status_history: [{ status: 'created', changed_at: '2026-03-03T12:00:00Z', actor: 'system' }],
  raw_text: 'Leaky faucet',
  summary_confirmed: 'Kitchen faucet dripping',
  photos: [],
  classification: { category: 'plumbing' },
  confidence_by_field: { category: 0.92 },
  missing_fields: [],
  pets_present: 'unknown',
  needs_human_triage: false,
  pinned_versions: {
    taxonomy_version: '1',
    schema_version: '1',
    model_id: 'm',
    prompt_version: '1',
  },
  created_at: '2026-03-03T12:00:00Z',
  updated_at: '2026-03-03T12:00:00Z',
  row_version: 1,
  ...overrides,
});

describe('InMemoryWorkOrderStore', () => {
  it('inserts and retrieves a work order by ID', async () => {
    const store = new InMemoryWorkOrderStore();
    const wo = makeWO();
    await store.insertBatch([wo]);
    const retrieved = await store.getById('wo-1');
    expect(retrieved).toEqual(wo);
  });

  it('inserts multiple WOs atomically (batch)', async () => {
    const store = new InMemoryWorkOrderStore();
    const wos = [
      makeWO({ work_order_id: 'wo-1', issue_id: 'iss-1' }),
      makeWO({ work_order_id: 'wo-2', issue_id: 'iss-2' }),
    ];
    await store.insertBatch(wos);
    expect(await store.getById('wo-1')).toBeTruthy();
    expect(await store.getById('wo-2')).toBeTruthy();
  });

  it('retrieves WOs by issue_group_id', async () => {
    const store = new InMemoryWorkOrderStore();
    const wos = [
      makeWO({ work_order_id: 'wo-1', issue_group_id: 'ig-1' }),
      makeWO({ work_order_id: 'wo-2', issue_group_id: 'ig-1' }),
      makeWO({ work_order_id: 'wo-3', issue_group_id: 'ig-2' }),
    ];
    await store.insertBatch(wos);
    const group = await store.getByIssueGroup('ig-1');
    expect(group).toHaveLength(2);
  });

  it('rejects duplicate work_order_id', async () => {
    const store = new InMemoryWorkOrderStore();
    await store.insertBatch([makeWO()]);
    await expect(store.insertBatch([makeWO()])).rejects.toThrow(/duplicate/i);
  });

  it('returns null for unknown work_order_id', async () => {
    const store = new InMemoryWorkOrderStore();
    expect(await store.getById('nope')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-store.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement types**

```typescript
// packages/core/src/work-order/types.ts
import type { WorkOrder } from '@wo-agent/schemas';

/**
 * Append-only work order event (spec §7 — work_order_events table).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface WorkOrderEvent {
  readonly event_id: string;
  readonly work_order_id: string;
  readonly event_type: 'work_order_created' | 'status_changed';
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

/**
 * Work order persistence. Multi-WO batch insert is one logical transaction (spec §18).
 * Production: PostgreSQL with INSERT-only event table + optimistic locking on WO row.
 * Testing: in-memory.
 */
export interface WorkOrderRepository {
  /** Insert one or more WOs atomically. Rejects on duplicate work_order_id. */
  insertBatch(workOrders: readonly WorkOrder[]): Promise<void>;
  /** Get a single WO by ID. Returns null if not found. */
  getById(workOrderId: string): Promise<WorkOrder | null>;
  /** Get all WOs sharing an issue_group_id. No aggregate status (spec §18). */
  getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]>;
}
```

**Step 4: Implement in-memory store**

```typescript
// packages/core/src/work-order/in-memory-wo-store.ts
import type { WorkOrder } from '@wo-agent/schemas';
import type { WorkOrderRepository } from './types.js';

/**
 * In-memory WO store for testing (spec §18 — multi-WO atomic insert).
 * Production would use PostgreSQL with BEGIN/COMMIT.
 */
export class InMemoryWorkOrderStore implements WorkOrderRepository {
  private readonly store = new Map<string, WorkOrder>();

  async insertBatch(workOrders: readonly WorkOrder[]): Promise<void> {
    // Check for duplicates before inserting any (atomicity)
    for (const wo of workOrders) {
      if (this.store.has(wo.work_order_id)) {
        throw new Error(`Duplicate work_order_id: ${wo.work_order_id}`);
      }
    }
    for (const wo of workOrders) {
      this.store.set(wo.work_order_id, wo);
    }
  }

  async getById(workOrderId: string): Promise<WorkOrder | null> {
    return this.store.get(workOrderId) ?? null;
  }

  async getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]> {
    return [...this.store.values()].filter((wo) => wo.issue_group_id === issueGroupId);
  }
}
```

**Step 5: Create barrel export**

```typescript
// packages/core/src/work-order/index.ts
export type { WorkOrderEvent, WorkOrderRepository } from './types.js';
export { InMemoryWorkOrderStore } from './in-memory-wo-store.js';
```

**Step 6: Update `packages/core/src/index.ts`**

Add:

```typescript
// --- Work Order (Phase 8) ---
export { InMemoryWorkOrderStore } from './work-order/index.js';
export type { WorkOrderEvent, WorkOrderRepository } from './work-order/index.js';
```

**Step 7: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-store.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/core/src/work-order/ packages/core/src/__tests__/work-order/wo-store.test.ts \
       packages/core/src/index.ts
git commit -m "feat(core): WorkOrderRepository interface + in-memory implementation"
```

---

### Task 3: IdempotencyStore Interface + In-Memory Implementation

Idempotency keys prevent duplicate WO creation on retries (spec §18). The store maps `idempotency_key` → previously returned result. If a key exists, the original result is returned instead of re-executing.

**Files:**

- Create: `packages/core/src/idempotency/types.ts`
- Create: `packages/core/src/idempotency/in-memory-idempotency-store.ts`
- Create: `packages/core/src/idempotency/index.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/__tests__/idempotency/idempotency-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/idempotency/idempotency-store.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

describe('InMemoryIdempotencyStore', () => {
  it('returns null for unseen key', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get('key-1')).toBeNull();
  });

  it('stores and retrieves a result by key', async () => {
    const store = new InMemoryIdempotencyStore();
    const result = { work_order_ids: ['wo-1'] };
    await store.set('key-1', result);
    expect(await store.get('key-1')).toEqual(result);
  });

  it('does not overwrite an existing key (set is idempotent)', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('key-1', { work_order_ids: ['wo-1'] });
    await store.set('key-1', { work_order_ids: ['wo-2'] }); // should NOT overwrite
    const stored = await store.get('key-1');
    expect(stored).toEqual({ work_order_ids: ['wo-1'] });
  });

  it('stores different keys independently', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('key-1', { work_order_ids: ['wo-1'] });
    await store.set('key-2', { work_order_ids: ['wo-2'] });
    expect(await store.get('key-1')).toEqual({ work_order_ids: ['wo-1'] });
    expect(await store.get('key-2')).toEqual({ work_order_ids: ['wo-2'] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/idempotency/idempotency-store.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement types**

```typescript
// packages/core/src/idempotency/types.ts

/**
 * Stored result for an idempotency key.
 * When a CONFIRM_SUBMISSION with the same key is retried,
 * return this instead of creating duplicate WOs (spec §18).
 */
export interface IdempotencyRecord {
  readonly work_order_ids: readonly string[];
}

/**
 * Idempotency store. Production: PostgreSQL row with TTL.
 * Testing: in-memory Map.
 */
export interface IdempotencyStore {
  /** Get existing result for key. Returns null if unseen. */
  get(key: string): Promise<IdempotencyRecord | null>;
  /** Store result. No-op if key already exists (first-write-wins). */
  set(key: string, record: IdempotencyRecord): Promise<void>;
}
```

**Step 4: Implement in-memory store**

```typescript
// packages/core/src/idempotency/in-memory-idempotency-store.ts
import type { IdempotencyStore, IdempotencyRecord } from './types.js';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    if (!this.store.has(key)) {
      this.store.set(key, record);
    }
  }
}
```

**Step 5: Create barrel export**

```typescript
// packages/core/src/idempotency/index.ts
export type { IdempotencyRecord, IdempotencyStore } from './types.js';
export { InMemoryIdempotencyStore } from './in-memory-idempotency-store.js';
```

**Step 6: Update `packages/core/src/index.ts`**

Add:

```typescript
// --- Idempotency (Phase 8) ---
export { InMemoryIdempotencyStore } from './idempotency/index.js';
export type { IdempotencyRecord, IdempotencyStore } from './idempotency/index.js';
```

**Step 7: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/idempotency/idempotency-store.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/core/src/idempotency/ packages/core/src/__tests__/idempotency/ \
       packages/core/src/index.ts
git commit -m "feat(core): IdempotencyStore interface + in-memory implementation"
```

---

### Task 4: WorkOrderCreator — Pure Factory Function

The core business logic: given a confirmed session, produce `WorkOrder[]`. This is a **pure function** (no I/O) — it takes session data and returns work order objects. The dispatcher calls this, then persists them via the repository.

**Files:**

- Create: `packages/core/src/work-order/wo-creator.ts`
- Modify: `packages/core/src/work-order/index.ts` (export)
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/__tests__/work-order/wo-creator.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/work-order/wo-creator.test.ts
import { describe, it, expect } from 'vitest';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import type { ConversationSession } from '../../session/types.js';
import type { WorkOrder } from '@wo-agent/schemas';
import {
  createSession,
  setSessionUnit,
  setSplitIssues,
  setClassificationResults,
  setSessionScope,
} from '../../session/session.js';

const baseSession = (): ConversationSession => {
  let s = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1.0',
      schema_version: '1.0',
      model_id: 'gpt-test',
      prompt_version: '1.0',
    },
  });
  s = setSessionUnit(s, 'unit-1');
  s = setSessionScope(s, { property_id: 'prop-1', client_id: 'client-1' });
  s = setSplitIssues(s, [
    { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My kitchen faucet is leaking' },
    { issue_id: 'iss-2', summary: 'Broken window', raw_excerpt: 'Window in bedroom cracked' },
  ]);
  s = setClassificationResults(s, [
    {
      issue_id: 'iss-1',
      classifierOutput: {
        issue_id: 'iss-1',
        classification: { category: 'plumbing', subcategory: 'faucet' },
        model_confidence: { category: 0.9, subcategory: 0.8 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { category: 0.92, subcategory: 0.85 },
      fieldsNeedingInput: [],
    },
    {
      issue_id: 'iss-2',
      classifierOutput: {
        issue_id: 'iss-2',
        classification: { category: 'structural', subcategory: 'window' },
        model_confidence: { category: 0.85, subcategory: 0.7 },
        missing_fields: ['severity'],
        needs_human_triage: false,
      },
      computedConfidence: { category: 0.88, subcategory: 0.75 },
      fieldsNeedingInput: [],
    },
  ]);
  return s;
};

describe('createWorkOrders', () => {
  let idCounter = 0;
  const idGen = () => `gen-${++idCounter}`;
  const clock = () => '2026-03-03T14:00:00Z';

  beforeEach(() => {
    idCounter = 0;
  });

  it('creates one WO per split issue', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    expect(wos).toHaveLength(2);
  });

  it('all WOs share the same issue_group_id', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const groupId = wos[0].issue_group_id;
    expect(groupId).toBeTruthy();
    expect(wos.every((wo) => wo.issue_group_id === groupId)).toBe(true);
  });

  it('each WO has a unique work_order_id', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const ids = new Set(wos.map((wo) => wo.work_order_id));
    expect(ids.size).toBe(2);
  });

  it('maps issue_id correctly', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    expect(wos.map((wo) => wo.issue_id).sort()).toEqual(['iss-1', 'iss-2']);
  });

  it('populates scope fields from session', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.client_id).toBe('client-1');
      expect(wo.property_id).toBe('prop-1');
      expect(wo.unit_id).toBe('unit-1');
      expect(wo.tenant_user_id).toBe('tu-1');
      expect(wo.tenant_account_id).toBe('ta-1');
    }
  });

  it('sets initial status to "created" with history entry', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.status).toBe('created');
      expect(wo.status_history).toHaveLength(1);
      expect(wo.status_history[0]).toEqual({
        status: 'created',
        changed_at: '2026-03-03T14:00:00Z',
        actor: 'system',
      });
    }
  });

  it('maps classification and confidence from results', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const wo1 = wos.find((wo) => wo.issue_id === 'iss-1')!;
    expect(wo1.classification).toEqual({ category: 'plumbing', subcategory: 'faucet' });
    expect(wo1.confidence_by_field).toEqual({ category: 0.92, subcategory: 0.85 });
  });

  it('uses raw_excerpt as raw_text and summary as summary_confirmed', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const wo1 = wos.find((wo) => wo.issue_id === 'iss-1')!;
    expect(wo1.raw_text).toBe('My kitchen faucet is leaking');
    expect(wo1.summary_confirmed).toBe('Leaky faucet');
  });

  it('attaches draft_photo_ids as photo references', () => {
    let session = baseSession();
    session = { ...session, draft_photo_ids: ['photo-1', 'photo-2'] };
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    // Photos attach to all WOs (they're conversation-level, not issue-level)
    for (const wo of wos) {
      expect(wo.photos).toHaveLength(2);
    }
  });

  it('sets row_version to 1', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.row_version).toBe(1);
    }
  });

  it('copies pinned_versions from session', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.pinned_versions).toEqual(session.pinned_versions);
    }
  });

  it('marks needs_human_triage from classification result', () => {
    let session = baseSession();
    session = setClassificationResults(session, [
      {
        issue_id: 'iss-1',
        classifierOutput: {
          issue_id: 'iss-1',
          classification: { category: 'plumbing' },
          model_confidence: { category: 0.4 },
          missing_fields: ['subcategory'],
          needs_human_triage: true,
        },
        computedConfidence: { category: 0.45 },
        fieldsNeedingInput: [],
      },
    ]);
    session = setSplitIssues(session, [
      { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet leaks' },
    ]);
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    expect(wos[0].needs_human_triage).toBe(true);
    expect(wos[0].missing_fields).toEqual(['subcategory']);
  });

  it('defaults pets_present to "unknown"', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.pets_present).toBe('unknown');
    }
  });

  it('throws if session has no unit_id', () => {
    let session = baseSession();
    session = { ...session, unit_id: null };
    expect(() => createWorkOrders({ session, idGenerator: idGen, clock })).toThrow(/unit_id/);
  });

  it('throws if session has no property_id or client_id', () => {
    let session = baseSession();
    session = { ...session, property_id: null };
    expect(() => createWorkOrders({ session, idGenerator: idGen, clock })).toThrow(/property_id/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-creator.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement the factory**

```typescript
// packages/core/src/work-order/wo-creator.ts
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import type { ConversationSession, IssueClassificationResult } from '../session/types.js';

export interface CreateWorkOrdersInput {
  readonly session: ConversationSession;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

/**
 * Pure factory: given a confirmed session, produce one WorkOrder per split issue.
 * All WOs share an issue_group_id (spec §1.4, §18 — linkage only, no aggregate status).
 * Throws if required scope fields are missing.
 */
export function createWorkOrders(input: CreateWorkOrdersInput): WorkOrder[] {
  const { session, idGenerator, clock } = input;

  if (!session.unit_id) {
    throw new Error('Cannot create WOs: session has no unit_id');
  }
  if (!session.property_id) {
    throw new Error('Cannot create WOs: session has no property_id');
  }
  if (!session.client_id) {
    throw new Error('Cannot create WOs: session has no client_id');
  }
  if (!session.split_issues || session.split_issues.length === 0) {
    throw new Error('Cannot create WOs: session has no split_issues');
  }
  if (!session.classification_results || session.classification_results.length === 0) {
    throw new Error('Cannot create WOs: session has no classification_results');
  }

  const now = clock();
  const issueGroupId = idGenerator();
  const resultMap = new Map<string, IssueClassificationResult>(
    session.classification_results.map((r) => [r.issue_id, r]),
  );

  // Build photo references from draft_photo_ids.
  // At this point photos are conversation-level; they attach to all WOs.
  // Storage key and sha256 are placeholders — the photo-upload handler
  // stores the real values. We reference by ID for now; Phase 9+ can
  // enrich from a photo store.
  const photos = session.draft_photo_ids.map((photoId) => ({
    photo_id: photoId,
    storage_key: '', // resolved later from photo store
    sha256: '',
    scanned_status: 'pending' as const,
  }));

  return session.split_issues.map((issue) => {
    const classResult = resultMap.get(issue.issue_id);

    const wo: WorkOrder = {
      work_order_id: idGenerator(),
      issue_group_id: issueGroupId,
      issue_id: issue.issue_id,
      client_id: session.client_id!,
      property_id: session.property_id!,
      unit_id: session.unit_id!,
      tenant_user_id: session.tenant_user_id,
      tenant_account_id: session.tenant_account_id,
      status: WorkOrderStatus.CREATED,
      status_history: [
        {
          status: WorkOrderStatus.CREATED,
          changed_at: now,
          actor: ActorType.SYSTEM,
        },
      ],
      raw_text: issue.raw_excerpt,
      summary_confirmed: issue.summary,
      photos,
      classification: classResult ? { ...classResult.classifierOutput.classification } : {},
      confidence_by_field: classResult ? { ...classResult.computedConfidence } : {},
      missing_fields: classResult ? [...classResult.classifierOutput.missing_fields] : [],
      pets_present: 'unknown',
      needs_human_triage: classResult?.classifierOutput.needs_human_triage ?? true,
      pinned_versions: { ...session.pinned_versions },
      created_at: now,
      updated_at: now,
      row_version: 1,
    };

    return wo;
  });
}
```

**Step 4: Update barrel exports**

In `packages/core/src/work-order/index.ts`, add:

```typescript
export { createWorkOrders } from './wo-creator.js';
export type { CreateWorkOrdersInput } from './wo-creator.js';
```

In `packages/core/src/index.ts`, add `createWorkOrders` and `CreateWorkOrdersInput` to the Work Order exports.

**Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-creator.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/work-order/wo-creator.ts \
       packages/core/src/work-order/index.ts \
       packages/core/src/index.ts \
       packages/core/src/__tests__/work-order/wo-creator.test.ts
git commit -m "feat(core): WorkOrderCreator pure factory — one WO per split issue"
```

---

### Task 5: Work Order Event Builder

Append-only events for `work_order_events` (spec §7). One `work_order_created` event per WO.

**Files:**

- Create: `packages/core/src/work-order/event-builder.ts`
- Modify: `packages/core/src/work-order/index.ts` (export)
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/__tests__/work-order/wo-event-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/work-order/wo-event-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildWorkOrderCreatedEvent } from '../../work-order/event-builder.js';
import type { WorkOrder } from '@wo-agent/schemas';

const makeWO = (): WorkOrder => ({
  work_order_id: 'wo-1',
  issue_group_id: 'ig-1',
  issue_id: 'iss-1',
  client_id: 'c-1',
  property_id: 'p-1',
  unit_id: 'u-1',
  tenant_user_id: 'tu-1',
  tenant_account_id: 'ta-1',
  status: 'created',
  status_history: [{ status: 'created', changed_at: '2026-03-03T12:00:00Z', actor: 'system' }],
  raw_text: 'test',
  summary_confirmed: 'test summary',
  photos: [],
  classification: { category: 'plumbing' },
  confidence_by_field: { category: 0.9 },
  missing_fields: [],
  pets_present: 'unknown',
  needs_human_triage: false,
  pinned_versions: {
    taxonomy_version: '1',
    schema_version: '1',
    model_id: 'm',
    prompt_version: '1',
  },
  created_at: '2026-03-03T12:00:00Z',
  updated_at: '2026-03-03T12:00:00Z',
  row_version: 1,
});

describe('buildWorkOrderCreatedEvent', () => {
  it('builds a work_order_created event', () => {
    const wo = makeWO();
    const event = buildWorkOrderCreatedEvent({
      eventId: 'ev-1',
      workOrder: wo,
      conversationId: 'conv-1',
      createdAt: '2026-03-03T14:00:00Z',
    });

    expect(event.event_id).toBe('ev-1');
    expect(event.work_order_id).toBe('wo-1');
    expect(event.event_type).toBe('work_order_created');
    expect(event.payload.issue_group_id).toBe('ig-1');
    expect(event.payload.conversation_id).toBe('conv-1');
    expect(event.payload.classification).toEqual({ category: 'plumbing' });
    expect(event.created_at).toBe('2026-03-03T14:00:00Z');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-event-builder.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// packages/core/src/work-order/event-builder.ts
import type { WorkOrder } from '@wo-agent/schemas';
import type { WorkOrderEvent } from './types.js';

export interface WOCreatedEventInput {
  readonly eventId: string;
  readonly workOrder: WorkOrder;
  readonly conversationId: string;
  readonly createdAt: string;
}

/**
 * Build an append-only work_order_created event (spec §7 — INSERT only).
 */
export function buildWorkOrderCreatedEvent(input: WOCreatedEventInput): WorkOrderEvent {
  const { eventId, workOrder, conversationId, createdAt } = input;
  return {
    event_id: eventId,
    work_order_id: workOrder.work_order_id,
    event_type: 'work_order_created',
    payload: {
      conversation_id: conversationId,
      issue_group_id: workOrder.issue_group_id,
      issue_id: workOrder.issue_id,
      classification: workOrder.classification,
      confidence_by_field: workOrder.confidence_by_field,
      needs_human_triage: workOrder.needs_human_triage,
      pinned_versions: workOrder.pinned_versions,
    },
    created_at: createdAt,
  };
}
```

**Step 4: Update exports**

In `packages/core/src/work-order/index.ts`:

```typescript
export { buildWorkOrderCreatedEvent } from './event-builder.js';
export type { WOCreatedEventInput } from './event-builder.js';
```

In `packages/core/src/index.ts`, add to Work Order exports.

**Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-event-builder.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/work-order/event-builder.ts \
       packages/core/src/work-order/index.ts \
       packages/core/src/index.ts \
       packages/core/src/__tests__/work-order/wo-event-builder.test.ts
git commit -m "feat(core): work_order_created event builder (append-only)"
```

---

### Task 6: Add `workOrderRepo` + `idempotencyStore` to OrchestratorDependencies

Wire the new stores into the orchestrator dependency injection.

**Files:**

- Modify: `packages/core/src/orchestrator/types.ts`
- Test: (existing tests — need updating for new deps)

**Step 1: Update `OrchestratorDependencies`**

In `packages/core/src/orchestrator/types.ts`, add:

```typescript
import type { WorkOrderRepository } from '../work-order/types.js';
import type { IdempotencyStore } from '../idempotency/types.js';
```

Add to the interface:

```typescript
  readonly workOrderRepo: WorkOrderRepository;
  readonly idempotencyStore: IdempotencyStore;
```

**Step 2: Update all test helpers that construct `OrchestratorDependencies`**

Search for all files that create a deps object and add the two new stores with in-memory implementations. Key files to update:

- `packages/core/src/__tests__/orchestrator-integration.test.ts`
- `packages/core/src/__tests__/integration.test.ts`
- `packages/core/src/__tests__/confirmation/confirm-submission.test.ts`
- `packages/core/src/__tests__/confirmation/confirmation-integration.test.ts`
- Any other test creating `OrchestratorDependencies`

Pattern:

```typescript
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';

// In makeDeps():
workOrderRepo: new InMemoryWorkOrderStore(),
idempotencyStore: new InMemoryIdempotencyStore(),
```

**Step 3: Run full suite**

Run: `cd packages/core && pnpm vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/core/src/orchestrator/types.ts packages/core/src/__tests__/
git commit -m "feat(core): add workOrderRepo + idempotencyStore to OrchestratorDependencies"
```

---

### Task 7: Wire WO Creation into `handleConfirmSubmission`

The main integration: when confirmation is accepted (fresh, not stale), create WOs, persist them, record events, and mark the side effect as completed. Respects idempotency keys.

**Files:**

- Modify: `packages/core/src/orchestrator/action-handlers/confirm-submission.ts`
- Test: `packages/core/src/__tests__/work-order/wo-creation-integration.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/work-order/wo-creation-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { ActionType, ActorType, ConversationState } from '@wo-agent/schemas';
import type { OrchestratorDependencies } from '../../orchestrator/types.js';

// Helper: build a session all the way to tenant_confirmation_pending
// Uses the full dispatcher flow: CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE → CONFIRM_SPLIT → (auto-classify) → CONFIRM_SUBMISSION

let counter: number;
let clockTime: string;
let woStore: InMemoryWorkOrderStore;
let idempStore: InMemoryIdempotencyStore;
let eventStore: InMemoryEventStore;

function makeDeps(): OrchestratorDependencies {
  eventStore = new InMemoryEventStore();
  woStore = new InMemoryWorkOrderStore();
  idempStore = new InMemoryIdempotencyStore();
  counter = 0;
  clockTime = '2026-03-03T12:00:00Z';

  return {
    eventRepo: eventStore,
    sessionStore: /* use existing InMemorySessionStore pattern */,
    workOrderRepo: woStore,
    idempotencyStore: idempStore,
    idGenerator: () => `id-${++counter}`,
    clock: () => clockTime,
    issueSplitter: async () => ({
      issues: [
        { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet leaks' },
        { issue_id: 'iss-2', summary: 'Broken window', raw_excerpt: 'Window cracked' },
      ],
      issue_count: 2,
    }),
    issueClassifier: async (input) => ({
      issue_id: input.issue_id,
      classification: { category: 'plumbing' },
      model_confidence: { category: 0.95 },
      missing_fields: [],
      needs_human_triage: false,
    }),
    followUpGenerator: async () => ({ questions: [] }),
    cueDict: { version: '1', fields: {} },
    taxonomy: /* load taxonomy */ ,
    unitResolver: {
      resolve: async (unitId) => ({
        unit_id: unitId,
        property_id: 'prop-1',
        client_id: 'client-1',
      }),
    },
  };
}

describe('WO creation on CONFIRM_SUBMISSION', () => {
  it('creates one WO per split issue in the work order store', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    // Drive session to tenant_confirmation_pending
    // (adapt from existing confirmation-integration.test.ts pattern)
    const convResult = await dispatch({ /* CREATE_CONVERSATION */ });
    // ... SELECT_UNIT, SUBMIT_INITIAL_MESSAGE, CONFIRM_SPLIT flow ...

    // Confirm submission
    const result = await dispatch({
      conversation_id: convResult.session.conversation_id,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idemp-1',
      auth_context: { /* ... */ },
    });

    expect(result.session.state).toBe(ConversationState.SUBMITTED);

    // Verify WOs created
    const wos = await woStore.getByIssueGroup(/* the generated issue_group_id */);
    expect(wos).toHaveLength(2);
    expect(wos[0].status).toBe('created');
    expect(wos[0].property_id).toBe('prop-1');
    expect(wos[0].client_id).toBe('client-1');
  });

  it('returns work_order_ids in side effects', async () => {
    // ... setup ...
    const result = await dispatch({ /* CONFIRM_SUBMISSION */ });
    const sideEffects = result.response.pending_side_effects;
    const woEffect = sideEffects.find(se => se.effect_type === 'create_work_orders');
    expect(woEffect?.status).toBe('completed');
  });

  it('idempotency: duplicate submission returns same WOs without creating new ones', async () => {
    // ... setup, drive to confirmation ...

    // First submission
    const result1 = await dispatch({
      /* CONFIRM_SUBMISSION with idempotency_key: 'idemp-1' */
    });

    // Second submission with same key (simulating retry)
    // Need to reset session state to tenant_confirmation_pending for retry
    // OR test at handler level directly
    const storedRecord = await idempStore.get('idemp-1');
    expect(storedRecord).not.toBeNull();
    expect(storedRecord!.work_order_ids).toHaveLength(2);
  });

  it('all WOs share the same issue_group_id', async () => {
    // ... setup ...
    const result = await dispatch({ /* CONFIRM_SUBMISSION */ });
    const allWOs = /* get all from store */;
    const groupIds = new Set(allWOs.map(wo => wo.issue_group_id));
    expect(groupIds.size).toBe(1);
  });

  it('WOs have row_version = 1', async () => {
    // ... setup ...
    const result = await dispatch({ /* CONFIRM_SUBMISSION */ });
    const wos = await woStore.getByIssueGroup(/* ... */);
    for (const wo of wos) {
      expect(wo.row_version).toBe(1);
    }
  });
});
```

Note: The above is a test sketch. The implementing agent should adapt the full dispatcher flow from the existing `confirmation-integration.test.ts` pattern — drive the session through CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE → CONFIRM_SPLIT → (auto-classify+classify) → CONFIRM_SUBMISSION.

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-creation-integration.test.ts`
Expected: FAIL — confirm-submission handler doesn't create WOs yet.

**Step 3: Update `handleConfirmSubmission`**

Modify `packages/core/src/orchestrator/action-handlers/confirm-submission.ts`:

1. **Idempotency check first**: Before any work, check `deps.idempotencyStore.get(request.idempotency_key)`. If found, return the cached result (transition to `submitted`, return the stored WO IDs in side effects).

2. **After staleness check passes (fresh path)**: Instead of just signaling a pending side effect, actually create WOs:

```typescript
// After confirmation event is written and staleness passes:

// Create work orders
const workOrders = createWorkOrders({
  session,
  idGenerator: deps.idGenerator,
  clock: deps.clock,
});

// Persist atomically
await deps.workOrderRepo.insertBatch(workOrders);

// Write work_order_created events
for (const wo of workOrders) {
  const woEvent = buildWorkOrderCreatedEvent({
    eventId: deps.idGenerator(),
    workOrder: wo,
    conversationId: session.conversation_id,
    createdAt: deps.clock(),
  });
  await deps.eventRepo.insert(woEvent);
}

// Store idempotency record
const woIds = workOrders.map((wo) => wo.work_order_id);
if (ctx.request.idempotency_key) {
  await deps.idempotencyStore.set(ctx.request.idempotency_key, {
    work_order_ids: woIds,
  });
}

// Return with completed side effect (not pending)
return {
  newState: ConversationState.SUBMITTED,
  session,
  uiMessages: [{ role: 'agent', content: "Your request has been submitted. We'll be in touch." }],
  sideEffects: [
    {
      effect_type: 'create_work_orders',
      status: 'completed',
      idempotency_key: ctx.request.idempotency_key,
    },
  ],
  eventPayload: {
    confirmed: true,
    confirmation_payload: confirmationPayload,
    work_order_ids: woIds,
  },
  eventType: 'confirmation_accepted',
};
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/wo-creation-integration.test.ts`
Expected: PASS

**Step 5: Run full suite**

Run: `cd packages/core && pnpm vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/confirm-submission.ts \
       packages/core/src/__tests__/work-order/wo-creation-integration.test.ts
git commit -m "feat(core): wire WO creation into CONFIRM_SUBMISSION with idempotency"
```

---

### Task 8: Idempotent Retry Test — Full Handler-Level Scenario

Explicitly test that when `CONFIRM_SUBMISSION` is called twice with the same `idempotency_key`, the second call returns the same WO IDs without creating duplicates. This is tested at the handler level (not through the dispatcher) to avoid state transition issues on retry.

**Files:**

- Test: `packages/core/src/__tests__/work-order/idempotent-retry.test.ts`

**Step 1: Write the test**

```typescript
// packages/core/src/__tests__/work-order/idempotent-retry.test.ts
import { describe, it, expect } from 'vitest';
import { handleConfirmSubmission } from '../../orchestrator/action-handlers/confirm-submission.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import {
  createSession,
  setSessionUnit,
  setSplitIssues,
  setClassificationResults,
  setSessionScope,
} from '../../session/session.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';

function makeCtxWithIdempKey(idempotencyKey: string): ActionHandlerContext {
  let s = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'm',
      prompt_version: '1',
    },
  });
  s = { ...s, state: ConversationState.TENANT_CONFIRMATION_PENDING };
  s = setSessionUnit(s, 'unit-1');
  s = setSessionScope(s, { property_id: 'prop-1', client_id: 'client-1' });
  s = setSplitIssues(s, [
    { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'Faucet leaks' },
  ]);
  s = setClassificationResults(s, [
    {
      issue_id: 'iss-1',
      classifierOutput: {
        issue_id: 'iss-1',
        classification: { category: 'plumbing' },
        model_confidence: { category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { category: 0.92 },
      fieldsNeedingInput: [],
    },
  ]);

  let counter = 0;
  return {
    session: s,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: idempotencyKey,
      auth_context: {
        tenant_user_id: 'tu-1',
        tenant_account_id: 'ta-1',
        authorized_unit_ids: ['unit-1'],
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => s, getByTenantUser: async () => [], save: async () => {} },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T14:00:00Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({
        issue_id: '',
        classification: {},
        model_confidence: {},
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: { version: '1', fields: {} },
      taxonomy: {} as any,
      unitResolver: { resolve: async () => null },
    },
  };
}

describe('idempotent CONFIRM_SUBMISSION retry', () => {
  it('second call with same key returns same WO IDs without creating new WOs', async () => {
    const ctx = makeCtxWithIdempKey('retry-key-1');
    const woStore = ctx.deps.workOrderRepo as InMemoryWorkOrderStore;

    // First call — creates WOs
    const result1 = await handleConfirmSubmission(ctx);
    expect(result1.newState).toBe(ConversationState.SUBMITTED);
    const woIds1 = result1.sideEffects?.find((se) => se.effect_type === 'create_work_orders');
    expect(woIds1?.status).toBe('completed');

    // Second call with same idempotency key
    const result2 = await handleConfirmSubmission(ctx);
    expect(result2.newState).toBe(ConversationState.SUBMITTED);

    // Should NOT have doubled the WOs in the store
    // (getByIssueGroup returns all WOs — there should be exactly 1, not 2)
  });
});
```

**Step 2: Run test**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/idempotent-retry.test.ts`
Expected: PASS (if Task 7 implementation is correct)

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/work-order/idempotent-retry.test.ts
git commit -m "test(core): idempotent CONFIRM_SUBMISSION retry scenario"
```

---

### Task 9: Response Builder — Include WO IDs in Snapshot

When the state transitions to `submitted`, the `ConversationSnapshot` should include the created `work_order_ids` so the client can navigate to the WO detail pages.

**Files:**

- Modify: `packages/schemas/src/types/orchestrator-action.ts` (add `work_order_ids` to `ConversationSnapshot`)
- Modify: `packages/core/src/orchestrator/response-builder.ts` (populate from handler result)
- Test: `packages/core/src/__tests__/work-order/response-wo-ids.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/work-order/response-wo-ids.test.ts
import { describe, it, expect } from 'vitest';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { ConversationState } from '@wo-agent/schemas';
import { createSession } from '../../session/session.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';

describe('buildResponse includes work_order_ids for submitted state', () => {
  it('includes work_order_ids in snapshot when transitioning to submitted', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      authorized_unit_ids: ['u-1'],
      pinned_versions: {
        taxonomy_version: '1',
        schema_version: '1',
        model_id: 'm',
        prompt_version: '1',
      },
    });

    const result: ActionHandlerResult = {
      newState: ConversationState.SUBMITTED,
      session: { ...session, state: ConversationState.SUBMITTED },
      uiMessages: [{ role: 'agent', content: 'Submitted' }],
      sideEffects: [{ effect_type: 'create_work_orders', status: 'completed' }],
      eventPayload: { work_order_ids: ['wo-1', 'wo-2'] },
    };

    const response = buildResponse(result);
    expect(response.conversation_snapshot.work_order_ids).toEqual(['wo-1', 'wo-2']);
  });

  it('does not include work_order_ids for non-submitted states', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      authorized_unit_ids: ['u-1'],
      pinned_versions: {
        taxonomy_version: '1',
        schema_version: '1',
        model_id: 'm',
        prompt_version: '1',
      },
    });

    const result: ActionHandlerResult = {
      newState: ConversationState.SPLIT_PROPOSED,
      session: { ...session, state: ConversationState.SPLIT_PROPOSED },
      uiMessages: [],
    };

    const response = buildResponse(result);
    expect(response.conversation_snapshot.work_order_ids).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/response-wo-ids.test.ts`
Expected: FAIL — `work_order_ids` not on snapshot type.

**Step 3: Update ConversationSnapshot type**

In `packages/schemas/src/types/orchestrator-action.ts`, add to `ConversationSnapshot`:

```typescript
  readonly work_order_ids?: readonly string[];
```

**Step 4: Update response builder**

In `packages/core/src/orchestrator/response-builder.ts`, when building the snapshot, add:

```typescript
  ...(result.newState === ConversationState.SUBMITTED && result.eventPayload?.work_order_ids
    ? { work_order_ids: result.eventPayload.work_order_ids as string[] }
    : {}),
```

**Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/response-wo-ids.test.ts`
Expected: PASS

**Step 6: Run full suite**

Run: `cd packages/core && pnpm vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add packages/schemas/src/types/orchestrator-action.ts \
       packages/core/src/orchestrator/response-builder.ts \
       packages/core/src/__tests__/work-order/response-wo-ids.test.ts
git commit -m "feat(core): include work_order_ids in ConversationSnapshot for submitted state"
```

---

### Task 10: Full End-to-End Integration Test

A single test that drives the entire happy path: CREATE_CONVERSATION → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE → CONFIRM_SPLIT → (auto-classify) → CONFIRM_SUBMISSION, then verifies the WOs were created, events were written, and the response is correct.

**Files:**

- Test: `packages/core/src/__tests__/work-order/e2e-wo-creation.test.ts`

**Step 1: Write the test**

Follow the pattern from `packages/core/src/__tests__/confirmation/confirmation-integration.test.ts` but extend it to verify WO creation:

```typescript
// packages/core/src/__tests__/work-order/e2e-wo-creation.test.ts
import { describe, it, expect } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { ActionType, ActorType, ConversationState } from '@wo-agent/schemas';

describe('E2E: WO creation flow', () => {
  it('full journey: creates WOs on CONFIRM_SUBMISSION', async () => {
    // Setup deps (use pattern from confirmation-integration.test.ts)
    const woStore = new InMemoryWorkOrderStore();
    const idempStore = new InMemoryIdempotencyStore();
    const deps = makeDeps({ workOrderRepo: woStore, idempotencyStore: idempStore });
    const dispatch = createDispatcher(deps);

    // 1. CREATE_CONVERSATION
    const createRes = await dispatch({
      /* ... */
    });
    const convId = createRes.session.conversation_id;

    // 2. SELECT_UNIT (if multi-unit)
    // ... or auto-selected

    // 3. SUBMIT_INITIAL_MESSAGE
    const msgRes = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My faucet is leaking and my window is cracked' },
      auth_context: {
        /* ... */
      },
    });

    // 4. CONFIRM_SPLIT (auto-fire → classification → confirmation)
    const splitRes = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        /* ... */
      },
    });

    // Should be at tenant_confirmation_pending after classification
    expect(splitRes.session.state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);

    // 5. CONFIRM_SUBMISSION
    const confirmRes = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'e2e-key-1',
      auth_context: {
        /* ... */
      },
    });

    // Assertions
    expect(confirmRes.session.state).toBe(ConversationState.SUBMITTED);

    // WOs created
    const snapshot = confirmRes.response.conversation_snapshot;
    expect(snapshot.work_order_ids).toBeDefined();
    expect(snapshot.work_order_ids!.length).toBe(2);

    // Verify WO details
    for (const woId of snapshot.work_order_ids!) {
      const wo = await woStore.getById(woId);
      expect(wo).not.toBeNull();
      expect(wo!.status).toBe('created');
      expect(wo!.row_version).toBe(1);
      expect(wo!.property_id).toBe('prop-1');
      expect(wo!.client_id).toBe('client-1');
      expect(wo!.tenant_user_id).toBe(confirmRes.session.tenant_user_id);
    }

    // All WOs share issue_group_id
    const allWOs = await Promise.all(snapshot.work_order_ids!.map((id) => woStore.getById(id)));
    const groupIds = new Set(allWOs.map((wo) => wo!.issue_group_id));
    expect(groupIds.size).toBe(1);

    // Side effects show completed
    const woEffect = confirmRes.response.pending_side_effects.find(
      (se) => se.effect_type === 'create_work_orders',
    );
    expect(woEffect?.status).toBe('completed');

    // Idempotency record stored
    const idempRecord = await idempStore.get('e2e-key-1');
    expect(idempRecord).not.toBeNull();
    expect(idempRecord!.work_order_ids).toHaveLength(2);
  });
});
```

Note: The implementing agent should adapt this test to use the exact same dispatcher setup as the existing `confirmation-integration.test.ts`, including the `InMemorySessionStore` helper and taxonomy loading.

**Step 2: Run test**

Run: `cd packages/core && pnpm vitest run src/__tests__/work-order/e2e-wo-creation.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/work-order/e2e-wo-creation.test.ts
git commit -m "test(core): E2E integration test — full WO creation flow"
```

---

### Task 11: TypeScript Cleanup + Full Validation Pass

Final pass: ensure all types compile, all tests pass, no lint errors. Validate WO objects against the existing `validateWorkOrder` schema validator.

**Files:**

- Modify: various (fix any type issues discovered)
- Test: `packages/core/src/__tests__/work-order/wo-schema-validation.test.ts`

**Step 1: Write schema validation test**

```typescript
// packages/core/src/__tests__/work-order/wo-schema-validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateWorkOrder } from '@wo-agent/schemas';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import {
  createSession,
  setSessionUnit,
  setSplitIssues,
  setClassificationResults,
  setSessionScope,
} from '../../session/session.js';

describe('created WOs pass schema validation', () => {
  it('validates against work_order.schema.json', () => {
    let s = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      authorized_unit_ids: ['u-1'],
      pinned_versions: {
        taxonomy_version: '1.0',
        schema_version: '1.0',
        model_id: 'm',
        prompt_version: '1.0',
      },
    });
    s = setSessionUnit(s, 'u-1');
    s = setSessionScope(s, { property_id: 'p-1', client_id: 'c-1' });
    s = setSplitIssues(s, [
      { issue_id: 'iss-1', summary: 'Test issue', raw_excerpt: 'Test raw text' },
    ]);
    s = setClassificationResults(s, [
      {
        issue_id: 'iss-1',
        classifierOutput: {
          issue_id: 'iss-1',
          classification: { category: 'plumbing' },
          model_confidence: { category: 0.9 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { category: 0.92 },
        fieldsNeedingInput: [],
      },
    ]);

    let counter = 0;
    const wos = createWorkOrders({
      session: s,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T14:00:00Z',
    });

    for (const wo of wos) {
      const result = validateWorkOrder(wo);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error('Validation errors:', result.errors);
      }
    }
  });
});
```

**Step 2: Run full type check**

Run: `pnpm typecheck`
Expected: 0 errors

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: All PASS

**Step 4: Fix any issues found**

Address any type errors, missing exports, or test failures.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore(core): Task 11 — TypeScript cleanup + schema validation for WO creation"
```

---

## Dependency Graph

```
Task 0 (session scope + UnitResolver)
  └── Task 1 (wire into SELECT_UNIT)
Task 2 (WorkOrderRepository)
Task 3 (IdempotencyStore)
Task 4 (WorkOrderCreator factory)
  └── depends on Task 0 (needs property_id/client_id on session)
Task 5 (WO event builder)
  └── depends on Task 2 (uses WorkOrderEvent type)
Task 6 (wire repos into deps)
  └── depends on Task 2, Task 3
Task 7 (wire into confirm-submission)
  └── depends on Task 4, Task 5, Task 6
Task 8 (idempotent retry test)
  └── depends on Task 7
Task 9 (response builder WO IDs)
  └── depends on Task 7
Task 10 (E2E integration test)
  └── depends on Task 7, Task 9
Task 11 (cleanup + validation)
  └── depends on all above
```

Parallelizable groups:

- **Group A** (independent): Task 0, Task 2, Task 3
- **Group B** (after Group A): Task 1, Task 4, Task 5, Task 6
- **Group C** (after Group B): Task 7
- **Group D** (after Group C): Task 8, Task 9 (parallel)
- **Group E** (after Group D): Task 10, Task 11
