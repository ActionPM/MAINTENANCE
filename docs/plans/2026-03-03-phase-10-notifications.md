# Phase 10: Notifications (Batch/Dedupe/Prefs/Consent) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build the Notification Service with in-app + outbound SMS channels, notification preferences with SMS consent tracking, batched multi-WO notifications, and idempotency-based deduplication (spec §20, §7, §24.1).

**Architecture:** The notification system is a pure service injected into the orchestrator via `OrchestratorDependencies`. It receives notification requests from the `confirm-submission` handler after WO creation, batches multi-issue creations into a single "created" notification per issue group, deduplicates via idempotency keys + cooldown windows, and respects per-tenant preferences and SMS consent. All notifications are recorded as append-only `NotificationEvent` rows. Two channels: in-app (always on) and SMS (off by default until consent given). The notification service never mutates — it only appends events and queries preferences.

**Tech Stack:** TypeScript, Vitest, append-only events, idempotency keys, dependency injection

**Prerequisite:** Phase 9 (risk/emergency) merged to main.

**Spec references:**
- §20 — Notification requirements (in-app + SMS, prefs, consent, batching, deduping)
- §7 — `notification_events` append-only table
- §10.1 — Orchestrator sends notifications
- §18 — Idempotency for notifications
- §24.1 — `GET /notifications`, `POST /notifications/prefs` endpoints
- §25 — Notification failure metrics and health checks
- §2.4 — No side effects without tenant confirmation

**Skills:**
- `@test-driven-development` — red-green-refactor for every task
- `@append-only-events` — notification_events INSERT+SELECT only
- `@schema-first-development` — types before implementation
- `@project-conventions` — naming, structure, barrel exports

---

### Task 0: Create notification type definitions

**Files:**
- Create: `packages/schemas/src/types/notification.ts`
- Modify: `packages/schemas/src/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/notification-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationEvent,
  NotificationPreference,
  SmsConsent,
} from '@wo-agent/schemas';

describe('Notification types', () => {
  it('NotificationEvent has required readonly fields', () => {
    const event: NotificationEvent = {
      event_id: 'evt-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1', 'wo-2'],
      issue_group_id: 'grp-1',
      template_id: 'tpl-wo-created',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: { summary: 'Your requests have been submitted' },
      created_at: '2026-03-03T12:00:00Z',
      sent_at: '2026-03-03T12:00:01Z',
    };
    expect(event.event_id).toBe('evt-1');
    expect(event.channel).toBe('in_app');
    expect(event.work_order_ids).toHaveLength(2);
  });

  it('NotificationPreference has required readonly fields', () => {
    const pref: NotificationPreference = {
      preference_id: 'pref-1',
      tenant_account_id: 'acct-1',
      in_app_enabled: true,
      sms_enabled: false,
      sms_consent: null,
      notification_type_overrides: {},
      cooldown_minutes: 5,
      updated_at: '2026-03-03T12:00:00Z',
    };
    expect(pref.sms_enabled).toBe(false);
    expect(pref.sms_consent).toBeNull();
  });

  it('SmsConsent tracks consent timestamp and phone', () => {
    const consent: SmsConsent = {
      phone_number: '+14165551234',
      consent_given_at: '2026-03-03T12:00:00Z',
      consent_revoked_at: null,
    };
    expect(consent.phone_number).toBe('+14165551234');
    expect(consent.consent_revoked_at).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/schemas && pnpm vitest run src/__tests__/notification-types.test.ts`
Expected: FAIL — types not exported from `@wo-agent/schemas`

**Step 3: Write implementation**

```typescript
// packages/schemas/src/types/notification.ts

/**
 * Notification channel (spec §20 — in-app + outbound SMS only).
 */
export type NotificationChannel = 'in_app' | 'sms';

/**
 * Notification types for the system.
 * work_order_created: sent after CONFIRM_SUBMISSION creates WOs
 * status_changed: sent when WO status updates
 * needs_input: sent when follow-up questions are pending
 */
export type NotificationType =
  | 'work_order_created'
  | 'status_changed'
  | 'needs_input';

/**
 * Notification delivery status.
 */
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed';

/**
 * Append-only notification event (spec §7 — notification_events table).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface NotificationEvent {
  readonly event_id: string;
  readonly notification_id: string;
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly channel: NotificationChannel;
  readonly notification_type: NotificationType;
  /** WO IDs — multiple for batched multi-issue notifications (spec §20). */
  readonly work_order_ids: readonly string[];
  readonly issue_group_id: string | null;
  readonly template_id: string;
  readonly status: NotificationStatus;
  readonly idempotency_key: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
  readonly sent_at: string | null;
  readonly delivered_at: string | null;
  readonly failed_at: string | null;
  readonly failure_reason: string | null;
}

/**
 * SMS consent record (spec §20 — default SMS off until consent).
 */
export interface SmsConsent {
  readonly phone_number: string;
  readonly consent_given_at: string;
  readonly consent_revoked_at: string | null;
}

/**
 * Notification preferences per tenant account (spec §20).
 * Preferences are mutable — not an event table.
 */
export interface NotificationPreference {
  readonly preference_id: string;
  readonly tenant_account_id: string;
  readonly in_app_enabled: boolean;
  readonly sms_enabled: boolean;
  readonly sms_consent: SmsConsent | null;
  /** Per-type overrides. Key is NotificationType, value is enabled. Missing = default. */
  readonly notification_type_overrides: Readonly<Record<string, boolean>>;
  readonly cooldown_minutes: number;
  readonly updated_at: string;
}
```

Add to barrel export in `packages/schemas/src/index.ts`:

```typescript
export type {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationEvent,
  NotificationPreference,
  SmsConsent,
} from './types/notification.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/schemas && pnpm vitest run src/__tests__/notification-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/schemas/src/types/notification.ts packages/schemas/src/index.ts packages/schemas/src/__tests__/notification-types.test.ts
git commit -m "feat(schemas): add notification type definitions (phase 10)"
```

---

### Task 1: Create NotificationRepository interface and in-memory implementation

