# Phase 13: Analytics Slicing Endpoints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build a `GET /analytics` endpoint (spec §24.1) that computes MVP-lite dashboard metrics — WO volume, status distribution, taxonomy breakdown, SLA adherence, and notification delivery — sliceable by time range and tenant scope (client/property/unit).

**Architecture:** An `AnalyticsService` in `packages/core/src/analytics/` reads from extended `WorkOrderRepository` and `NotificationRepository` (new `listAll()` methods with filters), computes metrics in-memory, and returns a typed `AnalyticsResult`. The web layer exposes a single `GET /analytics` endpoint with query-parameter filtering. Reuses the existing `computeSlaMetadata` from the record-bundle module for SLA calculations.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing in-memory stores

**Prerequisite skills:**
- @append-only-events — event data is SELECT-only, never mutated
- @schema-first-development — analytics types are the contract
- @test-driven-development — TDD throughout
- @project-conventions — naming, file layout, barrel exports

---

### Task 0: Analytics Types (Core)

**Files:**
- Create: `packages/core/src/analytics/types.ts`
- Test: `packages/core/src/__tests__/analytics/analytics-types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/analytics-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from '../../analytics/types.js';

describe('Analytics types (Phase 13)', () => {
  it('AnalyticsQuery accepts all filter fields', () => {
    const query: AnalyticsQuery = {
      from: '2026-01-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
      client_id: 'c-1',
      property_id: 'p-1',
      unit_id: 'u-1',
    };
    expect(query.from).toBe('2026-01-01T00:00:00Z');
    expect(query.client_id).toBe('c-1');
  });

  it('AnalyticsQuery fields are all optional', () => {
    const empty: AnalyticsQuery = {};
    expect(empty.from).toBeUndefined();
  });

  it('OverviewMetrics has required fields', () => {
    const overview: OverviewMetrics = {
      total_work_orders: 10,
      by_status: { created: 3, action_required: 2, scheduled: 2, resolved: 2, cancelled: 1 },
      needs_human_triage: 1,
      has_emergency: 2,
    };
    expect(overview.total_work_orders).toBe(10);
  });

  it('TaxonomyBreakdown maps field to value counts', () => {
    const breakdown: TaxonomyBreakdown = {
      Category: { maintenance: 8, management: 2 },
      Priority: { normal: 5, high: 3, low: 2 },
    };
    expect(breakdown['Category']?.['maintenance']).toBe(8);
  });

  it('SlaMetrics computes adherence and averages', () => {
    const sla: SlaMetrics = {
      total_with_sla: 10,
      response_adherence_pct: 85.0,
      resolution_adherence_pct: 70.0,
      avg_response_hours: 6.5,
      avg_resolution_hours: 72.0,
    };
    expect(sla.response_adherence_pct).toBe(85.0);
  });

  it('NotificationMetrics tracks delivery', () => {
    const notif: NotificationMetrics = {
      total_sent: 20,
      by_channel: { in_app: 15, sms: 5 },
      by_type: { work_order_created: 10, status_changed: 7, needs_input: 3 },
      delivery_success_pct: 90.0,
    };
    expect(notif.total_sent).toBe(20);
  });

  it('AnalyticsResult composes all metrics', () => {
    const result: AnalyticsResult = {
      query: {},
      overview: {
        total_work_orders: 0,
        by_status: {},
        needs_human_triage: 0,
        has_emergency: 0,
      },
      taxonomy_breakdown: {},
      sla: {
        total_with_sla: 0,
        response_adherence_pct: 0,
        resolution_adherence_pct: 0,
        avg_response_hours: null,
        avg_resolution_hours: null,
      },
      notifications: {
        total_sent: 0,
        by_channel: {},
        by_type: {},
        delivery_success_pct: 0,
      },
      generated_at: '2026-03-04T12:00:00Z',
    };
    expect(result.generated_at).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-types.test.ts`
Expected: FAIL — cannot resolve `../../analytics/types.js`

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/analytics/types.ts

/**
 * Query filters for analytics endpoint (spec §24.1).
 * All fields optional — omitted fields mean "no filter".
 */
export interface AnalyticsQuery {
  /** ISO 8601 start of time range (inclusive). */
  readonly from?: string;
  /** ISO 8601 end of time range (exclusive). */
  readonly to?: string;
  /** Filter to specific client. */
  readonly client_id?: string;
  /** Filter to specific property. */
  readonly property_id?: string;
  /** Filter to specific unit. */
  readonly unit_id?: string;
}

/**
 * High-level WO counts and flags.
 */
export interface OverviewMetrics {
  readonly total_work_orders: number;
  readonly by_status: Readonly<Record<string, number>>;
  readonly needs_human_triage: number;
  readonly has_emergency: number;
}

/**
 * WO counts grouped by taxonomy classification fields.
 * Key = field name (e.g. "Category"), Value = { label: count }.
 */
export type TaxonomyBreakdown = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * SLA adherence metrics (spec §22 — MVP compute + report only).
 */
export interface SlaMetrics {
  readonly total_with_sla: number;
  readonly response_adherence_pct: number;
  readonly resolution_adherence_pct: number;
  readonly avg_response_hours: number | null;
  readonly avg_resolution_hours: number | null;
}

/**
 * Notification delivery metrics (spec §20).
 */
export interface NotificationMetrics {
  readonly total_sent: number;
  readonly by_channel: Readonly<Record<string, number>>;
  readonly by_type: Readonly<Record<string, number>>;
  readonly delivery_success_pct: number;
}

/**
 * Full analytics response returned by GET /analytics.
 */
