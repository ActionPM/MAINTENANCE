# Phase 11: Record Bundle Export (JSON) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build a read-only JSON export endpoint (`GET /work-orders/:id/record-bundle`) that assembles a tenant-copyable record bundle from a work order and its related events (spec §21, §24.1).

**Architecture:** The record bundle is a pure read-only assembly — no state transitions, no orchestrator involvement. A `RecordBundleAssembler` service queries the `WorkOrderRepository` and `NotificationRepository`, computes SLA metadata from `sla_policies.json`, and returns a structured `RecordBundle` object. The API route authenticates the tenant and verifies ownership before returning the bundle.

**Tech Stack:** TypeScript, Vitest, JSON Schema (AJV), Next.js API routes, `@wo-agent/schemas`, `@wo-agent/core`

---

## Design Decisions

1. **`conversation_id` on WorkOrder**: The `WorkOrder` type currently has no `conversation_id` field, but the record bundle needs it to query notification history. Rather than querying through `WorkOrderEvent` payloads (which adds complexity and couples to event internals), we add `conversation_id` directly to the `WorkOrder` schema and type. This is a natural field — every WO originates from a conversation.

2. **SLA computation**: SLA metadata is computed at read time (not stored), using `sla_policies.json` client defaults + overrides. The WO's `classification.Priority` field maps to SLA tiers. Due dates are derived from `created_at` + SLA hours.

3. **No new repository interfaces**: The assembler uses existing `WorkOrderRepository.getById()` and `NotificationRepository.queryByConversation()`. No new query methods needed.

4. **Factory pattern**: The `orchestrator-factory.ts` singleton currently owns the stores. We expose `getWorkOrderRepo()` and `getNotificationRepo()` getters so the record bundle route can access them without going through the orchestrator.

---

## Task 0: Add `conversation_id` to WorkOrder schema and type

**Files:**

- Modify: `packages/schemas/work_order.schema.json:41-110`
- Modify: `packages/schemas/src/types/work-order.ts:20-44`
- Modify: `packages/core/src/work-order/wo-creator.ts:45-91`
- Modify: `packages/core/src/work-order/event-builder.ts:4-9`
- Test: `packages/core/src/__tests__/work-order/wo-creator-conversation-id.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import { ConversationState } from '@wo-agent/schemas';
import type { ConversationSession } from '../../session/types.js';

describe('createWorkOrders — conversation_id', () => {
  it('sets conversation_id from session', () => {
    const session = makeSession();
    const workOrders = createWorkOrders({
      session,
      idGenerator: makeIdGenerator(),
      clock: () => '2026-03-04T00:00:00.000Z',
    });

    expect(workOrders).toHaveLength(1);
    expect(workOrders[0].conversation_id).toBe('conv-1');
  });
});

function makeIdGenerator() {
  let counter = 0;
  return () => `id-${++counter}`;
}

function makeSession(): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tenant-1',
    tenant_account_id: 'account-1',
    state: ConversationState.TENANT_CONFIRMATION_PENDING,
    unit_id: 'unit-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
    },
    split_issues: [
      { issue_id: 'issue-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet leaks' },
    ],
    classification_results: [
      {
        issue_id: 'issue-1',
        classifierOutput: {
          issue_id: 'issue-1',
          classification: { Category: 'maintenance', Priority: 'normal' },
          model_confidence: { Category: 0.9, Priority: 0.8 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.85, Priority: 0.75 },
        fieldsNeedingInput: [],
      },
    ],
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-03-04T00:00:00.000Z',
    last_activity_at: '2026-03-04T00:00:00.000Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: 'prop-1',
    client_id: 'client-1',
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
  };
}
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/work-order/wo-creator-conversation-id.test.ts`
Expected: FAIL — `conversation_id` does not exist on `WorkOrder`

**Step 3: Add `conversation_id` to the JSON schema**

In `packages/schemas/work_order.schema.json`, add `"conversation_id"` property to the `WorkOrder` definition and to the `required` array:

```json
"conversation_id": { "type": "string", "format": "uuid" },
```

Add `"conversation_id"` to the `required` array (after `"issue_id"`).

**Step 4: Add `conversation_id` to the TypeScript type**

In `packages/schemas/src/types/work-order.ts`, add to the `WorkOrder` interface after `issue_id`:

```typescript
readonly conversation_id: string;
```

**Step 5: Set `conversation_id` in `wo-creator.ts`**

In `packages/core/src/work-order/wo-creator.ts`, add to the WO object literal (after `issue_id`):

```typescript
conversation_id: session.conversation_id,
```