**Files:**
- Create: `packages/core/src/notifications/types.ts`
- Create: `packages/core/src/notifications/in-memory-notification-store.ts`
- Create: `packages/core/src/notifications/index.ts`
- Test: `packages/core/src/__tests__/notifications/notification-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/notification-store.test.ts
import { describe, it, expect } from 'vitest';
import type { NotificationEvent } from '@wo-agent/schemas';
import { InMemoryNotificationStore } from '../../notifications/in-memory-notification-store.js';

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    event_id: 'evt-1',
    notification_id: 'notif-1',
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    channel: 'in_app',
    notification_type: 'work_order_created',
    work_order_ids: ['wo-1'],
    issue_group_id: 'grp-1',
    template_id: 'tpl-wo-created',
    status: 'sent',
    idempotency_key: 'idem-1',
    payload: {},
    created_at: '2026-03-03T12:00:00Z',
    sent_at: '2026-03-03T12:00:01Z',
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
}

describe('InMemoryNotificationStore', () => {
  it('inserts and queries by tenant_user_id', async () => {
    const store = new InMemoryNotificationStore();
    await store.insert(makeEvent());
    const results = await store.queryByTenantUser('user-1');
    expect(results).toHaveLength(1);
    expect(results[0].notification_id).toBe('notif-1');
  });

  it('rejects duplicate event_id', async () => {
    const store = new InMemoryNotificationStore();
    await store.insert(makeEvent());
    await expect(store.insert(makeEvent())).rejects.toThrow('Duplicate event_id');
  });

  it('queries by conversation_id', async () => {
    const store = new InMemoryNotificationStore();
    await store.insert(makeEvent({ event_id: 'e1', conversation_id: 'c1' }));
    await store.insert(makeEvent({ event_id: 'e2', conversation_id: 'c2', notification_id: 'n2', idempotency_key: 'k2' }));
    const results = await store.queryByConversation('c1');
    expect(results).toHaveLength(1);
  });

  it('findByIdempotencyKey returns existing event', async () => {
    const store = new InMemoryNotificationStore();
    const event = makeEvent();
    await store.insert(event);
    const found = await store.findByIdempotencyKey('idem-1');
    expect(found).toEqual(event);
  });

  it('findByIdempotencyKey returns null for unknown key', async () => {
    const store = new InMemoryNotificationStore();
    const found = await store.findByIdempotencyKey('unknown');
    expect(found).toBeNull();
  });

  it('findRecentByTenantAndType returns events within cooldown window', async () => {
    const store = new InMemoryNotificationStore();
    const now = '2026-03-03T12:05:00Z';
    await store.insert(makeEvent({
      event_id: 'e1',
      created_at: '2026-03-03T12:03:00Z', // 2 min ago
    }));
    await store.insert(makeEvent({
      event_id: 'e2',
      notification_id: 'n2',
      idempotency_key: 'k2',
      created_at: '2026-03-03T11:50:00Z', // 15 min ago
    }));
    const recent = await store.findRecentByTenantAndType(
      'user-1',
      'work_order_created',
      5, // 5 minute cooldown
      now,
    );
    expect(recent).toHaveLength(1);
    expect(recent[0].event_id).toBe('e1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/notification-store.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/notifications/types.ts
import type { NotificationEvent, NotificationPreference } from '@wo-agent/schemas';

/**
 * Notification event repository — append-only (spec §7, §20).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface NotificationRepository {
  /** Append a notification event. Rejects on duplicate event_id. */
  insert(event: NotificationEvent): Promise<void>;
  /** Query notification events for a tenant user, newest first. */
  queryByTenantUser(tenantUserId: string, limit?: number): Promise<readonly NotificationEvent[]>;
  /** Query notification events for a conversation. */
  queryByConversation(conversationId: string): Promise<readonly NotificationEvent[]>;
  /** Find an existing notification by idempotency key. Returns null if unseen. */
  findByIdempotencyKey(key: string): Promise<NotificationEvent | null>;
  /** Find recent notifications within cooldown window for dedup (spec §20). */
  findRecentByTenantAndType(
    tenantUserId: string,
    notificationType: string,
    cooldownMinutes: number,
    now: string,
  ): Promise<readonly NotificationEvent[]>;
}

/**
 * Notification preference store — mutable (not an event table).
 */
export interface NotificationPreferenceStore {
  /** Get preferences for a tenant account. Returns null if no prefs set (use defaults). */
  get(tenantAccountId: string): Promise<NotificationPreference | null>;
  /** Save/update preferences for a tenant account. */
  save(pref: NotificationPreference): Promise<void>;
}

/**
 * SMS sender abstraction. MVP: no-op / mock.
 * Production: Twilio or similar.
 */
export interface SmsSender {
  send(phoneNumber: string, message: string): Promise<{ success: boolean; error?: string }>;
}
```

```typescript
// packages/core/src/notifications/in-memory-notification-store.ts
import type { NotificationEvent, NotificationPreference } from '@wo-agent/schemas';
import type { NotificationRepository, NotificationPreferenceStore } from './types.js';

/**
 * In-memory notification event store for testing (append-only).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export class InMemoryNotificationStore implements NotificationRepository {
  private readonly events: NotificationEvent[] = [];
  private readonly ids = new Set<string>();

  async insert(event: NotificationEvent): Promise<void> {
    if (this.ids.has(event.event_id)) {
      throw new Error(`Duplicate event_id: ${event.event_id}`);
    }
    this.ids.add(event.event_id);
    this.events.push(event);
  }

  async queryByTenantUser(tenantUserId: string, limit?: number): Promise<readonly NotificationEvent[]> {
    const results = this.events
      .filter(e => e.tenant_user_id === tenantUserId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return limit ? results.slice(0, limit) : results;
  }

  async queryByConversation(conversationId: string): Promise<readonly NotificationEvent[]> {
    return this.events
      .filter(e => e.conversation_id === conversationId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async findByIdempotencyKey(key: string): Promise<NotificationEvent | null> {
    return this.events.find(e => e.idempotency_key === key) ?? null;
  }

  async findRecentByTenantAndType(
    tenantUserId: string,
    notificationType: string,
    cooldownMinutes: number,
    now: string,
  ): Promise<readonly NotificationEvent[]> {
    const cutoff = new Date(now).getTime() - cooldownMinutes * 60_000;
    return this.events.filter(e =>
      e.tenant_user_id === tenantUserId &&
      e.notification_type === notificationType &&
      new Date(e.created_at).getTime() >= cutoff,
    );
  }
}

/**
 * In-memory notification preference store for testing.
 */
export class InMemoryNotificationPreferenceStore implements NotificationPreferenceStore {
  private readonly prefs = new Map<string, NotificationPreference>();

  async get(tenantAccountId: string): Promise<NotificationPreference | null> {
    return this.prefs.get(tenantAccountId) ?? null;
  }

  async save(pref: NotificationPreference): Promise<void> {
    this.prefs.set(pref.tenant_account_id, pref);
  }
}
```

```typescript
// packages/core/src/notifications/index.ts
export type { NotificationRepository, NotificationPreferenceStore, SmsSender } from './types.js';
export { InMemoryNotificationStore, InMemoryNotificationPreferenceStore } from './in-memory-notification-store.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/notification-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/notifications/ packages/core/src/__tests__/notifications/
git commit -m "feat(core): add NotificationRepository interface and in-memory store (phase 10)"
```

---

### Task 2: Create notification event builder