export interface AnalyticsResult {
  readonly query: AnalyticsQuery;
  readonly overview: OverviewMetrics;
  readonly taxonomy_breakdown: TaxonomyBreakdown;
  readonly sla: SlaMetrics;
  readonly notifications: NotificationMetrics;
  readonly generated_at: string;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-types.test.ts`
Expected: PASS — all 7 type-check assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/analytics/types.ts packages/core/src/__tests__/analytics/analytics-types.test.ts
git commit -m "feat(core): add analytics types (phase 13)"
```

---

### Task 1: Extend WorkOrderRepository with listAll()

**Files:**
- Modify: `packages/core/src/work-order/types.ts:20-35` (add method to interface)
- Modify: `packages/core/src/work-order/in-memory-wo-store.ts` (implement)
- Test: `packages/core/src/__tests__/analytics/wo-list-all.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/wo-list-all.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import type { WorkOrder } from '@wo-agent/schemas';

function makeWO(overrides: Partial<WorkOrder> & { work_order_id: string }): WorkOrder {
  return {
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'conv-1',
    client_id: 'c-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('WorkOrderRepository.listAll (Phase 13)', () => {
  let store: InMemoryWorkOrderStore;

  beforeEach(() => {
    store = new InMemoryWorkOrderStore();
  });

  it('returns empty array when no WOs exist', async () => {
    const result = await store.listAll();
    expect(result).toEqual([]);
  });

  it('returns all WOs when no filters provided', async () => {
    await store.insertBatch([makeWO({ work_order_id: 'wo-1' }), makeWO({ work_order_id: 'wo-2' })]);
    const result = await store.listAll();
    expect(result).toHaveLength(2);
  });

  it('filters by client_id', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', client_id: 'c-1' }),
      makeWO({ work_order_id: 'wo-2', client_id: 'c-2' }),
    ]);
    const result = await store.listAll({ client_id: 'c-1' });
    expect(result).toHaveLength(1);
    expect(result[0]!.work_order_id).toBe('wo-1');
  });

  it('filters by property_id', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', property_id: 'p-1' }),
      makeWO({ work_order_id: 'wo-2', property_id: 'p-2' }),
    ]);
    const result = await store.listAll({ property_id: 'p-1' });
    expect(result).toHaveLength(1);
  });

  it('filters by unit_id', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', unit_id: 'u-1' }),
      makeWO({ work_order_id: 'wo-2', unit_id: 'u-2' }),
    ]);
    const result = await store.listAll({ unit_id: 'u-1' });
    expect(result).toHaveLength(1);
  });

  it('filters by time range (from inclusive, to exclusive)', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', created_at: '2026-01-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-2', created_at: '2026-02-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-3', created_at: '2026-03-15T00:00:00Z' }),
    ]);
    const result = await store.listAll({
      from: '2026-02-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.work_order_id).toBe('wo-2');
  });

  it('combines multiple filters', async () => {
    await store.insertBatch([
      makeWO({ work_order_id: 'wo-1', client_id: 'c-1', created_at: '2026-02-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-2', client_id: 'c-2', created_at: '2026-02-15T00:00:00Z' }),
      makeWO({ work_order_id: 'wo-3', client_id: 'c-1', created_at: '2026-04-15T00:00:00Z' }),
    ]);
    const result = await store.listAll({
      client_id: 'c-1',
      from: '2026-01-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.work_order_id).toBe('wo-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/wo-list-all.test.ts`
Expected: FAIL — `store.listAll is not a function`

**Step 3: Write minimal implementation**

Add to `packages/core/src/work-order/types.ts` — append `ListFilters` interface and new method to `WorkOrderRepository`:

```typescript
// Add BEFORE the WorkOrderRepository interface
/**
 * Filters for listing work orders (Phase 13 analytics).
 * All fields optional — omitted fields mean "no filter".
 */
export interface WorkOrderListFilters {
  readonly client_id?: string;
  readonly property_id?: string;
  readonly unit_id?: string;
  /** ISO 8601 start of time range (inclusive, compared to created_at). */
  readonly from?: string;
  /** ISO 8601 end of time range (exclusive, compared to created_at). */
  readonly to?: string;
}

// Add to WorkOrderRepository interface:
  /** List all WOs matching optional filters. Used by analytics (Phase 13). */
  listAll(filters?: WorkOrderListFilters): Promise<readonly WorkOrder[]>;
```

Add to `packages/core/src/work-order/in-memory-wo-store.ts`:

```typescript
import type { WorkOrderListFilters } from './types.js';

// Add method to InMemoryWorkOrderStore class:
  async listAll(filters?: WorkOrderListFilters): Promise<readonly WorkOrder[]> {
    let results = [...this.store.values()];

    if (filters?.client_id) {
      results = results.filter(wo => wo.client_id === filters.client_id);
    }
    if (filters?.property_id) {
      results = results.filter(wo => wo.property_id === filters.property_id);
    }
    if (filters?.unit_id) {
      results = results.filter(wo => wo.unit_id === filters.unit_id);
    }
    if (filters?.from) {
      const fromMs = new Date(filters.from).getTime();
      results = results.filter(wo => new Date(wo.created_at).getTime() >= fromMs);
    }
    if (filters?.to) {
      const toMs = new Date(filters.to).getTime();
      results = results.filter(wo => new Date(wo.created_at).getTime() < toMs);
    }

    return results;
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/wo-list-all.test.ts`
Expected: PASS — all 7 assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/work-order/types.ts packages/core/src/work-order/in-memory-wo-store.ts packages/core/src/__tests__/analytics/wo-list-all.test.ts
git commit -m "feat(core): add WorkOrderRepository.listAll with filters (phase 13)"
```

---

### Task 2: Extend NotificationRepository with listAll()

**Files:**
- Modify: `packages/core/src/notifications/types.ts:7-23` (add method to interface)
- Modify: `packages/core/src/notifications/in-memory-notification-store.ts` (implement)
- Test: `packages/core/src/__tests__/analytics/notif-list-all.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/notif-list-all.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { NotificationEvent } from '@wo-agent/schemas';

function makeNotif(overrides: Partial<NotificationEvent> & { event_id: string; notification_id: string }): NotificationEvent {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    channel: 'in_app',
    notification_type: 'work_order_created',
    work_order_ids: ['wo-1'],
    issue_group_id: null,
    template_id: 'tpl-1',
    status: 'sent',
    idempotency_key: `idem-${overrides.event_id}`,
    payload: {},
    created_at: '2026-03-01T10:00:00Z',
    sent_at: '2026-03-01T10:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('NotificationRepository.listAll (Phase 13)', () => {
  let store: InMemoryNotificationStore;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
  });

  it('returns empty array when no notifications exist', async () => {
    const result = await store.listAll();
    expect(result).toEqual([]);
  });

  it('returns all notifications when no filters', async () => {
    await store.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1' }));
    await store.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2' }));
    const result = await store.listAll();
    expect(result).toHaveLength(2);
  });

  it('filters by time range', async () => {
    await store.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1', created_at: '2026-01-15T00:00:00Z' }));
    await store.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2', created_at: '2026-02-15T00:00:00Z' }));
    await store.insert(makeNotif({ event_id: 'e-3', notification_id: 'n-3', created_at: '2026-03-15T00:00:00Z' }));
    const result = await store.listAll({
      from: '2026-02-01T00:00:00Z',
      to: '2026-03-01T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.event_id).toBe('e-2');
  });

  it('filters by tenant_user_id', async () => {
    await store.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1', tenant_user_id: 'tu-1' }));
    await store.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2', tenant_user_id: 'tu-2' }));
    const result = await store.listAll({ tenant_user_id: 'tu-1' });
    expect(result).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/notif-list-all.test.ts`
Expected: FAIL — `store.listAll is not a function`

**Step 3: Write minimal implementation**

Add to `packages/core/src/notifications/types.ts`:

```typescript
// Add before NotificationRepository interface
/**
 * Filters for listing notifications (Phase 13 analytics).
 */
export interface NotificationListFilters {
  readonly from?: string;
  readonly to?: string;
  readonly tenant_user_id?: string;
}

// Add to NotificationRepository interface:
  /** List all notifications matching optional filters. Used by analytics (Phase 13). */
  listAll(filters?: NotificationListFilters): Promise<readonly NotificationEvent[]>;
```

Add to `packages/core/src/notifications/in-memory-notification-store.ts`:

```typescript
import type { NotificationListFilters } from './types.js';

// Add method to InMemoryNotificationStore class:
  async listAll(filters?: NotificationListFilters): Promise<readonly NotificationEvent[]> {
    let results = [...this.events];

    if (filters?.tenant_user_id) {
      results = results.filter(e => e.tenant_user_id === filters.tenant_user_id);
    }
    if (filters?.from) {
      const fromMs = new Date(filters.from).getTime();
      results = results.filter(e => new Date(e.created_at).getTime() >= fromMs);
    }
    if (filters?.to) {
      const toMs = new Date(filters.to).getTime();
      results = results.filter(e => new Date(e.created_at).getTime() < toMs);
    }

    return results;
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/notif-list-all.test.ts`
Expected: PASS — all 4 assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/notifications/types.ts packages/core/src/notifications/in-memory-notification-store.ts packages/core/src/__tests__/analytics/notif-list-all.test.ts
git commit -m "feat(core): add NotificationRepository.listAll with filters (phase 13)"
```

---

### Task 3: Analytics Service — Overview Computation

**Files:**
- Create: `packages/core/src/analytics/analytics-service.ts`
- Test: `packages/core/src/__tests__/analytics/analytics-overview.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/analytics-overview.test.ts
import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    emergency: { response_hours: 1, resolution_hours: 24 },
    high: { response_hours: 4, resolution_hours: 48 },
    normal: { response_hours: 24, resolution_hours: 168 },
    low: { response_hours: 48, resolution_hours: 336 },
  },
  overrides: [],
};

function makeWO(overrides: Partial<WorkOrder> & { work_order_id: string }): WorkOrder {
  return {
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'conv-1',
    client_id: 'c-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('AnalyticsService.computeOverview (Phase 13)', () => {
  it('returns zeroes when no WOs exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });

    const result = await svc.compute({});
    expect(result.overview.total_work_orders).toBe(0);
    expect(result.overview.by_status).toEqual({});
    expect(result.overview.needs_human_triage).toBe(0);
    expect(result.overview.has_emergency).toBe(0);
  });

  it('counts total WOs and groups by status', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({ work_order_id: 'wo-1', status: 'created' }),
      makeWO({ work_order_id: 'wo-2', status: 'created' }),
      makeWO({ work_order_id: 'wo-3', status: 'resolved' }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.overview.total_work_orders).toBe(3);
    expect(result.overview.by_status).toEqual({ created: 2, resolved: 1 });
  });

  it('counts needs_human_triage and has_emergency', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({ work_order_id: 'wo-1', needs_human_triage: true }),
      makeWO({
        work_order_id: 'wo-2',
        risk_flags: { has_emergency: true, highest_severity: 'emergency', trigger_ids: ['fire-001'] },
      }),
      makeWO({ work_order_id: 'wo-3' }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.overview.needs_human_triage).toBe(1);
    expect(result.overview.has_emergency).toBe(1);
  });

  it('passes query filters through to repository', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({ work_order_id: 'wo-1', client_id: 'c-1' }),
      makeWO({ work_order_id: 'wo-2', client_id: 'c-2' }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({ client_id: 'c-1' });

    expect(result.overview.total_work_orders).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-overview.test.ts`
Expected: FAIL — cannot resolve `../../analytics/analytics-service.js`

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/analytics/analytics-service.ts
import type { WorkOrder } from '@wo-agent/schemas';
import type { WorkOrderRepository } from '../work-order/types.js';
import type { NotificationRepository } from '../notifications/types.js';
import type { SlaPolicies } from '../record-bundle/types.js';
import type {
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from './types.js';

export interface AnalyticsServiceDeps {
  readonly workOrderRepo: WorkOrderRepository;
  readonly notificationRepo: NotificationRepository;
  readonly slaPolicies: SlaPolicies;
  readonly clock: () => string;
}

export class AnalyticsService {
  private readonly deps: AnalyticsServiceDeps;

  constructor(deps: AnalyticsServiceDeps) {
    this.deps = deps;
  }

  async compute(query: AnalyticsQuery): Promise<AnalyticsResult> {
    const workOrders = await this.deps.workOrderRepo.listAll({
      client_id: query.client_id,
      property_id: query.property_id,
      unit_id: query.unit_id,
      from: query.from,
      to: query.to,
    });

    const notifications = await this.deps.notificationRepo.listAll({
      from: query.from,
      to: query.to,
    });

    return {
      query,
      overview: this.computeOverview(workOrders),
      taxonomy_breakdown: this.computeTaxonomyBreakdown(workOrders),
      sla: this.computeSlaMetrics(workOrders),
      notifications: this.computeNotificationMetrics(notifications),
      generated_at: this.deps.clock(),
    };
  }

  private computeOverview(workOrders: readonly WorkOrder[]): OverviewMetrics {
    const byStatus: Record<string, number> = {};
    let needsHumanTriage = 0;
    let hasEmergency = 0;

    for (const wo of workOrders) {
      byStatus[wo.status] = (byStatus[wo.status] ?? 0) + 1;
      if (wo.needs_human_triage) needsHumanTriage++;
      if (wo.risk_flags?.['has_emergency'] === true) hasEmergency++;
    }

    return {
      total_work_orders: workOrders.length,
      by_status: byStatus,
      needs_human_triage: needsHumanTriage,
      has_emergency: hasEmergency,
    };
  }

  // Stubs for later tasks — return empty defaults
  private computeTaxonomyBreakdown(_workOrders: readonly WorkOrder[]): TaxonomyBreakdown {
    return {};
  }

  private computeSlaMetrics(_workOrders: readonly WorkOrder[]): SlaMetrics {
    return { total_with_sla: 0, response_adherence_pct: 0, resolution_adherence_pct: 0, avg_response_hours: null, avg_resolution_hours: null };
  }

  private computeNotificationMetrics(_notifications: readonly import('@wo-agent/schemas').NotificationEvent[]): NotificationMetrics {
    return { total_sent: 0, by_channel: {}, by_type: {}, delivery_success_pct: 0 };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-overview.test.ts`
Expected: PASS — all 4 assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/analytics/analytics-service.ts packages/core/src/__tests__/analytics/analytics-overview.test.ts
git commit -m "feat(core): analytics service with overview metrics (phase 13)"
```

---

### Task 4: Analytics Service — Taxonomy Breakdown

**Files:**
- Modify: `packages/core/src/analytics/analytics-service.ts` (replace stub)
- Test: `packages/core/src/__tests__/analytics/analytics-taxonomy.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/analytics-taxonomy.test.ts
import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    normal: { response_hours: 24, resolution_hours: 168 },
  },
  overrides: [],
};

function makeWO(overrides: Partial<WorkOrder> & { work_order_id: string }): WorkOrder {
  return {
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'conv-1',
    client_id: 'c-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('AnalyticsService.computeTaxonomyBreakdown (Phase 13)', () => {
  it('returns empty object when no WOs exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });

    const result = await svc.compute({});
    expect(result.taxonomy_breakdown).toEqual({});
  });

  it('groups WOs by each classification field', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        classification: { Category: 'maintenance', Maintenance_Category: 'plumbing', Priority: 'high' },
      }),
      makeWO({
        work_order_id: 'wo-2',
        classification: { Category: 'maintenance', Maintenance_Category: 'electrical', Priority: 'normal' },
      }),
      makeWO({
        work_order_id: 'wo-3',
        classification: { Category: 'management', Management_Category: 'lease', Priority: 'normal' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 2, management: 1 });
    expect(result.taxonomy_breakdown['Maintenance_Category']).toEqual({ plumbing: 1, electrical: 1 });
    expect(result.taxonomy_breakdown['Management_Category']).toEqual({ lease: 1 });
    expect(result.taxonomy_breakdown['Priority']).toEqual({ high: 1, normal: 2 });
  });

  it('omits fields not present in any WO classification', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        classification: { Category: 'maintenance' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 1 });
    expect(result.taxonomy_breakdown['Location']).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-taxonomy.test.ts`
Expected: FAIL — taxonomy_breakdown returns `{}` (stub)

**Step 3: Write minimal implementation**

Replace the `computeTaxonomyBreakdown` stub in `analytics-service.ts`:

```typescript
  private computeTaxonomyBreakdown(workOrders: readonly WorkOrder[]): TaxonomyBreakdown {
    const result: Record<string, Record<string, number>> = {};

    for (const wo of workOrders) {
      for (const [field, value] of Object.entries(wo.classification)) {
        if (!result[field]) result[field] = {};
        result[field]![value] = (result[field]![value] ?? 0) + 1;
      }
    }

    return result;
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-taxonomy.test.ts`
Expected: PASS — all 3 assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/analytics/analytics-service.ts packages/core/src/__tests__/analytics/analytics-taxonomy.test.ts
git commit -m "feat(core): analytics taxonomy breakdown (phase 13)"
```

---

### Task 5: Analytics Service — SLA Metrics

**Files:**
- Modify: `packages/core/src/analytics/analytics-service.ts` (replace stub)
- Test: `packages/core/src/__tests__/analytics/analytics-sla.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/analytics-sla.test.ts
import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    normal: { response_hours: 24, resolution_hours: 168 },
    high: { response_hours: 4, resolution_hours: 48 },
  },
  overrides: [],
};

function makeWO(overrides: Partial<WorkOrder> & { work_order_id: string }): WorkOrder {
  return {
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'conv-1',
    client_id: 'c-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

describe('AnalyticsService.computeSlaMetrics (Phase 13)', () => {
  it('returns zeroes when no WOs exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });

    const result = await svc.compute({});
    expect(result.sla.total_with_sla).toBe(0);
    expect(result.sla.avg_response_hours).toBeNull();
    expect(result.sla.avg_resolution_hours).toBeNull();
  });

  it('computes 100% adherence when action_required within response SLA', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    // WO created at 10:00, action_required at 12:00 = 2 hours (within 24h normal SLA)
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        status: 'action_required',
        status_history: [
          { status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-03-01T12:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Priority: 'normal' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.sla.total_with_sla).toBe(1);
    expect(result.sla.response_adherence_pct).toBe(100);
    expect(result.sla.avg_response_hours).toBe(2);
  });

  it('computes response + resolution adherence for resolved WOs', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    // WO created at 10:00, action_required at 12:00 (2h), resolved at 34:00 (24h = within 168h)
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        status: 'resolved',
        status_history: [
          { status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-03-01T12:00:00Z', actor: 'system' },
          { status: 'resolved', changed_at: '2026-03-02T10:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Priority: 'normal' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.sla.response_adherence_pct).toBe(100);
    expect(result.sla.resolution_adherence_pct).toBe(100);
    expect(result.sla.avg_response_hours).toBe(2);
    expect(result.sla.avg_resolution_hours).toBe(24);
  });

  it('detects SLA breach when response exceeds threshold', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    // High priority: 4h response SLA. Actual: 6h → breach
    await woRepo.insertBatch([
      makeWO({
        work_order_id: 'wo-1',
        status: 'action_required',
        status_history: [
          { status: 'created', changed_at: '2026-03-01T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-03-01T16:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Priority: 'high' },
      }),
    ]);

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.sla.response_adherence_pct).toBe(0);
    expect(result.sla.avg_response_hours).toBe(6);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-sla.test.ts`
Expected: FAIL — sla.total_with_sla returns 0 (stub)

**Step 3: Write minimal implementation**

Replace the `computeSlaMetrics` stub in `analytics-service.ts`:

```typescript
import { computeSlaMetadata } from '../record-bundle/sla-calculator.js';

  private computeSlaMetrics(workOrders: readonly WorkOrder[]): SlaMetrics {
    if (workOrders.length === 0) {
      return { total_with_sla: 0, response_adherence_pct: 0, resolution_adherence_pct: 0, avg_response_hours: null, avg_resolution_hours: null };
    }

    let totalWithSla = 0;
    let responseMetCount = 0;
    let resolutionMetCount = 0;
    let totalResponseHours = 0;
    let responseCount = 0;
    let totalResolutionHours = 0;
    let resolutionCount = 0;

    for (const wo of workOrders) {
      const priority = wo.classification['Priority'] ?? 'normal';
      const sla = computeSlaMetadata({
        priority,
        classification: wo.classification,
        createdAt: wo.created_at,
        slaPolicies: this.deps.slaPolicies,
      });

      // Find first non-"created" status transition for response time
      const createdMs = new Date(wo.created_at).getTime();
      const firstResponse = wo.status_history.find(
        (e) => e.status !== 'created',
      );

      if (firstResponse) {
        totalWithSla++;
        const responseMs = new Date(firstResponse.changed_at).getTime() - createdMs;
        const responseHours = responseMs / 3_600_000;
        totalResponseHours += responseHours;
        responseCount++;
        if (responseHours <= sla.response_hours) responseMetCount++;
      }

      // Find terminal status (resolved/cancelled) for resolution time
      const terminal = wo.status_history.find(
        (e) => e.status === 'resolved' || e.status === 'cancelled',
      );
      if (terminal) {
        if (!firstResponse) totalWithSla++;
        const resolutionMs = new Date(terminal.changed_at).getTime() - createdMs;
        const resolutionHours = resolutionMs / 3_600_000;
        totalResolutionHours += resolutionHours;
        resolutionCount++;
        if (resolutionHours <= sla.resolution_hours) resolutionMetCount++;
      }
    }

    return {
      total_with_sla: totalWithSla,
      response_adherence_pct: responseCount > 0
        ? Math.round((responseMetCount / responseCount) * 100 * 100) / 100
        : 0,
      resolution_adherence_pct: resolutionCount > 0
        ? Math.round((resolutionMetCount / resolutionCount) * 100 * 100) / 100
        : 0,
      avg_response_hours: responseCount > 0
        ? Math.round(totalResponseHours / responseCount * 100) / 100
        : null,
      avg_resolution_hours: resolutionCount > 0
        ? Math.round(totalResolutionHours / resolutionCount * 100) / 100
        : null,
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-sla.test.ts`
Expected: PASS — all 4 assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/analytics/analytics-service.ts packages/core/src/__tests__/analytics/analytics-sla.test.ts
git commit -m "feat(core): analytics SLA adherence metrics (phase 13)"
```

---

### Task 6: Analytics Service — Notification Metrics

**Files:**
- Modify: `packages/core/src/analytics/analytics-service.ts` (replace stub)
- Test: `packages/core/src/__tests__/analytics/analytics-notifications.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/analytics-notifications.test.ts
import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { NotificationEvent } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: { normal: { response_hours: 24, resolution_hours: 168 } },
  overrides: [],
};

function makeNotif(overrides: Partial<NotificationEvent> & { event_id: string; notification_id: string }): NotificationEvent {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    channel: 'in_app',
    notification_type: 'work_order_created',
    work_order_ids: ['wo-1'],
    issue_group_id: null,
    template_id: 'tpl-1',
    status: 'sent',
    idempotency_key: `idem-${overrides.event_id}`,
    payload: {},
    created_at: '2026-03-01T10:00:00Z',
    sent_at: '2026-03-01T10:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('AnalyticsService.computeNotificationMetrics (Phase 13)', () => {
  it('returns zeroes when no notifications exist', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });

    const result = await svc.compute({});
    expect(result.notifications.total_sent).toBe(0);
    expect(result.notifications.by_channel).toEqual({});
    expect(result.notifications.delivery_success_pct).toBe(0);
  });

  it('counts by channel and type', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await notifRepo.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1', channel: 'in_app', notification_type: 'work_order_created' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2', channel: 'sms', notification_type: 'status_changed' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-3', notification_id: 'n-3', channel: 'in_app', notification_type: 'needs_input' }));

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.notifications.total_sent).toBe(3);
    expect(result.notifications.by_channel).toEqual({ in_app: 2, sms: 1 });
    expect(result.notifications.by_type).toEqual({ work_order_created: 1, status_changed: 1, needs_input: 1 });
  });

  it('computes delivery success percentage', async () => {
    const woRepo = new InMemoryWorkOrderStore();
    const notifRepo = new InMemoryNotificationStore();
    await notifRepo.insert(makeNotif({ event_id: 'e-1', notification_id: 'n-1', status: 'delivered' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-2', notification_id: 'n-2', status: 'delivered' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-3', notification_id: 'n-3', status: 'sent' }));
    await notifRepo.insert(makeNotif({ event_id: 'e-4', notification_id: 'n-4', status: 'failed' }));

    const svc = new AnalyticsService({ workOrderRepo: woRepo, notificationRepo: notifRepo, slaPolicies: SLA_POLICIES, clock: () => '2026-03-04T12:00:00Z' });
    const result = await svc.compute({});

    expect(result.notifications.total_sent).toBe(4);
    // delivered + sent = 3 success out of 4 total = 75%
    expect(result.notifications.delivery_success_pct).toBe(75);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-notifications.test.ts`
Expected: FAIL — notifications.total_sent returns 0 (stub)

**Step 3: Write minimal implementation**

Replace the `computeNotificationMetrics` stub in `analytics-service.ts`:

```typescript
import type { NotificationEvent } from '@wo-agent/schemas';

  private computeNotificationMetrics(notifications: readonly NotificationEvent[]): NotificationMetrics {
    if (notifications.length === 0) {
      return { total_sent: 0, by_channel: {}, by_type: {}, delivery_success_pct: 0 };
    }

    const byChannel: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let successCount = 0;

    for (const n of notifications) {
      byChannel[n.channel] = (byChannel[n.channel] ?? 0) + 1;
      byType[n.notification_type] = (byType[n.notification_type] ?? 0) + 1;
      if (n.status === 'delivered' || n.status === 'sent') successCount++;
    }

    return {
      total_sent: notifications.length,
      by_channel: byChannel,
      by_type: byType,
      delivery_success_pct: Math.round((successCount / notifications.length) * 100 * 100) / 100,
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-notifications.test.ts`
Expected: PASS — all 3 assertions pass

**Step 5: Commit**

```bash
git add packages/core/src/analytics/analytics-service.ts packages/core/src/__tests__/analytics/analytics-notifications.test.ts
git commit -m "feat(core): analytics notification metrics (phase 13)"
```

---

### Task 7: Analytics Core Barrel + Exports

**Files:**
- Create: `packages/core/src/analytics/index.ts`
- Modify: `packages/core/src/index.ts` (add analytics exports)
- Modify: `packages/core/src/work-order/index.ts` (export WorkOrderListFilters)
- Modify: `packages/core/src/notifications/index.ts` (export NotificationListFilters)

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/analytics/analytics-barrel.test.ts
import { describe, it, expect } from 'vitest';
import {
  AnalyticsService,
} from '@wo-agent/core';
import type {
  AnalyticsServiceDeps,
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from '@wo-agent/core';

describe('Analytics barrel exports (Phase 13)', () => {
  it('exports AnalyticsService class', () => {
    expect(AnalyticsService).toBeDefined();
  });

  it('AnalyticsServiceDeps type is importable', () => {
    const deps: Partial<AnalyticsServiceDeps> = {};
    expect(deps).toBeDefined();
  });

  it('all result types are importable', () => {
    const q: Partial<AnalyticsQuery> = {};
    const r: Partial<AnalyticsResult> = {};
    const o: Partial<OverviewMetrics> = {};
    const t: Partial<TaxonomyBreakdown> = {};
    const s: Partial<SlaMetrics> = {};
    const n: Partial<NotificationMetrics> = {};
    expect([q, r, o, t, s, n]).toHaveLength(6);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-barrel.test.ts`
Expected: FAIL — `AnalyticsService` not exported from `@wo-agent/core`

**Step 3: Write minimal implementation**

Create barrel:

```typescript
// packages/core/src/analytics/index.ts
export { AnalyticsService } from './analytics-service.js';
export type { AnalyticsServiceDeps } from './analytics-service.js';
export type {
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from './types.js';
```

Add to `packages/core/src/index.ts` (at the end, before orchestrator section or after ERP):

```typescript
// --- Analytics (Phase 13) ---
export { AnalyticsService } from './analytics/index.js';
export type {
  AnalyticsServiceDeps,
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from './analytics/index.js';
```

Also export `WorkOrderListFilters` from work-order barrel and `NotificationListFilters` from notifications barrel if not already exported.

Check and update `packages/core/src/work-order/index.ts` to include:
```typescript
export type { WorkOrderListFilters } from './types.js';
```

Check and update `packages/core/src/notifications/index.ts` to include:
```typescript
export type { NotificationListFilters } from './types.js';
```

Add to `packages/core/src/index.ts` work-order exports:
```typescript
export type { WorkOrderListFilters } from './work-order/index.js';
```

Add to `packages/core/src/index.ts` notifications exports:
```typescript
export type { NotificationListFilters } from './notifications/index.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-barrel.test.ts`
Expected: PASS — all 3 assertions pass

**Step 5: Run all analytics tests**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/`
Expected: PASS — all tests in the analytics directory pass

**Step 6: Commit**

```bash
git add packages/core/src/analytics/index.ts packages/core/src/index.ts packages/core/src/work-order/index.ts packages/core/src/notifications/index.ts packages/core/src/__tests__/analytics/analytics-barrel.test.ts
git commit -m "feat(core): analytics barrel exports (phase 13)"
```

---

### Task 8: API Endpoint + Factory Wiring

**Files:**
- Create: `apps/web/src/app/api/analytics/route.ts`
- Modify: `apps/web/src/lib/orchestrator-factory.ts` (add analytics service)
- Test: `apps/web/src/app/api/analytics/__tests__/analytics-route.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/app/api/analytics/__tests__/analytics-route.test.ts
import { describe, it, expect } from 'vitest';
import { GET } from '../route.js';

describe('GET /api/analytics (Phase 13)', () => {
  it('returns 200 with analytics result', async () => {
    const req = new Request('http://localhost:3000/api/analytics');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('overview');
    expect(body).toHaveProperty('taxonomy_breakdown');
    expect(body).toHaveProperty('sla');
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('generated_at');
    expect(body.overview).toHaveProperty('total_work_orders');
  });

  it('accepts query parameters for filtering', async () => {
    const req = new Request('http://localhost:3000/api/analytics?client_id=c-1&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query.client_id).toBe('c-1');
    expect(body.query.from).toBe('2026-01-01T00:00:00Z');
    expect(body.query.to).toBe('2026-03-01T00:00:00Z');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run src/app/api/analytics/__tests__/analytics-route.test.ts`
Expected: FAIL — cannot resolve `../route.js`

**Step 3: Write minimal implementation**

Wire analytics into factory — add to `apps/web/src/lib/orchestrator-factory.ts`:

```typescript
import { AnalyticsService } from '@wo-agent/core';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };
import type { SlaPolicies } from '@wo-agent/core';

// Inside ensureInitialized(), after erpSyncService creation:
    const analyticsService = new AnalyticsService({
      workOrderRepo,
      notificationRepo,
      slaPolicies: slaPoliciesJson as SlaPolicies,
      clock,
    });

// Add analyticsService to _deps object
// Add getter function:
export function getAnalyticsService() {
  return ensureInitialized().analyticsService;
}
```

Create route:

```typescript
// apps/web/src/app/api/analytics/route.ts
import { NextResponse } from 'next/server';
import { getAnalyticsService } from '../../../lib/orchestrator-factory.js';
import type { AnalyticsQuery } from '@wo-agent/core';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const query: AnalyticsQuery = {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    client_id: url.searchParams.get('client_id') ?? undefined,
    property_id: url.searchParams.get('property_id') ?? undefined,
    unit_id: url.searchParams.get('unit_id') ?? undefined,
  };

  const result = await getAnalyticsService().compute(query);
  return NextResponse.json(result);
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run src/app/api/analytics/__tests__/analytics-route.test.ts`
Expected: PASS — both assertions pass

**Step 5: Commit**

```bash
git add apps/web/src/app/api/analytics/route.ts apps/web/src/lib/orchestrator-factory.ts apps/web/src/app/api/analytics/__tests__/analytics-route.test.ts
git commit -m "feat(web): wire analytics endpoint GET /api/analytics (phase 13)"
```

---

### Task 9: Integration Test — Full Analytics Flow

**Files:**
- Create: `packages/core/src/__tests__/analytics/analytics-integration.test.ts`

**Step 1: Write the integration test**

```typescript
// packages/core/src/__tests__/analytics/analytics-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsService } from '../../analytics/analytics-service.js';
import { InMemoryWorkOrderStore } from '../../work-order/index.js';
import { InMemoryNotificationStore } from '../../notifications/index.js';
import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/index.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    emergency: { response_hours: 1, resolution_hours: 24 },
    high: { response_hours: 4, resolution_hours: 48 },
    normal: { response_hours: 24, resolution_hours: 168 },
    low: { response_hours: 48, resolution_hours: 336 },
  },
  overrides: [
    { taxonomy_path: 'maintenance.plumbing.flood', response_hours: 1, resolution_hours: 12 },
  ],
};

const PINNED = { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' };

function makeWO(overrides: Partial<WorkOrder> & { work_order_id: string }): WorkOrder {
  return {
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'conv-1',
    client_id: 'c-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-02-15T10:00:00Z', actor: 'system' }],
    raw_text: 'test',
    summary_confirmed: 'test',
    photos: [],
    classification: { Category: 'maintenance', Priority: 'normal' },
    confidence_by_field: {},
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: PINNED,
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    row_version: 0,
    ...overrides,
  };
}

function makeNotif(overrides: Partial<NotificationEvent> & { event_id: string; notification_id: string }): NotificationEvent {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    channel: 'in_app',
    notification_type: 'work_order_created',
    work_order_ids: ['wo-1'],
    issue_group_id: null,
    template_id: 'tpl-1',
    status: 'sent',
    idempotency_key: `idem-${overrides.event_id}`,
    payload: {},
    created_at: '2026-02-15T10:00:00Z',
    sent_at: '2026-02-15T10:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('Analytics integration (Phase 13)', () => {
  let woRepo: InMemoryWorkOrderStore;
  let notifRepo: InMemoryNotificationStore;
  let svc: AnalyticsService;

  beforeEach(async () => {
    woRepo = new InMemoryWorkOrderStore();
    notifRepo = new InMemoryNotificationStore();
    svc = new AnalyticsService({
      workOrderRepo: woRepo,
      notificationRepo: notifRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T12:00:00Z',
    });

    // Seed realistic data
    await woRepo.insertBatch([
      // Plumbing emergency, resolved quickly — client c-1, property p-1
      makeWO({
        work_order_id: 'wo-1',
        client_id: 'c-1',
        property_id: 'p-1',
        status: 'resolved',
        status_history: [
          { status: 'created', changed_at: '2026-02-15T10:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-02-15T10:30:00Z', actor: 'system' },
          { status: 'resolved', changed_at: '2026-02-15T14:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Maintenance_Category: 'plumbing', Priority: 'high' },
        risk_flags: { has_emergency: true, highest_severity: 'emergency', trigger_ids: ['flood-001'] },
        created_at: '2026-02-15T10:00:00Z',
      }),
      // Electrical, still in progress — client c-1, property p-2
      makeWO({
        work_order_id: 'wo-2',
        client_id: 'c-1',
        property_id: 'p-2',
        status: 'action_required',
        status_history: [
          { status: 'created', changed_at: '2026-02-20T08:00:00Z', actor: 'system' },
          { status: 'action_required', changed_at: '2026-02-20T10:00:00Z', actor: 'system' },
        ],
        classification: { Category: 'maintenance', Maintenance_Category: 'electrical', Priority: 'normal' },
        created_at: '2026-02-20T08:00:00Z',
      }),
      // Management issue, needs triage — client c-2
      makeWO({
        work_order_id: 'wo-3',
        client_id: 'c-2',
        property_id: 'p-3',
        status: 'created',
        classification: { Category: 'management', Management_Category: 'lease', Priority: 'low' },
        needs_human_triage: true,
        created_at: '2026-02-25T12:00:00Z',
      }),
    ]);

    await notifRepo.insert(makeNotif({
      event_id: 'ne-1', notification_id: 'n-1',
      channel: 'in_app', notification_type: 'work_order_created',
      status: 'delivered', work_order_ids: ['wo-1'],
      created_at: '2026-02-15T10:00:05Z',
    }));
    await notifRepo.insert(makeNotif({
      event_id: 'ne-2', notification_id: 'n-2',
      channel: 'sms', notification_type: 'status_changed',
      status: 'sent', work_order_ids: ['wo-1'],
      created_at: '2026-02-15T14:00:05Z',
    }));
    await notifRepo.insert(makeNotif({
      event_id: 'ne-3', notification_id: 'n-3',
      channel: 'in_app', notification_type: 'work_order_created',
      status: 'failed', work_order_ids: ['wo-2'],
      created_at: '2026-02-20T08:00:05Z',
    }));
  });

  it('full analytics response has correct structure', async () => {
    const result = await svc.compute({});

    expect(result.query).toEqual({});
    expect(result.generated_at).toBe('2026-03-04T12:00:00Z');

    // Overview
    expect(result.overview.total_work_orders).toBe(3);
    expect(result.overview.by_status).toEqual({ resolved: 1, action_required: 1, created: 1 });
    expect(result.overview.needs_human_triage).toBe(1);
    expect(result.overview.has_emergency).toBe(1);

    // Taxonomy
    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 2, management: 1 });
    expect(result.taxonomy_breakdown['Maintenance_Category']).toEqual({ plumbing: 1, electrical: 1 });
    expect(result.taxonomy_breakdown['Priority']).toEqual({ high: 1, normal: 1, low: 1 });

    // Notifications
    expect(result.notifications.total_sent).toBe(3);
    expect(result.notifications.by_channel).toEqual({ in_app: 2, sms: 1 });
    expect(result.notifications.delivery_success_pct).toBeCloseTo(66.67, 0);
  });

  it('client_id filter narrows results', async () => {
    const result = await svc.compute({ client_id: 'c-1' });
    expect(result.overview.total_work_orders).toBe(2);
    expect(result.overview.has_emergency).toBe(1);
    expect(result.taxonomy_breakdown['Category']).toEqual({ maintenance: 2 });
  });

  it('time range filter works', async () => {
    const result = await svc.compute({
      from: '2026-02-18T00:00:00Z',
      to: '2026-02-28T00:00:00Z',
    });
    // Only wo-2 (Feb 20) and wo-3 (Feb 25) in range
    expect(result.overview.total_work_orders).toBe(2);
  });

  it('SLA metrics compute correctly across mixed statuses', async () => {
    const result = await svc.compute({});

    // wo-1: response 0.5h (within 4h high SLA) ✓, resolution 4h (within 48h) ✓
    // wo-2: response 2h (within 24h normal SLA) ✓, no resolution yet
    // wo-3: no response transition yet — only 'created'
    expect(result.sla.total_with_sla).toBe(2);
    expect(result.sla.response_adherence_pct).toBe(100);
    expect(result.sla.resolution_adherence_pct).toBe(100);
    expect(result.sla.avg_response_hours).toBe(1.25); // (0.5 + 2) / 2
    expect(result.sla.avg_resolution_hours).toBe(4); // only wo-1 resolved
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/analytics/analytics-integration.test.ts`
Expected: PASS — all 4 integration assertions pass

**Step 3: Run ALL tests across the repo**

Run: `pnpm -r test`
Expected: All existing tests still pass + all new analytics tests pass

**Step 4: Commit**

```bash
git add packages/core/src/__tests__/analytics/analytics-integration.test.ts
git commit -m "test(core): analytics integration tests — full dashboard flow (phase 13)"
```

---

### Task 10: Run Full Test Suite + Final Verification

**Files:** None (verification only)

**Step 1: Run all core tests**

Run: `cd packages/core && pnpm vitest run`
Expected: All tests pass (existing + new analytics)

**Step 2: Run all web tests**

Run: `cd apps/web && pnpm vitest run`
Expected: All tests pass (existing + new analytics route)

**Step 3: Run TypeScript type checks**

Run: `pnpm -r exec tsc --noEmit`
Expected: No type errors

**Step 4: Verify endpoint manually (optional)**

Run: `cd apps/web && pnpm dev &` then `curl http://localhost:3000/api/analytics | jq`
Expected: JSON response with overview, taxonomy_breakdown, sla, notifications sections

**Step 5: Final commit (if any fixes needed)**

If everything passes, no commit needed. If fixes were required, commit them:

```bash
git commit -m "fix(core): address review feedback for analytics (phase 13)"
```