**Step 6: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/work-order/wo-creator-conversation-id.test.ts`
Expected: PASS

**Step 7: Run all existing WO tests to verify no regressions**

Run: `cd packages/core && npx vitest run src/__tests__/work-order/`
Expected: All PASS (existing tests create WOs which now also have `conversation_id`)

**Step 8: Fix any test failures from the schema change**

If existing tests fail because fixtures don't include `conversation_id`, add it to the fixtures. The `wo-creator` already reads `session.conversation_id` so existing test sessions already have it.

**Step 9: Commit**

```bash
git add packages/schemas/work_order.schema.json packages/schemas/src/types/work-order.ts packages/core/src/work-order/wo-creator.ts packages/core/src/__tests__/work-order/wo-creator-conversation-id.test.ts
git commit -m "feat(schemas): add conversation_id to WorkOrder (phase 11 prep)"
```

---

## Task 1: Create RecordBundle JSON schema

**Files:**

- Create: `packages/schemas/record_bundle.schema.json`

**Step 1: Create the schema file**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "record_bundle.schema.json",
  "definitions": {
    "SlaMetadata": {
      "type": "object",
      "properties": {
        "priority": { "type": "string" },
        "response_hours": { "type": "number" },
        "resolution_hours": { "type": "number" },
        "response_due_at": { "type": "string", "format": "date-time" },
        "resolution_due_at": { "type": "string", "format": "date-time" }
      },
      "required": [
        "priority",
        "response_hours",
        "resolution_hours",
        "response_due_at",
        "resolution_due_at"
      ],
      "additionalProperties": false
    },
    "CommunicationEntry": {
      "type": "object",
      "properties": {
        "notification_id": { "type": "string" },
        "channel": { "type": "string", "enum": ["in_app", "sms"] },
        "notification_type": { "type": "string" },
        "status": { "type": "string", "enum": ["pending", "sent", "delivered", "failed"] },
        "created_at": { "type": "string", "format": "date-time" },
        "sent_at": { "type": ["string", "null"], "format": "date-time" }
      },
      "required": [
        "notification_id",
        "channel",
        "notification_type",
        "status",
        "created_at",
        "sent_at"
      ],
      "additionalProperties": false
    },
    "ResolutionInfo": {
      "type": "object",
      "properties": {
        "resolved": { "type": "boolean" },
        "final_status": { "$ref": "work_order.schema.json#/definitions/WorkOrderStatus" },
        "resolved_at": { "type": ["string", "null"], "format": "date-time" }
      },
      "required": ["resolved", "final_status", "resolved_at"],
      "additionalProperties": false
    },
    "RecordBundle": {
      "type": "object",
      "properties": {
        "work_order_id": { "type": "string", "format": "uuid" },
        "conversation_id": { "type": "string", "format": "uuid" },
        "created_at": { "type": "string", "format": "date-time" },
        "unit_id": { "type": "string", "format": "uuid" },
        "summary": { "type": "string" },
        "classification": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "urgency_basis": {
          "type": "object",
          "properties": {
            "has_emergency": { "type": "boolean" },
            "highest_severity": { "type": ["string", "null"] },
            "trigger_ids": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": ["has_emergency", "highest_severity", "trigger_ids"],
          "additionalProperties": false
        },
        "status_history": {
          "type": "array",
          "items": { "$ref": "work_order.schema.json#/definitions/StatusHistoryEntry" }
        },
        "communications": {
          "type": "array",
          "items": { "$ref": "#/definitions/CommunicationEntry" }
        },
        "schedule": { "$ref": "#/definitions/SlaMetadata" },
        "resolution": { "$ref": "#/definitions/ResolutionInfo" },
        "exported_at": { "type": "string", "format": "date-time" }
      },
      "required": [
        "work_order_id",
        "conversation_id",
        "created_at",
        "unit_id",
        "summary",
        "classification",
        "urgency_basis",
        "status_history",
        "communications",
        "schedule",
        "resolution",
        "exported_at"
      ],
      "additionalProperties": false
    }
  }
}
```

**Step 2: Register schema in the AJV validator**

In `packages/schemas/src/validator.ts`, add `'record_bundle.schema.json'` to the `SCHEMA_FILES` array.

**Step 3: Commit**

```bash
git add packages/schemas/record_bundle.schema.json packages/schemas/src/validator.ts
git commit -m "feat(schemas): add record_bundle.schema.json (phase 11)"
```

---

## Task 2: Create RecordBundle TypeScript type and validator

**Files:**

- Create: `packages/schemas/src/types/record-bundle.ts`
- Create: `packages/schemas/src/validators/record-bundle.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/record-bundle-validator.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { validateRecordBundle } from '../validators/record-bundle.js';

describe('validateRecordBundle', () => {
  it('accepts a valid record bundle', () => {
    const bundle = {
      work_order_id: '00000000-0000-0000-0000-000000000001',
      conversation_id: '00000000-0000-0000-0000-000000000002',
      created_at: '2026-03-04T00:00:00.000Z',
      unit_id: '00000000-0000-0000-0000-000000000003',
      summary: 'Leaky faucet in kitchen',
      classification: { Category: 'maintenance', Priority: 'normal' },
      urgency_basis: { has_emergency: false, highest_severity: null, trigger_ids: [] },
      status_history: [
        { status: 'created', changed_at: '2026-03-04T00:00:00.000Z', actor: 'system' },
      ],
      communications: [],
      schedule: {
        priority: 'normal',
        response_hours: 24,
        resolution_hours: 168,
        response_due_at: '2026-03-05T00:00:00.000Z',
        resolution_due_at: '2026-03-11T00:00:00.000Z',
      },
      resolution: { resolved: false, final_status: 'created', resolved_at: null },
      exported_at: '2026-03-04T12:00:00.000Z',
    };
    const result = validateRecordBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(bundle);
  });

  it('rejects bundle missing required fields', () => {
    const result = validateRecordBundle({ work_order_id: 'not-a-uuid' });
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects bundle with invalid communication entry', () => {
    const bundle = {
      work_order_id: '00000000-0000-0000-0000-000000000001',
      conversation_id: '00000000-0000-0000-0000-000000000002',
      created_at: '2026-03-04T00:00:00.000Z',
      unit_id: '00000000-0000-0000-0000-000000000003',
      summary: 'Test',
      classification: {},
      urgency_basis: { has_emergency: false, highest_severity: null, trigger_ids: [] },
      status_history: [],
      communications: [{ notification_id: 'x', channel: 'pigeon' }],
      schedule: {
        priority: 'normal',
        response_hours: 24,
        resolution_hours: 168,
        response_due_at: '2026-03-05T00:00:00.000Z',
        resolution_due_at: '2026-03-11T00:00:00.000Z',
      },
      resolution: { resolved: false, final_status: 'created', resolved_at: null },
      exported_at: '2026-03-04T12:00:00.000Z',
    };
    const result = validateRecordBundle(bundle);
    expect(result.valid).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/schemas && npx vitest run src/__tests__/record-bundle-validator.test.ts`