**Files:**
- Create: `packages/core/src/notifications/event-builder.ts`
- Test: `packages/core/src/__tests__/notifications/event-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/event-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildWoCreatedNotificationEvent } from '../../notifications/event-builder.js';

describe('buildWoCreatedNotificationEvent', () => {
  it('builds in-app notification event for batched WO creation', () => {
    const event = buildWoCreatedNotificationEvent({
      eventId: 'evt-1',
      notificationId: 'notif-1',
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      channel: 'in_app',
      workOrderIds: ['wo-1', 'wo-2'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
      createdAt: '2026-03-03T12:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.notification_type).toBe('work_order_created');
    expect(event.channel).toBe('in_app');
    expect(event.work_order_ids).toEqual(['wo-1', 'wo-2']);
    expect(event.issue_group_id).toBe('grp-1');
    expect(event.status).toBe('sent');
    expect(event.sent_at).toBe('2026-03-03T12:00:00Z');
    expect(event.template_id).toBe('tpl-wo-created');
  });

  it('builds SMS notification event', () => {
    const event = buildWoCreatedNotificationEvent({
      eventId: 'evt-2',
      notificationId: 'notif-2',
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      channel: 'sms',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-2',
      createdAt: '2026-03-03T12:00:00Z',
    });

    expect(event.channel).toBe('sms');
    expect(event.status).toBe('pending');
    expect(event.sent_at).toBeNull();
  });

  it('batches multiple WO IDs into single notification (spec §20)', () => {
    const event = buildWoCreatedNotificationEvent({
      eventId: 'evt-3',
      notificationId: 'notif-3',
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      channel: 'in_app',
      workOrderIds: ['wo-1', 'wo-2', 'wo-3'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-3',
      createdAt: '2026-03-03T12:00:00Z',
    });

    expect(event.work_order_ids).toHaveLength(3);
    expect(event.payload).toEqual({
      message: 'Your service requests have been submitted.',
      work_order_count: 3,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/event-builder.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/notifications/event-builder.ts
import type { NotificationChannel, NotificationEvent } from '@wo-agent/schemas';

export interface WoCreatedNotificationInput {
  readonly eventId: string;
  readonly notificationId: string;
  readonly conversationId: string;
  readonly tenantUserId: string;
  readonly tenantAccountId: string;
  readonly channel: NotificationChannel;
  readonly workOrderIds: readonly string[];
  readonly issueGroupId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

/**
 * Build a notification event for WO creation (spec §20).
 * Batches: one notification for all WOs in an issue group.
 * In-app: immediately sent. SMS: pending until sender processes.
 */
export function buildWoCreatedNotificationEvent(input: WoCreatedNotificationInput): NotificationEvent {
  const isSms = input.channel === 'sms';
  const count = input.workOrderIds.length;
  const message = count === 1
    ? 'Your service request has been submitted.'
    : 'Your service requests have been submitted.';

  return {
    event_id: input.eventId,
    notification_id: input.notificationId,
    conversation_id: input.conversationId,
    tenant_user_id: input.tenantUserId,
    tenant_account_id: input.tenantAccountId,
    channel: input.channel,
    notification_type: 'work_order_created',
    work_order_ids: [...input.workOrderIds],
    issue_group_id: input.issueGroupId,
    template_id: 'tpl-wo-created',
    status: isSms ? 'pending' : 'sent',
    idempotency_key: input.idempotencyKey,
    payload: { message, work_order_count: count },
    created_at: input.createdAt,
    sent_at: isSms ? null : input.createdAt,
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
  };
}
```

Add to barrel export:

```typescript
// packages/core/src/notifications/index.ts — add:
export { buildWoCreatedNotificationEvent } from './event-builder.js';
export type { WoCreatedNotificationInput } from './event-builder.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/event-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/notifications/event-builder.ts packages/core/src/notifications/index.ts packages/core/src/__tests__/notifications/event-builder.test.ts
git commit -m "feat(core): add notification event builder with batching (phase 10)"
```

---

### Task 3: Create the NotificationService with dedup + cooldown + preference checks

