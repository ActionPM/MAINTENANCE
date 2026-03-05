# Phase 12: Mock ERP Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build a mock ERP adapter that implements the `ERPAdapter` interface (spec §23), returns `EXT-uuid` identifiers, and simulates work order status transitions via polling and a test endpoint.

**Architecture:** The `ERPAdapter` interface lives in `packages/core/src/erp/` following the existing module pattern (types, event-builder, barrel). The `MockERPAdapter` lives in a new `packages/adapters/mock/` package per spec §27. An `ERPSyncService` in core pulls status updates from the adapter and applies them to `WorkOrderRepository` with optimistic locking (spec §18). Web layer gets a health endpoint and a test-only status-advance endpoint.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, append-only events (spec §7)

**Prerequisite skills:**
- @append-only-events — all ERP sync events are INSERT-only
- @schema-first-development — ERPAdapter interface is the contract
- @test-driven-development — TDD throughout
- @project-conventions — naming, file layout, barrel exports

---

### Task 0: ERPAdapter Interface + Types (Core)

**Files:**
- Create: `packages/core/src/erp/types.ts`
- Test: `packages/core/src/__tests__/erp/erp-types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/erp/erp-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
  ERPSyncEvent,
} from '../../erp/types.js';

describe('ERP types (Phase 12)', () => {
  it('ERPAdapter interface has all four spec §23 methods', () => {
    // Type-level check: a conforming object must have these methods.
    const adapter: ERPAdapter = {
      createWorkOrder: async () => ({ ext_id: 'EXT-123' }),
      getWorkOrderStatus: async () => ({
        ext_id: 'EXT-123',
        status: 'created',
        updated_at: '2026-03-04T00:00:00Z',
      }),
      syncUpdates: async () => [],
      healthCheck: async () => ({ healthy: true }),
    };
    expect(adapter).toBeDefined();
  });

  it('ERPCreateResult has ext_id', () => {
    const result: ERPCreateResult = { ext_id: 'EXT-abc' };
    expect(result.ext_id).toBe('EXT-abc');
  });

  it('ERPStatusResult has ext_id, status, updated_at', () => {
    const result: ERPStatusResult = {
      ext_id: 'EXT-abc',
      status: 'action_required',
      updated_at: '2026-03-04T00:00:00Z',
    };
    expect(result.status).toBe('action_required');
  });

  it('ERPStatusUpdate includes work_order_id and status transition', () => {
    const update: ERPStatusUpdate = {
      ext_id: 'EXT-abc',
      work_order_id: 'wo-1',
      previous_status: 'created',
      new_status: 'action_required',
      updated_at: '2026-03-04T00:00:00Z',
    };
    expect(update.previous_status).not.toBe(update.new_status);
  });

  it('ERPHealthResult has healthy flag', () => {
    const result: ERPHealthResult = { healthy: true };
    expect(result.healthy).toBe(true);
  });

  it('ERPSyncEvent follows append-only pattern', () => {
    const event: ERPSyncEvent = {
      event_id: 'evt-1',
      work_order_id: 'wo-1',
      conversation_id: 'conv-1',
      event_type: 'erp_create',
      ext_id: 'EXT-abc',
      payload: { status: 'created' },
      created_at: '2026-03-04T00:00:00Z',
    };
    expect(event.event_type).toBe('erp_create');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-types.test.ts`
Expected: FAIL — cannot resolve `../../erp/types.js`

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/erp/types.ts
import type { WorkOrder, WorkOrderStatus } from '@wo-agent/schemas';

/**
 * ERP adapter interface (spec §23).
 * Production: real ERP integration (Yardi, etc.).
 * MVP: MockERPAdapter in packages/adapters/mock/.
 */
export interface ERPAdapter {
  /** Register a work order with the ERP. Returns an external ID (EXT-<uuid>). */
  createWorkOrder(workOrder: WorkOrder): Promise<ERPCreateResult>;
  /** Poll a single work order's current status from the ERP. */
  getWorkOrderStatus(extId: string): Promise<ERPStatusResult>;
  /** Batch-poll for all status changes since a given timestamp. */
  syncUpdates(since: string): Promise<readonly ERPStatusUpdate[]>;
  /** Check ERP connectivity. */
  healthCheck(): Promise<ERPHealthResult>;
}

export interface ERPCreateResult {
  readonly ext_id: string;
}

export interface ERPStatusResult {
  readonly ext_id: string;
  readonly status: WorkOrderStatus;
  readonly updated_at: string;
}

export interface ERPStatusUpdate {
  readonly ext_id: string;
  readonly work_order_id: string;
  readonly previous_status: WorkOrderStatus;
  readonly new_status: WorkOrderStatus;
  readonly updated_at: string;
}

export interface ERPHealthResult {
  readonly healthy: boolean;
  readonly latency_ms?: number;
}

/**
 * Append-only ERP sync event (spec §7 — INSERT + SELECT only).
 * Logs every ERP operation for audit.
 */