Expected: FAIL — module not found

**Step 3: Create the TypeScript type**

Create `packages/schemas/src/types/record-bundle.ts`:

```typescript
import type { StatusHistoryEntry } from './work-order.js';
import type { WorkOrderStatus } from '../work-order-status.js';

export interface SlaMetadata {
  readonly priority: string;
  readonly response_hours: number;
  readonly resolution_hours: number;
  readonly response_due_at: string;
  readonly resolution_due_at: string;
}

export interface CommunicationEntry {
  readonly notification_id: string;
  readonly channel: 'in_app' | 'sms';
  readonly notification_type: string;
  readonly status: 'pending' | 'sent' | 'delivered' | 'failed';
  readonly created_at: string;
  readonly sent_at: string | null;
}

export interface ResolutionInfo {
  readonly resolved: boolean;
  readonly final_status: WorkOrderStatus;
  readonly resolved_at: string | null;
}

export interface RecordBundle {
  readonly work_order_id: string;
  readonly conversation_id: string;
  readonly created_at: string;
  readonly unit_id: string;
  readonly summary: string;
  readonly classification: Record<string, string>;
  readonly urgency_basis: {
    readonly has_emergency: boolean;
    readonly highest_severity: string | null;
    readonly trigger_ids: readonly string[];
  };
  readonly status_history: readonly StatusHistoryEntry[];
  readonly communications: readonly CommunicationEntry[];
  readonly schedule: SlaMetadata;
  readonly resolution: ResolutionInfo;
  readonly exported_at: string;
}
```

**Step 4: Create the validator**

Create `packages/schemas/src/validators/record-bundle.ts`:

```typescript
import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { RecordBundle } from '../types/record-bundle.js';

const BUNDLE_REF = 'record_bundle.schema.json#/definitions/RecordBundle';

export function validateRecordBundle(data: unknown): ValidationResult<RecordBundle> {
  return validate<RecordBundle>(data, BUNDLE_REF);
}
```

**Step 5: Export from barrel**

In `packages/schemas/src/index.ts`, add:

```typescript
export type {
  RecordBundle,
  SlaMetadata,
  CommunicationEntry,
  ResolutionInfo,
} from './types/record-bundle.js';

export { validateRecordBundle } from './validators/record-bundle.js';
```

**Step 6: Run test to verify it passes**

Run: `cd packages/schemas && npx vitest run src/__tests__/record-bundle-validator.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/schemas/src/types/record-bundle.ts packages/schemas/src/validators/record-bundle.ts packages/schemas/src/index.ts packages/schemas/src/__tests__/record-bundle-validator.test.ts
git commit -m "feat(schemas): add RecordBundle type and validator (phase 11)"
```

---

## Task 3: Implement SLA calculator

**Files:**

- Create: `packages/core/src/record-bundle/sla-calculator.ts`
- Create: `packages/core/src/record-bundle/types.ts`
- Test: `packages/core/src/__tests__/record-bundle/sla-calculator.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { computeSlaMetadata } from '../../record-bundle/sla-calculator.js';

const SLA_POLICIES = {
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

describe('computeSlaMetadata', () => {
  it('returns SLA for normal priority', () => {
    const result = computeSlaMetadata({
      priority: 'normal',
      classification: { Category: 'maintenance', Maintenance_Category: 'general_maintenance' },
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.priority).toBe('normal');
    expect(result.response_hours).toBe(24);
    expect(result.resolution_hours).toBe(168);
    expect(result.response_due_at).toBe('2026-03-05T12:00:00.000Z');
    expect(result.resolution_due_at).toBe('2026-03-11T12:00:00.000Z');
  });

  it('returns SLA for emergency priority', () => {
    const result = computeSlaMetadata({
      priority: 'emergency',
      classification: {},
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.priority).toBe('emergency');
    expect(result.response_hours).toBe(1);
    expect(result.resolution_hours).toBe(24);
  });

  it('applies taxonomy override when matching', () => {
    const result = computeSlaMetadata({
      priority: 'normal',
      classification: {
        Category: 'maintenance',
        Maintenance_Category: 'plumbing',
        Maintenance_Problem: 'flood',
      },
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.response_hours).toBe(1);
    expect(result.resolution_hours).toBe(12);
  });

  it('falls back to normal when priority unrecognized', () => {
    const result = computeSlaMetadata({
      priority: 'unknown_priority',
      classification: {},
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.priority).toBe('unknown_priority');
    expect(result.response_hours).toBe(24);
    expect(result.resolution_hours).toBe(168);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/record-bundle/sla-calculator.test.ts`
Expected: FAIL — module not found

**Step 3: Create the types file**

Create `packages/core/src/record-bundle/types.ts`:

```typescript
import type { WorkOrderRepository } from '../work-order/types.js';
import type { NotificationRepository } from '../notifications/types.js';

export interface SlaPolicyEntry {
  readonly response_hours: number;
  readonly resolution_hours: number;
}

export interface SlaOverride {
  readonly taxonomy_path: string;
  readonly response_hours: number;
  readonly resolution_hours: number;
}

export interface SlaPolicies {
  readonly version: string;
  readonly client_defaults: Record<string, SlaPolicyEntry>;
  readonly overrides: readonly SlaOverride[];
}

export interface RecordBundleDeps {
  readonly workOrderRepo: WorkOrderRepository;
  readonly notificationRepo: NotificationRepository;
  readonly slaPolicies: SlaPolicies;
  readonly clock: () => string;
}
```