**Files:**
- Create: `packages/core/src/notifications/notification-service.ts`
- Test: `packages/core/src/__tests__/notifications/notification-service.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/notification-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { NotificationPreference, NotificationEvent } from '@wo-agent/schemas';
import { NotificationService } from '../../notifications/notification-service.js';
import { InMemoryNotificationStore, InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';
import type { SmsSender } from '../../notifications/types.js';

function makePrefs(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    preference_id: 'pref-1',
    tenant_account_id: 'acct-1',
    in_app_enabled: true,
    sms_enabled: false,
    sms_consent: null,
    notification_type_overrides: {},
    cooldown_minutes: 5,
    updated_at: '2026-03-03T12:00:00Z',
    ...overrides,
  };
}

const noopSmsSender: SmsSender = {
  send: async () => ({ success: true }),
};

describe('NotificationService', () => {
  let notifStore: InMemoryNotificationStore;
  let prefStore: InMemoryNotificationPreferenceStore;
  let service: NotificationService;
  let counter: number;

  beforeEach(() => {
    notifStore = new InMemoryNotificationStore();
    prefStore = new InMemoryNotificationPreferenceStore();
    counter = 0;
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: noopSmsSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });
  });

  it('sends in-app notification for WO creation', async () => {
    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(true);
    expect(result.sms_sent).toBe(false);

    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1);
    expect(stored[0].channel).toBe('in_app');
    expect(stored[0].notification_type).toBe('work_order_created');
  });

  it('deduplicates via idempotency key', async () => {
    await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    const result2 = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result2.deduplicated).toBe(true);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1); // not duplicated
  });

  it('suppresses in-app within cooldown window', async () => {
    // Insert a recent notification
    await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    // Save a short cooldown preference
    await prefStore.save(makePrefs({ cooldown_minutes: 10 }));

    const result2 = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-2',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-2'],
      issueGroupId: 'grp-2',
      idempotencyKey: 'idem-2',
    });

    expect(result2.cooldown_suppressed).toBe(true);
  });

  it('sends SMS when consent given and sms_enabled', async () => {
    const smsCalls: string[] = [];
    const trackingSender: SmsSender = {
      send: async (phone, msg) => { smsCalls.push(phone); return { success: true }; },
    };
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: trackingSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    await prefStore.save(makePrefs({
      sms_enabled: true,
      sms_consent: {
        phone_number: '+14165551234',
        consent_given_at: '2026-01-01T00:00:00Z',
        consent_revoked_at: null,
      },
    }));

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(true);
    expect(smsCalls).toEqual(['+14165551234']);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(2); // in-app + sms
  });

  it('does NOT send SMS when consent revoked', async () => {
    await prefStore.save(makePrefs({
      sms_enabled: true,
      sms_consent: {
        phone_number: '+14165551234',
        consent_given_at: '2026-01-01T00:00:00Z',
        consent_revoked_at: '2026-02-01T00:00:00Z',
      },
    }));

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(false);
  });

  it('respects in_app_enabled=false preference', async () => {
    await prefStore.save(makePrefs({ in_app_enabled: false }));

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(false);
  });

  it('batches multi-issue WO creation into one notification', async () => {
    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1', 'wo-2', 'wo-3'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.in_app_sent).toBe(true);
    const stored = await notifStore.queryByTenantUser('user-1');
    expect(stored).toHaveLength(1); // ONE notification, three WO IDs
    expect(stored[0].work_order_ids).toHaveLength(3);
  });

  it('records failed SMS as event with failure_reason', async () => {
    const failingSender: SmsSender = {
      send: async () => ({ success: false, error: 'Network timeout' }),
    };
    service = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender: failingSender,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    await prefStore.save(makePrefs({
      sms_enabled: true,
      sms_consent: {
        phone_number: '+14165551234',
        consent_given_at: '2026-01-01T00:00:00Z',
        consent_revoked_at: null,
      },
    }));

    const result = await service.notifyWorkOrdersCreated({
      conversationId: 'conv-1',
      tenantUserId: 'user-1',
      tenantAccountId: 'acct-1',
      workOrderIds: ['wo-1'],
      issueGroupId: 'grp-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.sms_sent).toBe(false);
    expect(result.sms_failed).toBe(true);

    const stored = await notifStore.queryByTenantUser('user-1');
    const smsEvent = stored.find(e => e.channel === 'sms');
    expect(smsEvent?.status).toBe('failed');
    expect(smsEvent?.failure_reason).toBe('Network timeout');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/notification-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/notifications/notification-service.ts
import type { NotificationPreference } from '@wo-agent/schemas';
import type { NotificationRepository, NotificationPreferenceStore, SmsSender } from './types.js';
import { buildWoCreatedNotificationEvent } from './event-builder.js';

const DEFAULT_COOLDOWN_MINUTES = 5;

export interface NotificationServiceDeps {
  readonly notificationRepo: NotificationRepository;
  readonly preferenceStore: NotificationPreferenceStore;
  readonly smsSender: SmsSender;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export interface NotifyWoCreatedInput {
  readonly conversationId: string;
  readonly tenantUserId: string;
  readonly tenantAccountId: string;
  readonly workOrderIds: readonly string[];
  readonly issueGroupId: string;
  readonly idempotencyKey: string;
}

export interface NotifyResult {
  readonly in_app_sent: boolean;
  readonly sms_sent: boolean;
  readonly sms_failed?: boolean;
  readonly deduplicated?: boolean;
  readonly cooldown_suppressed?: boolean;
}

/**
 * Notification service (spec §20).
 * Sends in-app + SMS notifications with batching, dedup, preferences, and consent.
 */
export class NotificationService {
  private readonly deps: NotificationServiceDeps;

  constructor(deps: NotificationServiceDeps) {
    this.deps = deps;
  }

  async notifyWorkOrdersCreated(input: NotifyWoCreatedInput): Promise<NotifyResult> {
    const { notificationRepo, preferenceStore, idGenerator, clock } = this.deps;
    const now = clock();

    // 1. Idempotency dedup (spec §18, §20)
    const existing = await notificationRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { in_app_sent: false, sms_sent: false, deduplicated: true };
    }

    // 2. Load preferences (defaults: in-app on, sms off)
    const prefs = await preferenceStore.get(input.tenantAccountId);
    const inAppEnabled = prefs?.in_app_enabled ?? true;
    const smsEnabled = this.isSmsEnabled(prefs);
    const cooldownMinutes = prefs?.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES;

    // 3. Cooldown dedup (spec §20)
    const recent = await notificationRepo.findRecentByTenantAndType(
      input.tenantUserId,
      'work_order_created',
      cooldownMinutes,
      now,
    );
    if (recent.length > 0) {
      return { in_app_sent: false, sms_sent: false, cooldown_suppressed: true };
    }

    let inAppSent = false;
    let smsSent = false;
    let smsFailed = false;

    // 4. Send in-app notification
    if (inAppEnabled) {
      const notifId = idGenerator();
      const event = buildWoCreatedNotificationEvent({
        eventId: idGenerator(),
        notificationId: notifId,
        conversationId: input.conversationId,
        tenantUserId: input.tenantUserId,
        tenantAccountId: input.tenantAccountId,
        channel: 'in_app',
        workOrderIds: input.workOrderIds,
        issueGroupId: input.issueGroupId,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });
      await notificationRepo.insert(event);
      inAppSent = true;
    }

    // 5. Send SMS if enabled + consent valid (spec §20 — default SMS off)
    if (smsEnabled && prefs?.sms_consent) {
      const smsResult = await this.deps.smsSender.send(
        prefs.sms_consent.phone_number,
        this.buildSmsMessage(input.workOrderIds.length),
      );

      const smsNotifId = idGenerator();
      const smsEvent = buildWoCreatedNotificationEvent({
        eventId: idGenerator(),
        notificationId: smsNotifId,
        conversationId: input.conversationId,
        tenantUserId: input.tenantUserId,
        tenantAccountId: input.tenantAccountId,
        channel: 'sms',
        workOrderIds: input.workOrderIds,
        issueGroupId: input.issueGroupId,
        idempotencyKey: `${input.idempotencyKey}-sms`,
        createdAt: now,
      });

      if (smsResult.success) {
        await notificationRepo.insert({
          ...smsEvent,
          status: 'sent',
          sent_at: now,
        });
        smsSent = true;
      } else {
        await notificationRepo.insert({
          ...smsEvent,
          status: 'failed',
          failed_at: now,
          failure_reason: smsResult.error ?? 'Unknown error',
        });
        smsFailed = true;
      }
    }

    return { in_app_sent: inAppSent, sms_sent: smsSent, sms_failed: smsFailed || undefined };
  }

  private isSmsEnabled(prefs: NotificationPreference | null): boolean {
    if (!prefs) return false;
    if (!prefs.sms_enabled) return false;
    if (!prefs.sms_consent) return false;
    // Consent revoked?
    if (prefs.sms_consent.consent_revoked_at !== null) return false;
    return true;
  }

  private buildSmsMessage(woCount: number): string {
    return woCount === 1
      ? 'Your service request has been submitted. Check the app for details.'
      : `Your ${woCount} service requests have been submitted. Check the app for details.`;
  }
}
```

Add to barrel export:

```typescript
// packages/core/src/notifications/index.ts — add:
export { NotificationService } from './notification-service.js';
export type { NotificationServiceDeps, NotifyWoCreatedInput, NotifyResult } from './notification-service.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/notification-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/notifications/ packages/core/src/__tests__/notifications/notification-service.test.ts
git commit -m "feat(core): add NotificationService with dedup/cooldown/prefs/consent (phase 10)"
```