export interface ERPSyncEvent {
  readonly event_id: string;
  readonly work_order_id: string;
  readonly conversation_id: string;
  readonly event_type: 'erp_create' | 'erp_status_poll' | 'erp_sync';
  readonly ext_id: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-types.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add packages/core/src/erp/types.ts packages/core/src/__tests__/erp/erp-types.test.ts
git commit -m "feat(core): add ERPAdapter interface and types (phase 12)"
```

---

### Task 1: WorkOrder Status Update + Optimistic Locking (Core)

**Files:**
- Modify: `packages/core/src/work-order/types.ts` (add `updateStatus` to interface)
- Modify: `packages/core/src/work-order/in-memory-wo-store.ts` (implement `updateStatus`)
- Modify: `packages/core/src/work-order/event-builder.ts` (add `buildWorkOrderStatusChangedEvent`)
- Modify: `packages/core/src/work-order/index.ts` (export new builder + type)
- Test: `packages/core/src/__tests__/work-order/wo-status-update.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/work-order/wo-status-update.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { buildWorkOrderStatusChangedEvent } from '../../work-order/event-builder.js';

function makeWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    work_order_id: 'wo-1',
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [{ status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00Z', actor: ActorType.SYSTEM }],
    raw_text: 'Leaking faucet',
    summary_confirmed: 'Leaking faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

describe('WorkOrder status update (Phase 12)', () => {
  let store: InMemoryWorkOrderStore;

  beforeEach(() => {
    store = new InMemoryWorkOrderStore();
  });

  it('updates status, appends to status_history, bumps row_version', async () => {
    const wo = makeWorkOrder();
    await store.insertBatch([wo]);

    const updated = await store.updateStatus(
      'wo-1',
      WorkOrderStatus.ACTION_REQUIRED,
      ActorType.SYSTEM,
      '2026-03-04T01:00:00Z',
      1, // expectedVersion
    );

    expect(updated.status).toBe('action_required');
    expect(updated.status_history).toHaveLength(2);
    expect(updated.status_history[1]).toEqual({
      status: 'action_required',
      changed_at: '2026-03-04T01:00:00Z',
      actor: 'system',
    });
    expect(updated.row_version).toBe(2);
    expect(updated.updated_at).toBe('2026-03-04T01:00:00Z');
  });

  it('rejects on version mismatch (optimistic locking, spec §18)', async () => {
    const wo = makeWorkOrder();
    await store.insertBatch([wo]);

    await expect(
      store.updateStatus('wo-1', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T01:00:00Z', 999),
    ).rejects.toThrow('Version mismatch');
  });

  it('rejects on unknown work_order_id', async () => {
    await expect(
      store.updateStatus('nonexistent', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T01:00:00Z', 1),
    ).rejects.toThrow('not found');
  });

  it('persists update for subsequent getById', async () => {
    const wo = makeWorkOrder();
    await store.insertBatch([wo]);
    await store.updateStatus('wo-1', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T01:00:00Z', 1);

    const fetched = await store.getById('wo-1');
    expect(fetched?.status).toBe('action_required');
    expect(fetched?.row_version).toBe(2);
  });
});

describe('buildWorkOrderStatusChangedEvent (Phase 12)', () => {
  it('builds a status_changed event', () => {
    const event = buildWorkOrderStatusChangedEvent({
      eventId: 'evt-1',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      previousStatus: WorkOrderStatus.CREATED,
      newStatus: WorkOrderStatus.ACTION_REQUIRED,
      actor: ActorType.SYSTEM,
      createdAt: '2026-03-04T01:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.work_order_id).toBe('wo-1');
    expect(event.event_type).toBe('status_changed');
    expect(event.payload).toEqual({
      conversation_id: 'conv-1',
      previous_status: 'created',
      new_status: 'action_required',
      actor: 'system',
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/work-order/wo-status-update.test.ts`
Expected: FAIL — `updateStatus` is not a function, `buildWorkOrderStatusChangedEvent` not exported

**Step 3: Add `updateStatus` to `WorkOrderRepository` interface**

In `packages/core/src/work-order/types.ts`, add to the `WorkOrderRepository` interface:

```typescript
  /** Update a WO's status with optimistic locking (spec §18). Rejects on version mismatch. */
  updateStatus(
    workOrderId: string,
    newStatus: WorkOrderStatus,
    actor: ActorType,
    changedAt: string,
    expectedVersion: number,
  ): Promise<WorkOrder>;
```

Add these imports at the top of `types.ts`:

```typescript
import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';
```

(replacing the existing `import type { WorkOrder } from '@wo-agent/schemas';`)

**Step 4: Implement `updateStatus` in `InMemoryWorkOrderStore`**

In `packages/core/src/work-order/in-memory-wo-store.ts`, add the method:

```typescript
  async updateStatus(
    workOrderId: string,
    newStatus: WorkOrderStatus,
    actor: ActorType,
    changedAt: string,
    expectedVersion: number,
  ): Promise<WorkOrder> {
    const existing = this.store.get(workOrderId);
    if (!existing) {
      throw new Error(`WorkOrder not found: ${workOrderId}`);
    }
    if (existing.row_version !== expectedVersion) {
      throw new Error(`Version mismatch: expected ${expectedVersion}, got ${existing.row_version}`);
    }

    const updated: WorkOrder = {
      ...existing,
      status: newStatus,
      status_history: [
        ...existing.status_history,
        { status: newStatus, changed_at: changedAt, actor },
      ],
      updated_at: changedAt,
      row_version: existing.row_version + 1,
    };

    this.store.set(workOrderId, updated);
    return updated;
  }
```

Add imports at top of `in-memory-wo-store.ts`:

```typescript
import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';
```

(replacing the existing `import type { WorkOrder } from '@wo-agent/schemas';`)

**Step 5: Add `buildWorkOrderStatusChangedEvent` to event builder**

In `packages/core/src/work-order/event-builder.ts`, add:

```typescript
export interface WOStatusChangedEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly previousStatus: WorkOrderStatus;
  readonly newStatus: WorkOrderStatus;
  readonly actor: ActorType;
  readonly createdAt: string;
}

/**
 * Build an append-only status_changed event (spec §7 — INSERT only).
 */
export function buildWorkOrderStatusChangedEvent(input: WOStatusChangedEventInput): WorkOrderEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    event_type: 'status_changed',
    payload: {
      conversation_id: input.conversationId,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      actor: input.actor,
    },
    created_at: input.createdAt,
  };
}
```

Add imports at top of `event-builder.ts`:

```typescript
import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';
```

(replacing the existing `import type { WorkOrder } from '@wo-agent/schemas';`)

**Step 6: Update barrel export**

In `packages/core/src/work-order/index.ts`, add:

```typescript
export { buildWorkOrderStatusChangedEvent } from './event-builder.js';
export type { WOStatusChangedEventInput } from './event-builder.js';
```

**Step 7: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/work-order/wo-status-update.test.ts`
Expected: PASS (5 tests)

**Step 8: Run full test suite to check for regressions**

Run: `pnpm --filter @wo-agent/core test`
Expected: All 480+ tests pass

**Step 9: Commit**

```bash
git add packages/core/src/work-order/types.ts packages/core/src/work-order/in-memory-wo-store.ts packages/core/src/work-order/event-builder.ts packages/core/src/work-order/index.ts packages/core/src/__tests__/work-order/wo-status-update.test.ts
git commit -m "feat(core): add WO status update with optimistic locking (phase 12)"
```

---

### Task 2: ERP Event Builder (Core)

**Files:**
- Create: `packages/core/src/erp/event-builder.ts`
- Test: `packages/core/src/__tests__/erp/erp-event-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/erp/erp-event-builder.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildERPCreateEvent,
  buildERPStatusPollEvent,
  buildERPSyncEvent,
} from '../../erp/event-builder.js';

describe('ERP event builders (Phase 12)', () => {
  it('buildERPCreateEvent returns erp_create event', () => {
    const event = buildERPCreateEvent({
      eventId: 'evt-1',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-abc',
      createdAt: '2026-03-04T00:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.work_order_id).toBe('wo-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.event_type).toBe('erp_create');
    expect(event.ext_id).toBe('EXT-abc');
    expect(event.payload).toEqual({});
    expect(event.created_at).toBe('2026-03-04T00:00:00Z');
  });

  it('buildERPStatusPollEvent returns erp_status_poll event', () => {
    const event = buildERPStatusPollEvent({
      eventId: 'evt-2',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-abc',
      status: 'action_required',
      createdAt: '2026-03-04T01:00:00Z',
    });

    expect(event.event_type).toBe('erp_status_poll');
    expect(event.payload).toEqual({ status: 'action_required' });
  });

  it('buildERPSyncEvent returns erp_sync event with status transition', () => {
    const event = buildERPSyncEvent({
      eventId: 'evt-3',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-abc',
      previousStatus: 'created',
      newStatus: 'action_required',
      createdAt: '2026-03-04T02:00:00Z',
    });

    expect(event.event_type).toBe('erp_sync');
    expect(event.payload).toEqual({
      previous_status: 'created',
      new_status: 'action_required',
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-event-builder.test.ts`
Expected: FAIL — cannot resolve `../../erp/event-builder.js`

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/erp/event-builder.ts
import type { WorkOrderStatus } from '@wo-agent/schemas';
import type { ERPSyncEvent } from './types.js';

export interface ERPCreateEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly extId: string;
  readonly createdAt: string;
}

export interface ERPStatusPollEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly extId: string;
  readonly status: WorkOrderStatus;
  readonly createdAt: string;
}

export interface ERPSyncEventInput {
  readonly eventId: string;
  readonly workOrderId: string;
  readonly conversationId: string;
  readonly extId: string;
  readonly previousStatus: WorkOrderStatus;
  readonly newStatus: WorkOrderStatus;
  readonly createdAt: string;
}

/** Build an append-only erp_create event (spec §7 — INSERT only). */
export function buildERPCreateEvent(input: ERPCreateEventInput): ERPSyncEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    conversation_id: input.conversationId,
    event_type: 'erp_create',
    ext_id: input.extId,
    payload: {},
    created_at: input.createdAt,
  };
}

/** Build an append-only erp_status_poll event (spec §7 — INSERT only). */
export function buildERPStatusPollEvent(input: ERPStatusPollEventInput): ERPSyncEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    conversation_id: input.conversationId,
    event_type: 'erp_status_poll',
    ext_id: input.extId,
    payload: { status: input.status },
    created_at: input.createdAt,
  };
}

/** Build an append-only erp_sync event (spec §7 — INSERT only). */
export function buildERPSyncEvent(input: ERPSyncEventInput): ERPSyncEvent {
  return {
    event_id: input.eventId,
    work_order_id: input.workOrderId,
    conversation_id: input.conversationId,
    event_type: 'erp_sync',
    ext_id: input.extId,
    payload: {
      previous_status: input.previousStatus,
      new_status: input.newStatus,
    },
    created_at: input.createdAt,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-event-builder.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/core/src/erp/event-builder.ts packages/core/src/__tests__/erp/erp-event-builder.test.ts
git commit -m "feat(core): add ERP event builders (phase 12)"
```

---

### Task 3: Core ERP Barrel + Main Barrel Update

**Files:**
- Create: `packages/core/src/erp/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/erp/erp-barrel.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/erp/erp-barrel.test.ts
import { describe, it, expect } from 'vitest';
import * as erp from '../../erp/index.js';

describe('ERP barrel exports (Phase 12)', () => {
  it('exports event builders', () => {
    expect(typeof erp.buildERPCreateEvent).toBe('function');
    expect(typeof erp.buildERPStatusPollEvent).toBe('function');
    expect(typeof erp.buildERPSyncEvent).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-barrel.test.ts`
Expected: FAIL — cannot resolve `../../erp/index.js`

**Step 3: Create barrel and update main barrel**

```typescript
// packages/core/src/erp/index.ts
export type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
  ERPSyncEvent,
} from './types.js';
export {
  buildERPCreateEvent,
  buildERPStatusPollEvent,
  buildERPSyncEvent,
} from './event-builder.js';
export type {
  ERPCreateEventInput,
  ERPStatusPollEventInput,
  ERPSyncEventInput,
} from './event-builder.js';
```

In `packages/core/src/index.ts`, add at the end (before or after the Orchestrator section):

```typescript
// --- ERP Adapter (Phase 12) ---
export type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
  ERPSyncEvent,
} from './erp/index.js';
export {
  buildERPCreateEvent,
  buildERPStatusPollEvent,
  buildERPSyncEvent,
} from './erp/index.js';
export type {
  ERPCreateEventInput,
  ERPStatusPollEventInput,
  ERPSyncEventInput,
} from './erp/index.js';
```

Also add the new WO status exports to the `// --- Work Order (Phase 8) ---` section:

```typescript
export { buildWorkOrderStatusChangedEvent } from './work-order/index.js';
export type { WOStatusChangedEventInput } from './work-order/index.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-barrel.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm --filter @wo-agent/core test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/core/src/erp/index.ts packages/core/src/index.ts packages/core/src/__tests__/erp/erp-barrel.test.ts
git commit -m "feat(core): add ERP barrel exports (phase 12)"
```

---

### Task 4: Mock Adapter Package Scaffolding

**Files:**
- Create: `packages/adapters/mock/package.json`
- Create: `packages/adapters/mock/tsconfig.json`
- Create: `packages/adapters/mock/vitest.config.ts`
- Create: `packages/adapters/mock/src/index.ts`

**Step 1: Create directory and package.json**

```bash
mkdir -p packages/adapters/mock/src
```

```json
// packages/adapters/mock/package.json
{
  "name": "@wo-agent/mock-erp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@wo-agent/core": "workspace:*",
    "@wo-agent/schemas": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^25.3.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
// packages/adapters/mock/tsconfig.json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
// packages/adapters/mock/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 4: Create placeholder barrel**

```typescript
// packages/adapters/mock/src/index.ts
// Mock ERP adapter (Phase 12, spec §23)
```

**Step 5: Install dependencies**

Run: `pnpm install`
Expected: Workspace links resolved, no errors

**Step 6: Verify typecheck**

Run: `pnpm --filter @wo-agent/mock-erp typecheck`
Expected: No errors

**Step 7: Commit**

```bash
git add packages/adapters/mock/package.json packages/adapters/mock/tsconfig.json packages/adapters/mock/vitest.config.ts packages/adapters/mock/src/index.ts pnpm-lock.yaml
git commit -m "chore: scaffold @wo-agent/mock-erp adapter package (phase 12)"
```

---

### Task 5: MockERPAdapter Implementation

**Files:**
- Create: `packages/adapters/mock/src/mock-erp-adapter.ts`
- Modify: `packages/adapters/mock/src/index.ts`
- Test: `packages/adapters/mock/src/__tests__/mock-erp-adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/adapters/mock/src/__tests__/mock-erp-adapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { MockERPAdapter } from '../mock-erp-adapter.js';

function makeWorkOrder(id: string = 'wo-1'): WorkOrder {
  return {
    work_order_id: id,
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [{ status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00Z', actor: ActorType.SYSTEM }],
    raw_text: 'Leaking faucet',
    summary_confirmed: 'Leaking faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
  };
}

describe('MockERPAdapter (Phase 12)', () => {
  let adapter: MockERPAdapter;

  beforeEach(() => {
    adapter = new MockERPAdapter();
  });

  describe('createWorkOrder', () => {
    it('returns EXT- prefixed external ID', async () => {
      const result = await adapter.createWorkOrder(makeWorkOrder());
      expect(result.ext_id).toMatch(/^EXT-/);
    });

    it('stores the mapping for later retrieval', async () => {
      const wo = makeWorkOrder();
      const { ext_id } = await adapter.createWorkOrder(wo);
      const status = await adapter.getWorkOrderStatus(ext_id);
      expect(status.ext_id).toBe(ext_id);
      expect(status.status).toBe('created');
    });

    it('rejects duplicate work_order_id', async () => {
      const wo = makeWorkOrder();
      await adapter.createWorkOrder(wo);
      await expect(adapter.createWorkOrder(wo)).rejects.toThrow('already registered');
    });

    it('records the call for assertion', async () => {
      const wo = makeWorkOrder();
      await adapter.createWorkOrder(wo);
      expect(adapter.calls.createWorkOrder).toHaveLength(1);
      expect(adapter.calls.createWorkOrder[0].work_order_id).toBe('wo-1');
    });
  });

  describe('getWorkOrderStatus', () => {
    it('returns current status', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      const result = await adapter.getWorkOrderStatus(ext_id);
      expect(result.status).toBe('created');
    });

    it('rejects unknown ext_id', async () => {
      await expect(adapter.getWorkOrderStatus('EXT-nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('advanceStatus (test helper)', () => {
    it('advances created → action_required', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      const update = adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');

      expect(update.previous_status).toBe('created');
      expect(update.new_status).toBe('action_required');

      const status = await adapter.getWorkOrderStatus(ext_id);
      expect(status.status).toBe('action_required');
    });

    it('advances action_required → scheduled', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      const update = adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');

      expect(update.previous_status).toBe('action_required');
      expect(update.new_status).toBe('scheduled');
    });

    it('advances scheduled → resolved', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');
      const update = adapter.advanceStatus(ext_id, '2026-03-04T03:00:00Z');

      expect(update.previous_status).toBe('scheduled');
      expect(update.new_status).toBe('resolved');
    });

    it('throws on terminal status (resolved)', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T03:00:00Z');

      expect(() => adapter.advanceStatus(ext_id, '2026-03-04T04:00:00Z')).toThrow('terminal');
    });
  });

  describe('syncUpdates', () => {
    it('returns empty when no changes since timestamp', async () => {
      await adapter.createWorkOrder(makeWorkOrder());
      const updates = await adapter.syncUpdates('2026-03-05T00:00:00Z');
      expect(updates).toHaveLength(0);
    });

    it('returns status changes after given timestamp', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');

      const updates = await adapter.syncUpdates('2026-03-04T00:30:00Z');
      expect(updates).toHaveLength(1);
      expect(updates[0].ext_id).toBe(ext_id);
      expect(updates[0].new_status).toBe('action_required');
    });

    it('excludes changes before the since timestamp', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');

      const updates = await adapter.syncUpdates('2026-03-04T01:30:00Z');
      expect(updates).toHaveLength(1);
      expect(updates[0].new_status).toBe('scheduled');
    });
  });

  describe('healthCheck', () => {
    it('returns healthy by default', async () => {
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('returns unhealthy when configured to fail', async () => {
      const failing = new MockERPAdapter({ shouldFail: true });
      const result = await failing.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });

  describe('shouldFail mode', () => {
    it('createWorkOrder rejects when shouldFail is true', async () => {
      const failing = new MockERPAdapter({ shouldFail: true });
      await expect(failing.createWorkOrder(makeWorkOrder())).rejects.toThrow('Mock ERP failure');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/mock-erp test`
Expected: FAIL — cannot resolve `../mock-erp-adapter.js`

**Step 3: Write minimal implementation**

```typescript
// packages/adapters/mock/src/mock-erp-adapter.ts
import type { WorkOrder, WorkOrderStatus } from '@wo-agent/schemas';
import type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
} from '@wo-agent/core';

export interface MockERPAdapterConfig {
  readonly shouldFail?: boolean;
  readonly failureError?: string;
}

interface ERPRecord {
  ext_id: string;
  work_order_id: string;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
}

interface StatusChange {
  ext_id: string;
  work_order_id: string;
  previous_status: WorkOrderStatus;
  new_status: WorkOrderStatus;
  updated_at: string;
}

/**
 * WO status lifecycle (spec §1.5):
 * created → action_required → scheduled → resolved | cancelled
 */
const NEXT_STATUS: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = {
  created: 'action_required' as WorkOrderStatus,
  action_required: 'scheduled' as WorkOrderStatus,
  scheduled: 'resolved' as WorkOrderStatus,
};

let extCounter = 0;

/**
 * Mock ERP adapter for testing and MVP (spec §23).
 * Returns EXT-<counter> IDs and simulates status transitions.
 */
export class MockERPAdapter implements ERPAdapter {
  private readonly config: MockERPAdapterConfig;
  private readonly records = new Map<string, ERPRecord>();
  private readonly byWorkOrderId = new Map<string, string>(); // wo_id → ext_id
  private readonly statusChanges: StatusChange[] = [];

  /** Recorded calls for test assertion. */
  readonly calls = {
    createWorkOrder: [] as Array<{ work_order_id: string; ext_id: string }>,
    getWorkOrderStatus: [] as Array<{ ext_id: string }>,
    syncUpdates: [] as Array<{ since: string }>,
    healthCheck: [] as Array<Record<string, never>>,
  };

  constructor(config: MockERPAdapterConfig = {}) {
    this.config = config;
  }

  async createWorkOrder(workOrder: WorkOrder): Promise<ERPCreateResult> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failureError ?? 'Mock ERP failure');
    }

    if (this.byWorkOrderId.has(workOrder.work_order_id)) {
      throw new Error(`Work order ${workOrder.work_order_id} already registered with ERP`);
    }

    const ext_id = `EXT-${++extCounter}`;
    const now = workOrder.created_at;

    this.records.set(ext_id, {
      ext_id,
      work_order_id: workOrder.work_order_id,
      status: workOrder.status,
      created_at: now,
      updated_at: now,
    });
    this.byWorkOrderId.set(workOrder.work_order_id, ext_id);

    this.calls.createWorkOrder.push({ work_order_id: workOrder.work_order_id, ext_id });
    return { ext_id };
  }

  async getWorkOrderStatus(extId: string): Promise<ERPStatusResult> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failureError ?? 'Mock ERP failure');
    }

    const record = this.records.get(extId);
    if (!record) {
      throw new Error(`ERP record not found: ${extId}`);
    }

    this.calls.getWorkOrderStatus.push({ ext_id: extId });
    return {
      ext_id: record.ext_id,
      status: record.status,
      updated_at: record.updated_at,
    };
  }

  async syncUpdates(since: string): Promise<readonly ERPStatusUpdate[]> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failureError ?? 'Mock ERP failure');
    }

    this.calls.syncUpdates.push({ since });
    const sinceTime = new Date(since).getTime();
    return this.statusChanges.filter(
      (change) => new Date(change.updated_at).getTime() > sinceTime,
    );
  }

  async healthCheck(): Promise<ERPHealthResult> {
    this.calls.healthCheck.push({});
    return { healthy: !this.config.shouldFail };
  }

  /**
   * Test helper: advance a work order to the next status in the lifecycle.
   * Spec §1.5: created → action_required → scheduled → resolved | cancelled
   */
  advanceStatus(extId: string, changedAt: string): ERPStatusUpdate {
    const record = this.records.get(extId);
    if (!record) {
      throw new Error(`ERP record not found: ${extId}`);
    }

    const nextStatus = NEXT_STATUS[record.status];
    if (!nextStatus) {
      throw new Error(`Cannot advance from terminal status: ${record.status}`);
    }

    const update: StatusChange = {
      ext_id: extId,
      work_order_id: record.work_order_id,
      previous_status: record.status,
      new_status: nextStatus,
      updated_at: changedAt,
    };

    record.status = nextStatus;
    record.updated_at = changedAt;
    this.statusChanges.push(update);

    return update;
  }

  /** Test helper: get ext_id for a work_order_id. */
  getExtId(workOrderId: string): string | undefined {
    return this.byWorkOrderId.get(workOrderId);
  }

  /** Test helper: reset the counter (call in beforeEach). */
  static resetCounter(): void {
    extCounter = 0;
  }
}
```

**Step 4: Update barrel**

```typescript
// packages/adapters/mock/src/index.ts
export { MockERPAdapter } from './mock-erp-adapter.js';
export type { MockERPAdapterConfig } from './mock-erp-adapter.js';
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/mock-erp test`
Expected: PASS (all ~14 tests)

**Step 6: Commit**

```bash
git add packages/adapters/mock/src/mock-erp-adapter.ts packages/adapters/mock/src/index.ts packages/adapters/mock/src/__tests__/mock-erp-adapter.test.ts
git commit -m "feat(mock-erp): implement MockERPAdapter with status simulation (phase 12)"
```

---

### Task 6: ERP Sync Service (Core)

**Files:**
- Create: `packages/core/src/erp/erp-sync-service.ts`
- Modify: `packages/core/src/erp/index.ts` (export sync service)
- Modify: `packages/core/src/index.ts` (export sync service)
- Test: `packages/core/src/__tests__/erp/erp-sync-service.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/erp/erp-sync-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { ERPSyncService } from '../../erp/erp-sync-service.js';
import type { ERPAdapter, ERPStatusUpdate } from '../../erp/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';

function makeWorkOrder(id: string = 'wo-1'): WorkOrder {
  return {
    work_order_id: id,
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [{ status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00Z', actor: ActorType.SYSTEM }],
    raw_text: 'Leaking faucet',
    summary_confirmed: 'Leaking faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
  };
}

function makeFakeAdapter(updates: ERPStatusUpdate[]): ERPAdapter {
  return {
    createWorkOrder: async () => ({ ext_id: 'EXT-1' }),
    getWorkOrderStatus: async () => ({ ext_id: 'EXT-1', status: 'created' as WorkOrderStatus, updated_at: '2026-03-04T00:00:00Z' }),
    syncUpdates: async () => updates,
    healthCheck: async () => ({ healthy: true }),
  };
}

describe('ERPSyncService (Phase 12)', () => {
  let woStore: InMemoryWorkOrderStore;
  let idCounter: number;
  const idGen = () => `gen-${++idCounter}`;
  const clock = () => '2026-03-04T02:00:00Z';

  beforeEach(() => {
    woStore = new InMemoryWorkOrderStore();
    idCounter = 0;
  });

  it('applies status updates from ERP sync to work orders', async () => {
    const wo = makeWorkOrder();
    await woStore.insertBatch([wo]);

    const updates: ERPStatusUpdate[] = [{
      ext_id: 'EXT-1',
      work_order_id: 'wo-1',
      previous_status: WorkOrderStatus.CREATED,
      new_status: WorkOrderStatus.ACTION_REQUIRED,
      updated_at: '2026-03-04T01:00:00Z',
    }];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({ erpAdapter: adapter, workOrderRepo: woStore, idGenerator: idGen, clock });

    const result = await service.sync('2026-03-04T00:00:00Z');

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);

    const updated = await woStore.getById('wo-1');
    expect(updated?.status).toBe('action_required');
    expect(updated?.row_version).toBe(2);
  });

  it('returns zero applied when no updates exist', async () => {
    const adapter = makeFakeAdapter([]);
    const service = new ERPSyncService({ erpAdapter: adapter, workOrderRepo: woStore, idGenerator: idGen, clock });

    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.applied).toBe(0);
  });

  it('skips updates for unknown work_order_ids without crashing', async () => {
    const updates: ERPStatusUpdate[] = [{
      ext_id: 'EXT-999',
      work_order_id: 'nonexistent',
      previous_status: WorkOrderStatus.CREATED,
      new_status: WorkOrderStatus.ACTION_REQUIRED,
      updated_at: '2026-03-04T01:00:00Z',
    }];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({ erpAdapter: adapter, workOrderRepo: woStore, idGenerator: idGen, clock });

    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('handles version mismatch gracefully', async () => {
    const wo = makeWorkOrder();
    await woStore.insertBatch([wo]);
    // Pre-advance to version 2 to cause mismatch
    await woStore.updateStatus('wo-1', WorkOrderStatus.ACTION_REQUIRED, ActorType.SYSTEM, '2026-03-04T00:30:00Z', 1);

    const updates: ERPStatusUpdate[] = [{
      ext_id: 'EXT-1',
      work_order_id: 'wo-1',
      previous_status: WorkOrderStatus.CREATED,
      new_status: WorkOrderStatus.ACTION_REQUIRED,
      updated_at: '2026-03-04T01:00:00Z',
    }];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({ erpAdapter: adapter, workOrderRepo: woStore, idGenerator: idGen, clock });

    // Should not throw — just count as failed
    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.failed).toBe(1);
  });

  it('builds WorkOrderEvent for each applied sync', async () => {
    const wo = makeWorkOrder();
    await woStore.insertBatch([wo]);

    const updates: ERPStatusUpdate[] = [{
      ext_id: 'EXT-1',
      work_order_id: 'wo-1',
      previous_status: WorkOrderStatus.CREATED,
      new_status: WorkOrderStatus.ACTION_REQUIRED,
      updated_at: '2026-03-04T01:00:00Z',
    }];

    const adapter = makeFakeAdapter(updates);
    const service = new ERPSyncService({ erpAdapter: adapter, workOrderRepo: woStore, idGenerator: idGen, clock });

    const result = await service.sync('2026-03-04T00:00:00Z');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event_type).toBe('status_changed');
    expect(result.events[0].work_order_id).toBe('wo-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-sync-service.test.ts`
Expected: FAIL — cannot resolve `../../erp/erp-sync-service.js`

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/erp/erp-sync-service.ts
import { ActorType } from '@wo-agent/schemas';
import type { WorkOrderRepository, WorkOrderEvent } from '../work-order/types.js';
import { buildWorkOrderStatusChangedEvent } from '../work-order/event-builder.js';
import type { ERPAdapter } from './types.js';

export interface ERPSyncServiceDeps {
  readonly erpAdapter: ERPAdapter;
  readonly workOrderRepo: WorkOrderRepository;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export interface SyncResult {
  readonly applied: number;
  readonly failed: number;
  readonly errors: readonly SyncError[];
  readonly events: readonly WorkOrderEvent[];
}

export interface SyncError {
  readonly work_order_id: string;
  readonly ext_id: string;
  readonly reason: string;
}

/**
 * ERP sync service (spec §23).
 * Pulls status updates from the ERP adapter and applies them to the WO store.
 * Each applied update produces a status_changed WorkOrderEvent.
 */
export class ERPSyncService {
  private readonly deps: ERPSyncServiceDeps;

  constructor(deps: ERPSyncServiceDeps) {
    this.deps = deps;
  }

  async sync(since: string): Promise<SyncResult> {
    const { erpAdapter, workOrderRepo, idGenerator, clock } = this.deps;
    const updates = await erpAdapter.syncUpdates(since);

    let applied = 0;
    let failed = 0;
    const errors: SyncError[] = [];
    const events: WorkOrderEvent[] = [];

    for (const update of updates) {
      try {
        const wo = await workOrderRepo.getById(update.work_order_id);
        if (!wo) {
          errors.push({ work_order_id: update.work_order_id, ext_id: update.ext_id, reason: 'Work order not found' });
          failed++;
          continue;
        }

        const updated = await workOrderRepo.updateStatus(
          update.work_order_id,
          update.new_status,
          ActorType.SYSTEM,
          update.updated_at,
          wo.row_version,
        );

        const event = buildWorkOrderStatusChangedEvent({
          eventId: idGenerator(),
          workOrderId: update.work_order_id,
          conversationId: updated.conversation_id,
          previousStatus: update.previous_status,
          newStatus: update.new_status,
          actor: ActorType.SYSTEM,
          createdAt: clock(),
        });

        events.push(event);
        applied++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ work_order_id: update.work_order_id, ext_id: update.ext_id, reason });
        failed++;
      }
    }

    return { applied, failed, errors, events };
  }
}
```

**Step 4: Update barrel exports**

In `packages/core/src/erp/index.ts`, add:

```typescript
export { ERPSyncService } from './erp-sync-service.js';
export type { ERPSyncServiceDeps, SyncResult, SyncError } from './erp-sync-service.js';
```

In `packages/core/src/index.ts`, add to the `// --- ERP Adapter (Phase 12) ---` section:

```typescript
export { ERPSyncService } from './erp/index.js';
export type { ERPSyncServiceDeps, SyncResult, SyncError } from './erp/index.js';
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-sync-service.test.ts`
Expected: PASS (5 tests)

**Step 6: Run full test suite**

Run: `pnpm --filter @wo-agent/core test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/core/src/erp/erp-sync-service.ts packages/core/src/erp/index.ts packages/core/src/index.ts packages/core/src/__tests__/erp/erp-sync-service.test.ts
git commit -m "feat(core): add ERP sync service (phase 12)"
```

---

### Task 7: Web Integration — Wiring + Endpoints

**Files:**
- Modify: `apps/web/src/lib/orchestrator-factory.ts` (wire MockERPAdapter + ERPSyncService)
- Create: `apps/web/src/app/api/health/erp/route.ts`
- Create: `apps/web/src/app/api/erp/test/advance-status/route.ts`

**Step 1: Update orchestrator-factory.ts**

Add imports:

```typescript
import { ERPSyncService } from '@wo-agent/core';
import type { ERPAdapter } from '@wo-agent/core';
import { MockERPAdapter } from '@wo-agent/mock-erp';
```

Expand the `_deps` type to include ERP:

```typescript
let _deps: {
  workOrderRepo: InMemoryWorkOrderStore;
  notificationRepo: InMemoryNotificationStore;
  dispatcher: ReturnType<typeof createDispatcher>;
  erpAdapter: MockERPAdapter;
  erpSyncService: ERPSyncService;
} | null = null;
```

Inside `ensureInitialized()`, after `notificationService` construction, add:

```typescript
    const erpAdapter = new MockERPAdapter();
    const erpSyncService = new ERPSyncService({
      erpAdapter,
      workOrderRepo,
      idGenerator,
      clock,
    });
```

Update the `_deps` assignment to include:

```typescript
    _deps = {
      workOrderRepo,
      notificationRepo,
      dispatcher: createDispatcher(deps),
      erpAdapter,
      erpSyncService,
    };
```

Add getter functions at the bottom:

```typescript
export function getERPAdapter() {
  return ensureInitialized().erpAdapter;
}

export function getERPSyncService() {
  return ensureInitialized().erpSyncService;
}
```

**Step 2: Create ERP health endpoint**

```typescript
// apps/web/src/app/api/health/erp/route.ts
import { NextResponse } from 'next/server';
import { getERPAdapter } from '../../../../lib/orchestrator-factory.js';

export async function GET() {
  try {
    const adapter = getERPAdapter();
    const result = await adapter.healthCheck();
    const status = result.healthy ? 200 : 503;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ healthy: false }, { status: 503 });
  }
}
```

**Step 3: Create test-only advance-status endpoint**

```typescript
// apps/web/src/app/api/erp/test/advance-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getERPAdapter, getERPSyncService } from '../../../../../lib/orchestrator-factory.js';

/**
 * Test-only endpoint to simulate ERP status advancement (spec §23).
 * POST /api/erp/test/advance-status
 * Body: { "work_order_id": "string" }
 *
 * Advances the WO to the next status in the lifecycle and syncs.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { work_order_id?: string };
    if (!body.work_order_id) {
      return NextResponse.json({ error: 'work_order_id is required' }, { status: 400 });
    }

    const adapter = getERPAdapter();
    const extId = adapter.getExtId(body.work_order_id);
    if (!extId) {
      return NextResponse.json({ error: 'Work order not registered with ERP' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const update = adapter.advanceStatus(extId, now);

    // Sync the change to the local WO store
    const syncService = getERPSyncService();
    const syncResult = await syncService.sync(
      new Date(new Date(now).getTime() - 1000).toISOString(), // 1 second before
    );

    return NextResponse.json({
      update,
      sync: { applied: syncResult.applied, failed: syncResult.failed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

**Step 4: Verify the web package builds**

Run: `pnpm --filter @wo-agent/web typecheck`
Expected: No type errors

**Step 5: Run all tests**

Run: `pnpm --filter @wo-agent/core test && pnpm --filter @wo-agent/mock-erp test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/web/src/lib/orchestrator-factory.ts apps/web/src/app/api/health/erp/route.ts apps/web/src/app/api/erp/test/advance-status/route.ts
git commit -m "feat(web): wire MockERPAdapter + health + test advance endpoint (phase 12)"
```

---

### Task 8: Integration Test — Full ERP Flow

**Files:**
- Test: `packages/core/src/__tests__/erp/erp-integration.test.ts`

**Step 1: Write the integration test**

```typescript
// packages/core/src/__tests__/erp/erp-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { ERPSyncService } from '../../erp/erp-sync-service.js';
import { buildERPCreateEvent } from '../../erp/event-builder.js';

// Import MockERPAdapter from the adapters package
// Note: In this integration test, we test the full flow without the mock-erp package.
// Instead, we use a minimal inline mock to avoid cross-package test deps.

interface ERPRecord {
  ext_id: string;
  work_order_id: string;
  status: WorkOrderStatus;
  updated_at: string;
}

function makeWorkOrder(id: string): WorkOrder {
  return {
    work_order_id: id,
    issue_group_id: 'ig-1',
    issue_id: `issue-${id}`,
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [{ status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00Z', actor: ActorType.SYSTEM }],
    raw_text: 'Test issue',
    summary_confirmed: 'Test issue summary',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
  };
}

describe('ERP integration (Phase 12)', () => {
  let woStore: InMemoryWorkOrderStore;
  let idCounter: number;
  const idGen = () => `gen-${++idCounter}`;
  const clock = () => '2026-03-04T10:00:00Z';

  beforeEach(() => {
    woStore = new InMemoryWorkOrderStore();
    idCounter = 0;
  });

  it('full flow: create WOs → register with ERP → advance → sync → verify', async () => {
    // 1. Create work orders locally
    const wo1 = makeWorkOrder('wo-1');
    const wo2 = makeWorkOrder('wo-2');
    await woStore.insertBatch([wo1, wo2]);

    // 2. Simulate ERP registration (inline mock adapter)
    const erpRecords = new Map<string, ERPRecord>();
    const statusChanges: Array<{ ext_id: string; work_order_id: string; previous_status: WorkOrderStatus; new_status: WorkOrderStatus; updated_at: string }> = [];

    const registerWithERP = (wo: WorkOrder): string => {
      const extId = `EXT-${wo.work_order_id}`;
      erpRecords.set(extId, { ext_id: extId, work_order_id: wo.work_order_id, status: wo.status, updated_at: wo.created_at });
      return extId;
    };

    const extId1 = registerWithERP(wo1);
    const extId2 = registerWithERP(wo2);

    expect(extId1).toBe('EXT-wo-1');
    expect(extId2).toBe('EXT-wo-2');

    // 3. Simulate ERP status advancement
    const record1 = erpRecords.get(extId1)!;
    statusChanges.push({
      ext_id: extId1,
      work_order_id: record1.work_order_id,
      previous_status: record1.status,
      new_status: WorkOrderStatus.ACTION_REQUIRED,
      updated_at: '2026-03-04T05:00:00Z',
    });
    record1.status = WorkOrderStatus.ACTION_REQUIRED;

    // 4. Run sync service
    const fakeAdapter = {
      createWorkOrder: async () => ({ ext_id: 'unused' }),
      getWorkOrderStatus: async () => ({ ext_id: 'unused', status: 'created' as WorkOrderStatus, updated_at: '' }),
      syncUpdates: async () => statusChanges,
      healthCheck: async () => ({ healthy: true }),
    };

    const syncService = new ERPSyncService({
      erpAdapter: fakeAdapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const syncResult = await syncService.sync('2026-03-04T00:00:00Z');

    // 5. Verify
    expect(syncResult.applied).toBe(1);
    expect(syncResult.failed).toBe(0);
    expect(syncResult.events).toHaveLength(1);
    expect(syncResult.events[0].event_type).toBe('status_changed');

    const updatedWo1 = await woStore.getById('wo-1');
    expect(updatedWo1?.status).toBe('action_required');
    expect(updatedWo1?.row_version).toBe(2);
    expect(updatedWo1?.status_history).toHaveLength(2);

    // wo-2 should be unchanged
    const unchangedWo2 = await woStore.getById('wo-2');
    expect(unchangedWo2?.status).toBe('created');
    expect(unchangedWo2?.row_version).toBe(1);
  });

  it('ERP event builders produce valid audit events', () => {
    const createEvent = buildERPCreateEvent({
      eventId: 'evt-1',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-wo-1',
      createdAt: '2026-03-04T00:00:00Z',
    });

    expect(createEvent.event_type).toBe('erp_create');
    expect(createEvent.ext_id).toBe('EXT-wo-1');
    expect(createEvent.work_order_id).toBe('wo-1');
    expect(createEvent.conversation_id).toBe('conv-1');
  });

  it('multiple status transitions applied in sequence', async () => {
    const wo = makeWorkOrder('wo-seq');
    await woStore.insertBatch([wo]);

    const updates = [
      { ext_id: 'EXT-seq', work_order_id: 'wo-seq', previous_status: WorkOrderStatus.CREATED, new_status: WorkOrderStatus.ACTION_REQUIRED, updated_at: '2026-03-04T01:00:00Z' },
      { ext_id: 'EXT-seq', work_order_id: 'wo-seq', previous_status: WorkOrderStatus.ACTION_REQUIRED, new_status: WorkOrderStatus.SCHEDULED, updated_at: '2026-03-04T02:00:00Z' },
      { ext_id: 'EXT-seq', work_order_id: 'wo-seq', previous_status: WorkOrderStatus.SCHEDULED, new_status: WorkOrderStatus.RESOLVED, updated_at: '2026-03-04T03:00:00Z' },
    ];

    const fakeAdapter = {
      createWorkOrder: async () => ({ ext_id: 'unused' }),
      getWorkOrderStatus: async () => ({ ext_id: 'unused', status: 'created' as WorkOrderStatus, updated_at: '' }),
      syncUpdates: async () => updates,
      healthCheck: async () => ({ healthy: true }),
    };

    const syncService = new ERPSyncService({
      erpAdapter: fakeAdapter,
      workOrderRepo: woStore,
      idGenerator: idGen,
      clock,
    });

    const result = await syncService.sync('2026-03-04T00:00:00Z');

    expect(result.applied).toBe(3);
    expect(result.events).toHaveLength(3);

    const final = await woStore.getById('wo-seq');
    expect(final?.status).toBe('resolved');
    expect(final?.row_version).toBe(4); // 1 + 3 updates
    expect(final?.status_history).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/erp/erp-integration.test.ts`
Expected: PASS (3 tests)

**Step 3: Run full test suite across all packages**

Run: `pnpm --filter @wo-agent/core test && pnpm --filter @wo-agent/mock-erp test && pnpm --filter @wo-agent/schemas test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/core/src/__tests__/erp/erp-integration.test.ts
git commit -m "test(core): ERP integration tests — full sync flow (phase 12)"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 0 | ERPAdapter interface + types | 2 | 0 |
| 1 | WO status update + optimistic locking | 1 | 4 |
| 2 | ERP event builders | 2 | 0 |
| 3 | Core barrel exports | 2 | 1 |
| 4 | Mock adapter package scaffolding | 4 | 0 |
| 5 | MockERPAdapter implementation | 2 | 1 |
| 6 | ERP sync service | 1 | 2 |
| 7 | Web integration + endpoints | 0 | 3 |
| 8 | Integration tests | 1 | 0 |

**Total commits:** 8 (one per task)
**Test coverage:** types, WO status update, event builders, mock adapter, sync service, integration flow