**Step 4: Implement the SLA calculator**

Create `packages/core/src/record-bundle/sla-calculator.ts`:

```typescript
import type { SlaMetadata } from '@wo-agent/schemas';
import type { SlaPolicies } from './types.js';

export interface ComputeSlaInput {
  readonly priority: string;
  readonly classification: Record<string, string>;
  readonly createdAt: string;
  readonly slaPolicies: SlaPolicies;
}

/**
 * Compute SLA metadata for a work order (spec §22).
 * Checks taxonomy-path overrides first, then falls back to priority-based client defaults.
 */
export function computeSlaMetadata(input: ComputeSlaInput): SlaMetadata {
  const { priority, classification, createdAt, slaPolicies } = input;

  // 1. Check taxonomy-path overrides
  const taxonomyPath = buildTaxonomyPath(classification);
  const override = slaPolicies.overrides.find((o) => taxonomyPath.startsWith(o.taxonomy_path));

  let responseHours: number;
  let resolutionHours: number;

  if (override) {
    responseHours = override.response_hours;
    resolutionHours = override.resolution_hours;
  } else {
    // 2. Fall back to priority-based defaults (spec §22 — normal if unrecognized)
    const tier = slaPolicies.client_defaults[priority] ?? slaPolicies.client_defaults['normal'];
    responseHours = tier.response_hours;
    resolutionHours = tier.resolution_hours;
  }

  const createdMs = new Date(createdAt).getTime();

  return {
    priority,
    response_hours: responseHours,
    resolution_hours: resolutionHours,
    response_due_at: new Date(createdMs + responseHours * 3_600_000).toISOString(),
    resolution_due_at: new Date(createdMs + resolutionHours * 3_600_000).toISOString(),
  };
}

/**
 * Build a dotted taxonomy path from classification fields.
 * Example: { Category: 'maintenance', Maintenance_Category: 'plumbing', Maintenance_Problem: 'flood' }
 *       → 'maintenance.plumbing.flood'
 */
function buildTaxonomyPath(classification: Record<string, string>): string {
  const parts: string[] = [];
  if (classification['Category']) parts.push(classification['Category']);
  if (classification['Maintenance_Category']) parts.push(classification['Maintenance_Category']);
  if (classification['Maintenance_Object']) parts.push(classification['Maintenance_Object']);
  if (classification['Maintenance_Problem']) parts.push(classification['Maintenance_Problem']);
  if (classification['Management_Category']) parts.push(classification['Management_Category']);
  if (classification['Management_Object']) parts.push(classification['Management_Object']);
  return parts.join('.');
}
```

**Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/record-bundle/sla-calculator.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/record-bundle/types.ts packages/core/src/record-bundle/sla-calculator.ts packages/core/src/__tests__/record-bundle/sla-calculator.test.ts
git commit -m "feat(core): add SLA calculator for record bundles (phase 11)"
```

---

## Task 4: Implement RecordBundleAssembler

**Files:**

- Create: `packages/core/src/record-bundle/record-bundle-assembler.ts`
- Create: `packages/core/src/record-bundle/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/record-bundle/assembler.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { assembleRecordBundle } from '../../record-bundle/record-bundle-assembler.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryNotificationStore } from '../../notifications/in-memory-notification-store.js';
import type { WorkOrder, NotificationEvent } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import type { RecordBundleDeps } from '../../record-bundle/types.js';