---

### Task 4: Create mock SMS sender

**Files:**
- Create: `packages/core/src/notifications/mock-sms-sender.ts`
- Test: `packages/core/src/__tests__/notifications/mock-sms-sender.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/mock-sms-sender.test.ts
import { describe, it, expect } from 'vitest';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';

describe('MockSmsSender', () => {
  it('records sent messages and returns success', async () => {
    const sender = new MockSmsSender();
    const result = await sender.send('+14165551234', 'Test message');
    expect(result.success).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toEqual({ phone: '+14165551234', message: 'Test message' });
  });

  it('can be configured to fail', async () => {
    const sender = new MockSmsSender({ shouldFail: true, failureError: 'Service unavailable' });
    const result = await sender.send('+14165551234', 'Test message');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Service unavailable');
    expect(sender.sent).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/mock-sms-sender.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/notifications/mock-sms-sender.ts
import type { SmsSender } from './types.js';

export interface MockSmsSenderConfig {
  readonly shouldFail?: boolean;
  readonly failureError?: string;
}

/**
 * Mock SMS sender for testing and MVP (spec §20).
 * Records all send attempts for assertion.
 */
export class MockSmsSender implements SmsSender {
  readonly sent: Array<{ phone: string; message: string }> = [];
  private readonly config: MockSmsSenderConfig;

  constructor(config: MockSmsSenderConfig = {}) {
    this.config = config;
  }

  async send(phoneNumber: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (this.config.shouldFail) {
      return { success: false, error: this.config.failureError ?? 'Mock failure' };
    }
    this.sent.push({ phone: phoneNumber, message });
    return { success: true };
  }
}
```

Add to barrel export:

```typescript
// packages/core/src/notifications/index.ts — add:
export { MockSmsSender } from './mock-sms-sender.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/mock-sms-sender.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/notifications/mock-sms-sender.ts packages/core/src/__tests__/notifications/mock-sms-sender.test.ts packages/core/src/notifications/index.ts
git commit -m "feat(core): add MockSmsSender for testing (phase 10)"
```

---

### Task 5: Wire NotificationService into OrchestratorDependencies

**Files:**
- Modify: `packages/core/src/orchestrator/types.ts:15-39` — add notificationService to deps
- Modify: `packages/core/src/notifications/types.ts` — export NotificationService interface
- Test: `packages/core/src/__tests__/notifications/deps-wiring.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/deps-wiring.test.ts
import { describe, it, expect } from 'vitest';
import type { OrchestratorDependencies } from '../../orchestrator/types.js';

describe('OrchestratorDependencies notification wiring', () => {
  it('accepts notificationService as an optional dependency', () => {
    // This test is a compile-time check. If NotificationService is not
    // on OrchestratorDependencies, TypeScript will fail.
    const partial: Pick<OrchestratorDependencies, 'notificationService'> = {
      notificationService: undefined,
    };
    // Optional — undefined is valid
    expect(partial.notificationService).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/deps-wiring.test.ts`
Expected: FAIL — `notificationService` does not exist on type `OrchestratorDependencies`

**Step 3: Write implementation**

In `packages/core/src/orchestrator/types.ts`, add the import and field:

Add import:
```typescript
import type { NotificationService } from '../notifications/notification-service.js';
```

Add to `OrchestratorDependencies` interface (after `contactExecutor`):
```typescript
  readonly notificationService?: NotificationService;
```

Note: Optional (`?`) to avoid breaking existing tests that don't use notifications.

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/deps-wiring.test.ts`
Expected: PASS

**Step 5: Run all existing tests to verify no breakage**

Run: `cd packages/core && pnpm vitest run`
Expected: ALL PASS (optional dep doesn't break anything)

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/types.ts packages/core/src/__tests__/notifications/deps-wiring.test.ts
git commit -m "feat(core): wire NotificationService into OrchestratorDependencies (phase 10)"
```

---

### Task 6: Integrate notifications into confirm-submission handler

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/confirm-submission.ts:170-202`
- Test: `packages/core/src/__tests__/notifications/confirm-submission-notifications.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/confirm-submission-notifications.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import type { OrchestratorActionRequest, PinnedVersions } from '@wo-agent/schemas';
import { handleConfirmSubmission } from '../../orchestrator/action-handlers/confirm-submission.js';
import type { ActionHandlerContext, OrchestratorDependencies } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { InMemoryNotificationStore, InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';
import { NotificationService } from '../../notifications/notification-service.js';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';

const VERSIONS: PinnedVersions = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test',
  prompt_version: '1.0.0',
};

function makeSession(): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    state: ConversationState.TENANT_CONFIRMATION_PENDING,
    unit_id: 'unit-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: VERSIONS,
    split_issues: [{
      issue_id: 'issue-1',
      raw_excerpt: 'Leaky faucet',
      summary: 'Leaky faucet in kitchen',
    }],
    classification_results: [{
      issue_id: 'issue-1',
      classifierOutput: {
        classification: { maintenance_category: 'plumbing' },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { maintenance_category: 0.9 },
      fieldsNeedingInput: [],
    }],
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-03-03T12:00:00Z',
    last_activity_at: '2026-03-03T12:00:00Z',
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

describe('confirm-submission notification integration', () => {
  let notifStore: InMemoryNotificationStore;
  let notifService: NotificationService;
  let counter: number;

  function makeDeps(): OrchestratorDependencies {
    counter = 0;
    notifStore = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();
    notifService = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender,
      idGenerator: () => `nid-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    let mainCounter = 0;
    return {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++mainCounter}`,
      clock: () => '2026-03-03T12:00:00Z',
      issueSplitter: async () => ({ issues: [] }),
      issueClassifier: async () => ({}),
      followUpGenerator: async () => ({}),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', fields: {} } as any,
      confidenceConfig: undefined,
      followUpCaps: undefined,
      unitResolver: async () => ({ property_id: 'prop-1', client_id: 'client-1' }),
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: { version: '1.0.0', triggers: [] },
      escalationPlans: { plans: [] },
      contactExecutor: async () => false,
      notificationService: notifService,
    };
  }

  it('sends notification after successful WO creation', async () => {
    const deps = makeDeps();
    const ctx: ActionHandlerContext = {
      session: makeSession(),
      request: {
        conversation_id: 'conv-1',
        action_type: 'CONFIRM_SUBMISSION',
        actor: 'tenant',
        tenant_input: {},
        idempotency_key: 'submit-1',
        auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
      } as OrchestratorActionRequest,
      deps,
    };

    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);

    // Notification was sent
    const notifs = await notifStore.queryByTenantUser('user-1');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].notification_type).toBe('work_order_created');
    expect(notifs[0].work_order_ids).toHaveLength(1);
  });

  it('includes send_notifications side effect', async () => {
    const deps = makeDeps();
    const ctx: ActionHandlerContext = {
      session: makeSession(),
      request: {
        conversation_id: 'conv-1',
        action_type: 'CONFIRM_SUBMISSION',
        actor: 'tenant',
        tenant_input: {},
        idempotency_key: 'submit-2',
        auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
      } as OrchestratorActionRequest,
      deps,
    };

    const result = await handleConfirmSubmission(ctx);
    const notifEffect = result.sideEffects?.find(e => e.effect_type === 'send_notifications');
    expect(notifEffect).toBeDefined();
    expect(notifEffect?.status).toBe('completed');
  });

  it('does NOT fail WO creation if notification service is unavailable', async () => {
    const deps = makeDeps();
    // Remove notification service to simulate unavailability
    (deps as any).notificationService = undefined;

    const ctx: ActionHandlerContext = {
      session: makeSession(),
      request: {
        conversation_id: 'conv-1',
        action_type: 'CONFIRM_SUBMISSION',
        actor: 'tenant',
        tenant_input: {},
        idempotency_key: 'submit-3',
        auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
      } as OrchestratorActionRequest,
      deps,
    };

    const result = await handleConfirmSubmission(ctx);
    // WO creation still succeeds
    expect(result.newState).toBe(ConversationState.SUBMITTED);
    expect(result.eventPayload?.work_order_ids).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/confirm-submission-notifications.test.ts`
Expected: FAIL — no notification sent after WO creation

**Step 3: Write implementation**

In `packages/core/src/orchestrator/action-handlers/confirm-submission.ts`, add notification dispatch after WO creation and idempotency completion (after line 185):

After the `idempotencyStore.complete(...)` call, add:

```typescript
  // Dispatch notifications (spec §20 — batch multi-issue into one notification)
  // Notifications are best-effort: failures do not roll back WO creation.
  const notifSideEffects: SideEffectInput[] = [];
  if (deps.notificationService) {
    try {
      const notifResult = await deps.notificationService.notifyWorkOrdersCreated({
        conversationId: session.conversation_id,
        tenantUserId: session.tenant_user_id,
        tenantAccountId: session.tenant_account_id,
        workOrderIds: woIds,
        issueGroupId: workOrders[0].issue_group_id,
        idempotencyKey: `${idempotencyKey}-notif`,
      });
      notifSideEffects.push({
        effect_type: 'send_notifications',
        status: notifResult.in_app_sent || notifResult.sms_sent ? 'completed' : 'pending',
        idempotency_key: `${idempotencyKey}-notif`,
      });
    } catch {
      notifSideEffects.push({
        effect_type: 'send_notifications',
        status: 'failed',
        idempotency_key: `${idempotencyKey}-notif`,
      });
    }
  }
```

And update the return statement to include notification side effects:

```typescript
  return {
    newState: ConversationState.SUBMITTED,
    session,
    uiMessages: [{ role: 'agent', content: 'Your request has been submitted. We\'ll be in touch.' }],
    sideEffects: [
      {
        effect_type: 'create_work_orders',
        status: 'completed',
        idempotency_key: idempotencyKey,
      },
      ...notifSideEffects,
    ],
    eventPayload: {
      confirmed: true,
      confirmation_payload: confirmationPayload,
      work_order_ids: woIds,
    },
    eventType: 'confirmation_accepted',
  };
```

Add the import at the top of the file:
```typescript
import type { SideEffectInput } from '../types.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/confirm-submission-notifications.test.ts`
Expected: PASS

**Step 5: Run all existing tests to verify no breakage**

Run: `cd packages/core && pnpm vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/confirm-submission.ts packages/core/src/__tests__/notifications/confirm-submission-notifications.test.ts
git commit -m "feat(core): integrate NotificationService into confirm-submission handler (phase 10)"
```

---

### Task 7: Add notification preference update logic

**Files:**
- Create: `packages/core/src/notifications/preference-service.ts`
- Test: `packages/core/src/__tests__/notifications/preference-service.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/preference-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { updateNotificationPreferences, grantSmsConsent, revokeSmsConsent } from '../../notifications/preference-service.js';
import { InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';

describe('Preference updates', () => {
  let prefStore: InMemoryNotificationPreferenceStore;
  let counter: number;
  const idGenerator = () => `id-${++counter}`;
  const clock = () => '2026-03-03T12:00:00Z';

  beforeEach(() => {
    prefStore = new InMemoryNotificationPreferenceStore();
    counter = 0;
  });

  it('creates default preferences on first update', async () => {
    const result = await updateNotificationPreferences({
      tenantAccountId: 'acct-1',
      updates: { in_app_enabled: true },
      prefStore,
      idGenerator,
      clock,
    });

    expect(result.in_app_enabled).toBe(true);
    expect(result.sms_enabled).toBe(false); // default
    expect(result.cooldown_minutes).toBe(5); // default

    const stored = await prefStore.get('acct-1');
    expect(stored).toEqual(result);
  });

  it('merges partial updates into existing preferences', async () => {
    await updateNotificationPreferences({
      tenantAccountId: 'acct-1',
      updates: { cooldown_minutes: 10 },
      prefStore,
      idGenerator,
      clock,
    });

    const updated = await updateNotificationPreferences({
      tenantAccountId: 'acct-1',
      updates: { in_app_enabled: false },
      prefStore,
      idGenerator,
      clock,
    });

    expect(updated.in_app_enabled).toBe(false);
    expect(updated.cooldown_minutes).toBe(10); // preserved
  });

  it('grantSmsConsent sets consent with phone number', async () => {
    const result = await grantSmsConsent({
      tenantAccountId: 'acct-1',
      phoneNumber: '+14165551234',
      prefStore,
      idGenerator,
      clock,
    });

    expect(result.sms_enabled).toBe(true);
    expect(result.sms_consent?.phone_number).toBe('+14165551234');
    expect(result.sms_consent?.consent_given_at).toBe('2026-03-03T12:00:00Z');
    expect(result.sms_consent?.consent_revoked_at).toBeNull();
  });

  it('revokeSmsConsent sets revocation timestamp', async () => {
    await grantSmsConsent({
      tenantAccountId: 'acct-1',
      phoneNumber: '+14165551234',
      prefStore,
      idGenerator,
      clock,
    });

    const result = await revokeSmsConsent({
      tenantAccountId: 'acct-1',
      prefStore,
      clock,
    });

    expect(result.sms_enabled).toBe(false);
    expect(result.sms_consent?.consent_revoked_at).toBe('2026-03-03T12:00:00Z');
  });

  it('revokeSmsConsent is no-op when no consent exists', async () => {
    const result = await revokeSmsConsent({
      tenantAccountId: 'acct-1',
      prefStore,
      clock,
    });

    // Creates default prefs with no consent
    expect(result.sms_consent).toBeNull();
    expect(result.sms_enabled).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/preference-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/notifications/preference-service.ts
import type { NotificationPreference } from '@wo-agent/schemas';
import type { NotificationPreferenceStore } from './types.js';

const DEFAULT_COOLDOWN = 5;

function defaultPrefs(tenantAccountId: string, prefId: string, now: string): NotificationPreference {
  return {
    preference_id: prefId,
    tenant_account_id: tenantAccountId,
    in_app_enabled: true,
    sms_enabled: false,
    sms_consent: null,
    notification_type_overrides: {},
    cooldown_minutes: DEFAULT_COOLDOWN,
    updated_at: now,
  };
}

export interface UpdatePrefsInput {
  readonly tenantAccountId: string;
  readonly updates: {
    readonly in_app_enabled?: boolean;
    readonly sms_enabled?: boolean;
    readonly cooldown_minutes?: number;
    readonly notification_type_overrides?: Readonly<Record<string, boolean>>;
  };
  readonly prefStore: NotificationPreferenceStore;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export async function updateNotificationPreferences(input: UpdatePrefsInput): Promise<NotificationPreference> {
  const { tenantAccountId, updates, prefStore, idGenerator, clock } = input;
  const now = clock();
  const existing = await prefStore.get(tenantAccountId);
  const base = existing ?? defaultPrefs(tenantAccountId, idGenerator(), now);

  const updated: NotificationPreference = {
    ...base,
    in_app_enabled: updates.in_app_enabled ?? base.in_app_enabled,
    sms_enabled: updates.sms_enabled ?? base.sms_enabled,
    cooldown_minutes: updates.cooldown_minutes ?? base.cooldown_minutes,
    notification_type_overrides: updates.notification_type_overrides ?? base.notification_type_overrides,
    updated_at: now,
  };

  await prefStore.save(updated);
  return updated;
}

export interface GrantSmsConsentInput {
  readonly tenantAccountId: string;
  readonly phoneNumber: string;
  readonly prefStore: NotificationPreferenceStore;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export async function grantSmsConsent(input: GrantSmsConsentInput): Promise<NotificationPreference> {
  const { tenantAccountId, phoneNumber, prefStore, idGenerator, clock } = input;
  const now = clock();
  const existing = await prefStore.get(tenantAccountId);
  const base = existing ?? defaultPrefs(tenantAccountId, idGenerator(), now);

  const updated: NotificationPreference = {
    ...base,
    sms_enabled: true,
    sms_consent: {
      phone_number: phoneNumber,
      consent_given_at: now,
      consent_revoked_at: null,
    },
    updated_at: now,
  };

  await prefStore.save(updated);
  return updated;
}

export interface RevokeSmsConsentInput {
  readonly tenantAccountId: string;
  readonly prefStore: NotificationPreferenceStore;
  readonly clock: () => string;
}

export async function revokeSmsConsent(input: RevokeSmsConsentInput): Promise<NotificationPreference> {
  const { tenantAccountId, prefStore, clock } = input;
  const now = clock();
  const existing = await prefStore.get(tenantAccountId);

  if (!existing || !existing.sms_consent) {
    // No consent to revoke — ensure prefs exist with defaults
    const def = defaultPrefs(tenantAccountId, 'default', now);
    await prefStore.save(def);
    return def;
  }

  const updated: NotificationPreference = {
    ...existing,
    sms_enabled: false,
    sms_consent: {
      ...existing.sms_consent,
      consent_revoked_at: now,
    },
    updated_at: now,
  };

  await prefStore.save(updated);
  return updated;
}
```

Add to barrel export:

```typescript
// packages/core/src/notifications/index.ts — add:
export { updateNotificationPreferences, grantSmsConsent, revokeSmsConsent } from './preference-service.js';
export type { UpdatePrefsInput, GrantSmsConsentInput, RevokeSmsConsentInput } from './preference-service.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/preference-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/notifications/preference-service.ts packages/core/src/notifications/index.ts packages/core/src/__tests__/notifications/preference-service.test.ts
git commit -m "feat(core): add notification preference update + SMS consent logic (phase 10)"
```

---

### Task 8: Add EventRepository support for NotificationEvent

**Files:**
- Modify: `packages/core/src/events/event-repository.ts:1-19` — add NotificationEvent to insert union
- Modify: `packages/core/src/events/in-memory-event-store.ts:5` — add to AnyEvent union
- Test: `packages/core/src/__tests__/notifications/event-repo-integration.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/notifications/event-repo-integration.test.ts
import { describe, it, expect } from 'vitest';
import type { NotificationEvent } from '@wo-agent/schemas';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';

describe('EventRepository NotificationEvent support', () => {
  it('accepts NotificationEvent via insert()', async () => {
    const store = new InMemoryEventStore();
    const notifEvent: NotificationEvent = {
      event_id: 'nevt-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1'],
      issue_group_id: 'grp-1',
      template_id: 'tpl-wo-created',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: {},
      created_at: '2026-03-03T12:00:00Z',
      sent_at: '2026-03-03T12:00:00Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(notifEvent);

    // Verify event was stored (queryAll returns all events for a conversation)
    const all = await store.queryAll('conv-1');
    expect(all).toHaveLength(1);
    expect(all[0].event_id).toBe('nevt-1');
  });

  it('rejects duplicate notification event_id', async () => {
    const store = new InMemoryEventStore();
    const event: NotificationEvent = {
      event_id: 'dup-1',
      notification_id: 'notif-1',
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      channel: 'in_app',
      notification_type: 'work_order_created',
      work_order_ids: ['wo-1'],
      issue_group_id: 'grp-1',
      template_id: 'tpl-wo-created',
      status: 'sent',
      idempotency_key: 'idem-1',
      payload: {},
      created_at: '2026-03-03T12:00:00Z',
      sent_at: null,
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(event);
    await expect(store.insert(event)).rejects.toThrow('Duplicate event_id');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/event-repo-integration.test.ts`
Expected: FAIL — TypeScript type error (NotificationEvent not in insert union)

**Step 3: Write implementation**

In `packages/core/src/events/event-repository.ts`, add NotificationEvent to the insert signature:

```typescript
import type { FollowUpEvent, NotificationEvent } from '@wo-agent/schemas';
// ...
export interface EventRepository {
  /** Append a single event (conversation, follow-up, confirmation, staleness, risk, or notification). */
  insert(event: ConversationEvent | FollowUpEvent | ConfirmationEvent | StalenessEvent | RiskEvent | NotificationEvent): Promise<void>;
  /** Query conversation events by filters. Returns in order specified. */
  query(filters: EventQuery): Promise<readonly ConversationEvent[]>;
}
```

In `packages/core/src/events/in-memory-event-store.ts`, update the AnyEvent union:

```typescript
import type { FollowUpEvent, NotificationEvent } from '@wo-agent/schemas';
// ...
type AnyEvent = ConversationEvent | FollowUpEvent | NotificationEvent;
```

Note: The `insert()` and `queryAll()` methods already work generically via `event_id` and `conversation_id` checks.

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/event-repo-integration.test.ts`
Expected: PASS

**Step 5: Run all existing tests**

Run: `cd packages/core && pnpm vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/core/src/events/event-repository.ts packages/core/src/events/in-memory-event-store.ts packages/core/src/__tests__/notifications/event-repo-integration.test.ts
git commit -m "feat(core): add NotificationEvent to EventRepository union (phase 10)"
```

---

### Task 9: Integration test — full notification flow through dispatcher

**Files:**
- Create: `packages/core/src/__tests__/notifications/e2e-notification-flow.test.ts`

**Step 1: Write the integration test**

```typescript
// packages/core/src/__tests__/notifications/e2e-notification-flow.test.ts
import { describe, it, expect } from 'vitest';
import { ActionType, ActorType, ConversationState } from '@wo-agent/schemas';
import type { OrchestratorActionRequest } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { InMemoryNotificationStore, InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';
import { NotificationService } from '../../notifications/notification-service.js';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

/**
 * E2E test: Walk the full intake flow through to submitted,
 * then verify notifications were sent correctly.
 */
describe('E2E: Notification flow through dispatcher', () => {
  it('sends batched in-app notification after multi-issue WO creation', async () => {
    const eventRepo = new InMemoryEventStore();
    const workOrderRepo = new InMemoryWorkOrderStore();
    const idempotencyStore = new InMemoryIdempotencyStore();
    const notifStore = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();

    let counter = 0;
    let notifCounter = 0;

    const notifService = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender,
      idGenerator: () => `nid-${++notifCounter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    const sessionMap = new Map<string, ConversationSession>();
    const sessionStore: SessionStore = {
      get: async (id) => sessionMap.get(id) ?? null,
      getByTenantUser: async (uid) => [...sessionMap.values()].filter(s => s.tenant_user_id === uid),
      save: async (s) => { sessionMap.set(s.conversation_id, s); },
    };

    const deps: OrchestratorDependencies = {
      eventRepo,
      sessionStore,
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
      issueSplitter: async () => ({
        issues: [
          { issue_id: 'issue-1', raw_excerpt: 'Leaky faucet', summary: 'Leaky faucet in kitchen' },
          { issue_id: 'issue-2', raw_excerpt: 'Broken light', summary: 'Broken light in hallway' },
        ],
      }),
      issueClassifier: async (input: any) => ({
        classification: { maintenance_category: 'plumbing' },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', fields: {} } as any,
      unitResolver: async () => ({ property_id: 'prop-1', client_id: 'client-1' }),
      workOrderRepo,
      idempotencyStore,
      riskProtocols: { version: '1.0.0', triggers: [] },
      escalationPlans: { plans: [] },
      contactExecutor: async () => false,
      notificationService: notifService,
    };

    const dispatch = createDispatcher(deps);

    // Step 1: CREATE_CONVERSATION
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
    } as OrchestratorActionRequest);

    const convId = r1.response.conversation_snapshot.conversation_id;

    // Step 2: SELECT_UNIT
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
    } as OrchestratorActionRequest);

    // Step 3: SUBMIT_INITIAL_MESSAGE (triggers split → classification chain)
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'I have a leaky faucet and a broken light' },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
    } as OrchestratorActionRequest);

    // Step 4: CONFIRM_SPLIT
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
    } as OrchestratorActionRequest);

    // Step 5: CONFIRM_SUBMISSION
    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'submit-e2e-1',
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
    } as OrchestratorActionRequest);

    // Verify: WOs created
    expect(submitResult.response.conversation_snapshot.state).toBe(ConversationState.SUBMITTED);

    // Verify: Notification sent
    const notifs = await notifStore.queryByTenantUser('user-1');
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    const woNotif = notifs.find(n => n.notification_type === 'work_order_created');
    expect(woNotif).toBeDefined();
    expect(woNotif!.channel).toBe('in_app');
    expect(woNotif!.status).toBe('sent');

    // Verify: side effects include send_notifications
    const notifEffect = submitResult.response.pending_side_effects.find(
      (e: any) => e.effect_type === 'send_notifications',
    );
    expect(notifEffect).toBeDefined();

    // Verify: no SMS sent (default prefs)
    expect(smsSender.sent).toHaveLength(0);
  });
});
```

**Step 2: Run test**

Run: `cd packages/core && pnpm vitest run src/__tests__/notifications/e2e-notification-flow.test.ts`
Expected: PASS (all pieces wired together from Tasks 0-8)

Note: If this test fails, debug based on the specific assertion failure. The test validates the full chain: dispatcher → confirm-submission handler → NotificationService → NotificationRepository.

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/notifications/e2e-notification-flow.test.ts
git commit -m "test(core): e2e integration test — notification flow through dispatcher (phase 10)"
```

---

### Task 10: Run full test suite and TypeScript check

**Step 1: Run full test suite**

Run: `cd packages/core && pnpm vitest run`
Expected: ALL PASS

**Step 2: Run TypeScript compile check**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: No errors

Run: `cd packages/schemas && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "chore(core): TypeScript cleanup and full validation (phase 10)"
```

---

## Summary

| Task | Component | Key Files |
|------|-----------|-----------|
| 0 | Notification type definitions | `packages/schemas/src/types/notification.ts` |
| 1 | NotificationRepository + in-memory store | `packages/core/src/notifications/types.ts`, `in-memory-notification-store.ts` |
| 2 | Notification event builder | `packages/core/src/notifications/event-builder.ts` |
| 3 | NotificationService (dedup/cooldown/prefs/consent) | `packages/core/src/notifications/notification-service.ts` |
| 4 | Mock SMS sender | `packages/core/src/notifications/mock-sms-sender.ts` |
| 5 | Wire into OrchestratorDependencies | `packages/core/src/orchestrator/types.ts` |
| 6 | Integrate into confirm-submission handler | `packages/core/src/orchestrator/action-handlers/confirm-submission.ts` |
| 7 | Preference update + SMS consent logic | `packages/core/src/notifications/preference-service.ts` |
| 8 | EventRepository NotificationEvent support | `packages/core/src/events/event-repository.ts` |
| 9 | E2E integration test | `packages/core/src/__tests__/notifications/e2e-notification-flow.test.ts` |
| 10 | Full test suite + TypeScript validation | — |