describe('assembleRecordBundle', () => {
  let workOrderRepo: InMemoryWorkOrderStore;
  let notificationRepo: InMemoryNotificationStore;
  let deps: RecordBundleDeps;

  const NOW = '2026-03-04T12:00:00.000Z';

  const SLA_POLICIES = {
    version: '1.0.0',
    client_defaults: {
      emergency: { response_hours: 1, resolution_hours: 24 },
      high: { response_hours: 4, resolution_hours: 48 },
      normal: { response_hours: 24, resolution_hours: 168 },
      low: { response_hours: 48, resolution_hours: 336 },
    },
    overrides: [],
  };

  beforeEach(() => {
    workOrderRepo = new InMemoryWorkOrderStore();
    notificationRepo = new InMemoryNotificationStore();
    deps = {
      workOrderRepo,
      notificationRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => NOW,
    };
  });

  function makeWorkOrder(overrides?: Partial<WorkOrder>): WorkOrder {
    return {
      work_order_id: 'wo-1',
      conversation_id: 'conv-1',
      issue_group_id: 'group-1',
      issue_id: 'issue-1',
      client_id: 'client-1',
      property_id: 'prop-1',
      unit_id: 'unit-1',
      tenant_user_id: 'tenant-1',
      tenant_account_id: 'account-1',
      status: WorkOrderStatus.CREATED,
      status_history: [
        {
          status: WorkOrderStatus.CREATED,
          changed_at: '2026-03-04T00:00:00.000Z',
          actor: ActorType.SYSTEM,
        },
      ],
      raw_text: 'My faucet leaks',
      summary_confirmed: 'Leaky faucet in kitchen',
      photos: [],
      classification: { Category: 'maintenance', Priority: 'normal' },
      confidence_by_field: { Category: 0.9, Priority: 0.8 },
      missing_fields: [],
      pets_present: 'unknown',
      needs_human_triage: false,
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
      },
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
      row_version: 1,
      ...overrides,
    } as WorkOrder;
  }

  function makeNotification(overrides?: Partial<NotificationEvent>): NotificationEvent {
    return {
      event_id: 'notif-evt-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'tenant-1',
      tenant_account_id: 'account-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1'],
      issue_group_id: 'group-1',
      template_id: 'wo_created_in_app',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: { message: 'Your service request has been submitted.' },
      created_at: '2026-03-04T00:01:00.000Z',
      sent_at: '2026-03-04T00:01:00.000Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
      ...overrides,
    } as NotificationEvent;
  }

  it('returns null when WO not found', async () => {
    const result = await assembleRecordBundle('nonexistent', deps);
    expect(result).toBeNull();
  });

  it('assembles a complete record bundle', async () => {
    const wo = makeWorkOrder();
    await workOrderRepo.insertBatch([wo]);
    await notificationRepo.insert(makeNotification());

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle).not.toBeNull();
    expect(bundle!.work_order_id).toBe('wo-1');
    expect(bundle!.conversation_id).toBe('conv-1');
    expect(bundle!.created_at).toBe('2026-03-04T00:00:00.000Z');
    expect(bundle!.unit_id).toBe('unit-1');
    expect(bundle!.summary).toBe('Leaky faucet in kitchen');
    expect(bundle!.classification).toEqual({ Category: 'maintenance', Priority: 'normal' });
    expect(bundle!.urgency_basis).toEqual({
      has_emergency: false,
      highest_severity: null,
      trigger_ids: [],
    });
    expect(bundle!.status_history).toEqual(wo.status_history);
    expect(bundle!.communications).toHaveLength(1);
    expect(bundle!.communications[0].notification_id).toBe('notif-1');
    expect(bundle!.communications[0].channel).toBe('in_app');
    expect(bundle!.schedule.priority).toBe('normal');
    expect(bundle!.schedule.response_hours).toBe(24);
    expect(bundle!.resolution).toEqual({
      resolved: false,
      final_status: 'created',
      resolved_at: null,
    });
    expect(bundle!.exported_at).toBe(NOW);
  });

  it('handles WO with risk_flags', async () => {
    const wo = makeWorkOrder({
      risk_flags: {
        trigger_ids: ['flood-1'],
        highest_severity: 'high',
        has_emergency: false,
      },
    });
    await workOrderRepo.insertBatch([wo]);

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle!.urgency_basis.trigger_ids).toEqual(['flood-1']);
    expect(bundle!.urgency_basis.highest_severity).toBe('high');
    expect(bundle!.urgency_basis.has_emergency).toBe(false);
  });

  it('handles resolved WO', async () => {
    const wo = makeWorkOrder({
      status: WorkOrderStatus.RESOLVED,
      status_history: [
        {
          status: WorkOrderStatus.CREATED,
          changed_at: '2026-03-04T00:00:00.000Z',
          actor: ActorType.SYSTEM,
        },
        {
          status: WorkOrderStatus.ACTION_REQUIRED,
          changed_at: '2026-03-04T01:00:00.000Z',
          actor: ActorType.SYSTEM,
        },
        {
          status: WorkOrderStatus.RESOLVED,
          changed_at: '2026-03-04T10:00:00.000Z',
          actor: ActorType.PM_USER,
        },
      ],
    });
    await workOrderRepo.insertBatch([wo]);

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle!.resolution.resolved).toBe(true);
    expect(bundle!.resolution.final_status).toBe('resolved');
    expect(bundle!.resolution.resolved_at).toBe('2026-03-04T10:00:00.000Z');
  });

  it('assembles with zero notifications', async () => {
    await workOrderRepo.insertBatch([makeWorkOrder()]);

    const bundle = await assembleRecordBundle('wo-1', deps);

    expect(bundle!.communications).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/record-bundle/assembler.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the assembler**

Create `packages/core/src/record-bundle/record-bundle-assembler.ts`:

```typescript
import type {
  RecordBundle,
  CommunicationEntry,
  ResolutionInfo,
  NotificationEvent,
} from '@wo-agent/schemas';
import { WorkOrderStatus } from '@wo-agent/schemas';
import type { RecordBundleDeps } from './types.js';
import { computeSlaMetadata } from './sla-calculator.js';

const TERMINAL_STATUSES: readonly string[] = [WorkOrderStatus.RESOLVED, WorkOrderStatus.CANCELLED];

/**
 * Assemble a tenant-copyable record bundle for a work order (spec §21).
 * Pure read-only operation — no mutations, no side effects.
 * Returns null if the work order does not exist.
 */
export async function assembleRecordBundle(
  workOrderId: string,
  deps: RecordBundleDeps,
): Promise<RecordBundle | null> {
  const wo = await deps.workOrderRepo.getById(workOrderId);
  if (!wo) return null;

  // 1. Communications from notification events
  const notifications = await deps.notificationRepo.queryByConversation(wo.conversation_id);
  const communications: CommunicationEntry[] = notifications
    .filter((n) => n.work_order_ids.includes(workOrderId))
    .map(toCommunicationEntry);

  // 2. SLA schedule
  const priority = (wo.classification['Priority'] as string) ?? 'normal';
  const schedule = computeSlaMetadata({
    priority,
    classification: wo.classification,
    createdAt: wo.created_at,
    slaPolicies: deps.slaPolicies,
  });

  // 3. Resolution
  const resolution = computeResolution(wo.status, wo.status_history);

  // 4. Urgency basis from risk_flags
  const riskFlags = wo.risk_flags as Record<string, unknown> | undefined;
  const urgencyBasis = {
    has_emergency: (riskFlags?.['has_emergency'] as boolean) ?? false,
    highest_severity: (riskFlags?.['highest_severity'] as string) ?? null,
    trigger_ids: (riskFlags?.['trigger_ids'] as string[]) ?? [],
  };

  return {
    work_order_id: wo.work_order_id,
    conversation_id: wo.conversation_id,
    created_at: wo.created_at,
    unit_id: wo.unit_id,
    summary: wo.summary_confirmed,
    classification: wo.classification,
    urgency_basis: urgencyBasis,
    status_history: [...wo.status_history],
    communications,
    schedule,
    resolution,
    exported_at: deps.clock(),
  };
}

function toCommunicationEntry(n: NotificationEvent): CommunicationEntry {
  return {
    notification_id: n.notification_id,
    channel: n.channel,
    notification_type: n.notification_type,
    status: n.status,
    created_at: n.created_at,
    sent_at: n.sent_at,
  };
}

function computeResolution(
  currentStatus: string,
  statusHistory: readonly {
    readonly status: string;
    readonly changed_at: string;
    readonly actor: string;
  }[],
): ResolutionInfo {
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus);
  if (!isTerminal) {
    return {
      resolved: false,
      final_status: currentStatus as ResolutionInfo['final_status'],
      resolved_at: null,
    };
  }

  // Find the last entry with the terminal status
  const terminalEntry = [...statusHistory].reverse().find((e) => e.status === currentStatus);

  return {
    resolved: currentStatus === WorkOrderStatus.RESOLVED,
    final_status: currentStatus as ResolutionInfo['final_status'],
    resolved_at: terminalEntry?.changed_at ?? null,
  };
}
```

**Step 4: Create the barrel export**

Create `packages/core/src/record-bundle/index.ts`:

```typescript
export { assembleRecordBundle } from './record-bundle-assembler.js';
export { computeSlaMetadata } from './sla-calculator.js';
export type { ComputeSlaInput } from './sla-calculator.js';
export type { RecordBundleDeps, SlaPolicies, SlaPolicyEntry, SlaOverride } from './types.js';
```

**Step 5: Add to core barrel export**

In `packages/core/src/index.ts`, add at the end:

```typescript
// --- Record Bundle (Phase 11) ---
export { assembleRecordBundle, computeSlaMetadata } from './record-bundle/index.js';
export type {
  RecordBundleDeps,
  SlaPolicies,
  SlaPolicyEntry,
  SlaOverride,
  ComputeSlaInput,
} from './record-bundle/index.js';
```

**Step 6: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/record-bundle/assembler.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/core/src/record-bundle/ packages/core/src/index.ts packages/core/src/__tests__/record-bundle/assembler.test.ts
git commit -m "feat(core): add RecordBundleAssembler service (phase 11)"
```

---

## Task 5: Expose repos from orchestrator factory

**Files:**

- Modify: `apps/web/src/lib/orchestrator-factory.ts`

**Step 1: Read the current factory to understand the singleton structure**

The factory creates all stores inside `getOrchestrator()` and they're captured in closure. We need to extract the stores so the record bundle route can access them.

**Step 2: Refactor factory to expose repo getters**

In `apps/web/src/lib/orchestrator-factory.ts`, extract the stores to module-level variables and add getter functions. Add these after the existing imports:

```typescript
import {
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
  MockSmsSender,
  NotificationService,
} from '@wo-agent/core';
```

Replace the single `dispatcher` variable with a deps holder pattern:

```typescript
let _deps: {
  workOrderRepo: InMemoryWorkOrderStore;
  notificationRepo: InMemoryNotificationStore;
  dispatcher: ReturnType<typeof createDispatcher>;
} | null = null;

function ensureInitialized() {
  if (!_deps) {
    const workOrderRepo = new InMemoryWorkOrderStore();
    const notificationRepo = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();
    const eventRepo = new InMemoryEventStore();
    const idGenerator = () => randomUUID();
    const clock = () => new Date().toISOString();

    const notificationService = new NotificationService({
      notificationRepo,
      preferenceStore: prefStore,
      smsSender,
      idGenerator,
      clock,
    });

    const deps: OrchestratorDependencies = {
      eventRepo,
      sessionStore: new InMemorySessionStore(),
      idGenerator,
      clock,
      issueSplitter: async (input) => ({
        issues: [
          {
            issue_id: randomUUID(),
            summary: input.raw_text.slice(0, 200),
            raw_excerpt: input.raw_text,
          },
        ],
        issue_count: 1,
      }),
      issueClassifier: async (input: IssueClassifierInput) => ({
        issue_id: input.issue_id,
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'general',
          Maintenance_Category: 'general_maintenance',
          Maintenance_Object: 'other_object',
          Maintenance_Problem: 'not_working',
          Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj',
          Priority: 'normal',
        },
        model_confidence: {
          Category: 0.7,
          Location: 0.5,
          Sub_Location: 0.5,
          Maintenance_Category: 0.6,
          Maintenance_Object: 0.5,
          Maintenance_Problem: 0.5,
          Management_Category: 0.0,
          Management_Object: 0.0,
          Priority: 0.5,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: classificationCues as CueDictionary,
      taxonomy: loadTaxonomy(),
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: `prop-${unitId}`,
          client_id: `client-${unitId}`,
        }),
      } satisfies UnitResolver,
      workOrderRepo,
      idempotencyStore: new InMemoryIdempotencyStore(),
      notificationService,
    };

    _deps = {
      workOrderRepo,
      notificationRepo,
      dispatcher: createDispatcher(deps),
    };
  }
  return _deps;
}

export function getOrchestrator() {
  return ensureInitialized().dispatcher;
}

export function getWorkOrderRepo() {
  return ensureInitialized().workOrderRepo;
}

export function getNotificationRepo() {
  return ensureInitialized().notificationRepo;
}
```

Remove the old `dispatcher` variable and `getOrchestrator` function.

**Step 3: Verify existing routes still compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors — `getOrchestrator()` signature unchanged.

**Step 4: Commit**

```bash
git add apps/web/src/lib/orchestrator-factory.ts
git commit -m "refactor(web): expose repo getters from factory (phase 11)"
```

---

## Task 6: Create the API route `GET /work-orders/:id/record-bundle`

**Files:**

- Create: `apps/web/src/app/api/work-orders/[id]/record-bundle/route.ts`

**Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getWorkOrderRepo, getNotificationRepo } from '@/lib/orchestrator-factory';
import { assembleRecordBundle } from '@wo-agent/core';
import type { SlaPolicies } from '@wo-agent/core';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };

const slaPolicies = slaPoliciesJson as SlaPolicies;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 1. Auth
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  // 2. Ownership check — load WO first to verify tenant_user_id
  const workOrderRepo = getWorkOrderRepo();
  const wo = await workOrderRepo.getById(id);
  if (!wo) {
    return NextResponse.json(
      { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
      { status: 404 },
    );
  }
  if (wo.tenant_user_id !== authResult.tenant_user_id) {
    return NextResponse.json(
      { errors: [{ code: 'FORBIDDEN', message: 'Not authorized to view this work order' }] },
      { status: 403 },
    );
  }

  // 3. Assemble record bundle
  const bundle = await assembleRecordBundle(id, {
    workOrderRepo,
    notificationRepo: getNotificationRepo(),
    slaPolicies,
    clock: () => new Date().toISOString(),
  });

  // bundle should not be null since we already found the WO, but guard defensively
  if (!bundle) {
    return NextResponse.json(
      { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
      { status: 404 },
    );
  }

  return NextResponse.json(bundle);
}
```

**Step 2: Verify the import path for `sla_policies.json` works**

Check that `@wo-agent/schemas/sla_policies.json` is importable. If the `@wo-agent/schemas` package.json `exports` doesn't expose it, add a conditional export or use a direct relative path. The existing factory already imports `classification_cues.json` the same way, so follow that pattern.

If needed, add to `packages/schemas/package.json` exports:

```json
"./sla_policies.json": "./sla_policies.json"
```

**Step 3: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/web/src/app/api/work-orders/[id]/record-bundle/route.ts
git commit -m "feat(web): add GET /work-orders/:id/record-bundle route (phase 11)"
```

---

## Task 7: E2E integration test — full flow through assembler

**Files:**

- Create: `packages/core/src/__tests__/record-bundle/e2e-record-bundle.test.ts`

This test walks the full conversation flow (dispatch actions through the orchestrator) and then verifies the record bundle assembles correctly from the resulting work orders and notifications.

**Step 1: Write the E2E test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDispatcher,
  InMemoryEventStore,
  InMemoryWorkOrderStore,
  InMemoryIdempotencyStore,
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
  MockSmsSender,
  NotificationService,
  assembleRecordBundle,
  createSession,
} from '../../index.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import type { CueDictionary, IssueClassifierInput, UnitInfo } from '@wo-agent/schemas';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import { loadRiskProtocols, loadEscalationPlans } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import type { SlaPolicies } from '../../record-bundle/types.js';

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

describe('E2E: Record bundle through full intake flow', () => {
  let counter: number;
  let workOrderRepo: InMemoryWorkOrderStore;
  let notificationRepo: InMemoryNotificationStore;

  function makeId() {
    return `id-${++counter}`;
  }
  const clock = () => '2026-03-04T12:00:00.000Z';

  class InMemorySessionStore implements SessionStore {
    private sessions = new Map<string, ConversationSession>();
    async get(id: string) {
      return this.sessions.get(id) ?? null;
    }
    async getByTenantUser(userId: string) {
      return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
    }
    async save(session: ConversationSession) {
      this.sessions.set(session.conversation_id, session);
    }
  }

  function makeDeps(): OrchestratorDependencies {
    workOrderRepo = new InMemoryWorkOrderStore();
    notificationRepo = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();

    const notificationService = new NotificationService({
      notificationRepo,
      preferenceStore: prefStore,
      smsSender,
      idGenerator: makeId,
      clock,
    });

    return {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: makeId,
      clock,
      issueSplitter: async (input) => ({
        issues: [{ issue_id: makeId(), summary: 'Leaky faucet', raw_excerpt: input.raw_text }],
        issue_count: 1,
      }),
      issueClassifier: async (input: IssueClassifierInput) => ({
        issue_id: input.issue_id,
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'faucet',
          Maintenance_Problem: 'leak',
          Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj',
          Priority: 'normal',
        },
        model_confidence: {
          Category: 0.95,
          Location: 0.9,
          Sub_Location: 0.85,
          Maintenance_Category: 0.92,
          Maintenance_Object: 0.88,
          Maintenance_Problem: 0.9,
          Management_Category: 0.0,
          Management_Object: 0.0,
          Priority: 0.8,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: classificationCues as CueDictionary,
      taxonomy: loadTaxonomy(),
      unitResolver: {
        resolve: async (unitId: string): Promise<UnitInfo> => ({
          unit_id: unitId,
          property_id: 'prop-1',
          client_id: 'client-1',
        }),
      },
      workOrderRepo,
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: loadRiskProtocols(),
      escalationPlans: loadEscalationPlans(),
      contactExecutor: { execute: async () => ({ answered: false }) },
      notificationService,
    };
  }

  beforeEach(() => {
    counter = 0;
  });

  it('produces a valid record bundle after confirm-submission', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    // 1. Create conversation
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'tenant-1',
        tenant_account_id: 'account-1',
        authorized_unit_ids: ['unit-1'],
      },
    });
    const convId = r1.session.conversation_id;

    // 2. Select unit
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: {
        tenant_user_id: 'tenant-1',
        tenant_account_id: 'account-1',
        authorized_unit_ids: ['unit-1'],
      },
    });

    // 3. Submit initial message → triggers split + classification
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My kitchen faucet is leaking badly' },
      auth_context: {
        tenant_user_id: 'tenant-1',
        tenant_account_id: 'account-1',
        authorized_unit_ids: ['unit-1'],
      },
    });

    // 4. Confirm split
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'tenant-1',
        tenant_account_id: 'account-1',
        authorized_unit_ids: ['unit-1'],
      },
    });

    // 5. Confirm submission → creates WOs + notifications
    const r5 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'tenant-1',
        tenant_account_id: 'account-1',
        authorized_unit_ids: ['unit-1'],
      },
    });

    expect(r5.session.state).toBe(ConversationState.SUBMITTED);

    // 6. Find the created WO
    const allWos = await workOrderRepo.getByIssueGroup(r5.response.artifacts?.[0]?.ref ?? '');
    // Fallback: if artifacts don't expose it, scan by tenant
    const wos =
      allWos.length > 0
        ? allWos
        : [
            await workOrderRepo.getById(
              r5.response.pending_side_effects?.[0]?.idempotency_key ?? '',
            ),
          ].filter(Boolean);

    expect(wos.length).toBeGreaterThan(0);
    const woId = wos[0]!.work_order_id;

    // 7. Assemble record bundle
    const bundle = await assembleRecordBundle(woId, {
      workOrderRepo,
      notificationRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T13:00:00.000Z',
    });

    expect(bundle).not.toBeNull();
    expect(bundle!.work_order_id).toBe(woId);
    expect(bundle!.summary).toBe('Leaky faucet');
    expect(bundle!.unit_id).toBe('unit-1');
    expect(bundle!.schedule.priority).toBe('normal');
    expect(bundle!.status_history.length).toBeGreaterThanOrEqual(1);
    expect(bundle!.exported_at).toBe('2026-03-04T13:00:00.000Z');
  });
});
```

**Step 2: Run the E2E test**

Run: `cd packages/core && npx vitest run src/__tests__/record-bundle/e2e-record-bundle.test.ts`
Expected: PASS

Note: This test may need adjustments depending on how `confirm-submission` exposes created WO IDs in the response artifacts. If the WO IDs are not directly available in the response, query `workOrderRepo` using `getByIssueGroup` with the session's issue_group_id. Adapt accordingly.

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/record-bundle/e2e-record-bundle.test.ts
git commit -m "test(core): e2e integration test for record bundle (phase 11)"
```

---

## Task 8: Run full test suite and TypeScript checks

**Files:** None (validation only)

**Step 1: Run all core tests**

Run: `cd packages/core && npx vitest run`
Expected: All PASS

**Step 2: Run all schema tests**

Run: `cd packages/schemas && npx vitest run`
Expected: All PASS

**Step 3: TypeScript check across all packages**

Run: `npx tsc --noEmit -p packages/schemas/tsconfig.json && npx tsc --noEmit -p packages/core/tsconfig.json`
Expected: No errors

**Step 4: Fix any issues discovered**

If tests fail, fix the root cause. Common issues:

- Missing `conversation_id` in test fixtures for existing WO tests
- Import path issues for `sla_policies.json`
- Schema registration order in `validator.ts`

**Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(core): address test regressions from phase 11 changes"
```

---

## Task 9: Validate schema output with `validateRecordBundle`

**Files:**

- Modify: `packages/core/src/__tests__/record-bundle/assembler.test.ts`

**Step 1: Add schema validation to assembler test**

Add this test case to the existing `assembler.test.ts`:

```typescript
import { validateRecordBundle } from '@wo-agent/schemas';

it('assembler output passes JSON Schema validation', async () => {
  await workOrderRepo.insertBatch([makeWorkOrder()]);
  await notificationRepo.insert(makeNotification());

  const bundle = await assembleRecordBundle('wo-1', deps);

  const result = validateRecordBundle(bundle);
  expect(result.valid).toBe(true);
  if (!result.valid) {
    console.error('Validation errors:', result.errors);
  }
});
```

**Step 2: Run test**

Run: `cd packages/core && npx vitest run src/__tests__/record-bundle/assembler.test.ts`
Expected: PASS — the assembled bundle matches the JSON Schema

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/record-bundle/assembler.test.ts
git commit -m "test(core): validate assembler output against JSON Schema (phase 11)"
```

---

## Summary

| Task | What                                         | Files                                     |
| ---- | -------------------------------------------- | ----------------------------------------- |
| 0    | Add `conversation_id` to WorkOrder           | schema, type, wo-creator                  |
| 1    | Create RecordBundle JSON Schema              | `record_bundle.schema.json`, validator.ts |
| 2    | RecordBundle TypeScript type + validator     | type, validator, barrel                   |
| 3    | SLA calculator                               | `sla-calculator.ts` + tests               |
| 4    | RecordBundleAssembler                        | assembler + barrel + tests                |
| 5    | Expose repos from factory                    | `orchestrator-factory.ts`                 |
| 6    | API route GET /work-orders/:id/record-bundle | route.ts                                  |
| 7    | E2E integration test                         | e2e test                                  |
| 8    | Full test suite validation                   | verification                              |
| 9    | Schema validation of assembler output        | additional test                           |

**Skills referenced:**

- `@append-only-events` — event tables are INSERT+SELECT only
- `@schema-first-development` — JSON Schema validates all outputs
- `@project-conventions` — repo layout, naming, test patterns
- `@test-driven-development` — failing test first, then implementation
- `@state-machine-implementation` — record bundle is read-only, no state transitions involved
