# Phase 3: Orchestrator Implementation + Endpoint Stubs + Event Append Pattern

> **For Claude:** REQUIRED SUB-SKILLS: Invoke `@state-machine-implementation` before any state machine code. Invoke `@schema-first-development` before creating new modules. Invoke `@append-only-events` when writing event code. Invoke `@project-conventions` for naming and layout.

**Goal:** Build the orchestrator — the single controller that dispatches actions, validates state transitions, writes append-only events, and returns typed responses — plus Next.js API route stubs and rate-limiting middleware.

**Architecture:** The orchestrator is a pure-function dispatcher. Endpoints are thin wrappers that extract auth, build an `OrchestratorActionRequest`, call `orchestrator.dispatch()`, and return `OrchestratorActionResponse`. Events are written via an append-only event repository (INSERT+SELECT only). LLM tool calls are stubbed (actual implementations come in Phases 4–6).

**Tech Stack:** TypeScript, Next.js (API routes), `@wo-agent/schemas`, `@wo-agent/core`, vitest

**Spec sections:** §7 (Events), §8 (Rate limits), §10 (Orchestrator contract), §11 (State machine), §12 (Draft discovery), §24 (API surface)

**Prerequisites:** Phase 1 (schemas — complete), Phase 2 (state machine + auth + session — must be complete before execution)

---

## File Structure

```
packages/core/src/
├── events/
│   ├── index.ts
│   ├── types.ts                        # ConversationEvent type + event enums
│   ├── event-repository.ts             # Interface: insert + query only
│   └── in-memory-event-store.ts        # Test implementation
├── orchestrator/
│   ├── index.ts
│   ├── types.ts                        # OrchestratorDependencies, DispatchResult
│   ├── dispatcher.ts                   # Main dispatch(action) → response
│   ├── response-builder.ts             # Build OrchestratorActionResponse
│   └── action-handlers/
│       ├── index.ts
│       ├── create-conversation.ts
│       ├── select-unit.ts
│       ├── submit-initial-message.ts
│       ├── submit-additional-message.ts
│       ├── split-actions.ts            # CONFIRM_SPLIT, MERGE, EDIT, ADD, REJECT
│       ├── answer-followups.ts
│       ├── confirm-submission.ts
│       ├── photo-upload.ts             # UPLOAD_PHOTO_INIT + COMPLETE
│       ├── resume.ts
│       └── abandon.ts
├── __tests__/
│   ├── events/
│   │   ├── event-repository.test.ts
│   │   └── in-memory-event-store.test.ts
│   ├── orchestrator/
│   │   ├── dispatcher.test.ts
│   │   ├── response-builder.test.ts
│   │   └── action-handlers/
│   │       ├── create-conversation.test.ts
│   │       ├── select-unit.test.ts
│   │       ├── submit-initial-message.test.ts
│   │       ├── split-actions.test.ts
│   │       ├── confirm-submission.test.ts
│   │       ├── photo-upload.test.ts
│   │       ├── resume.test.ts
│   │       └── abandon.test.ts
│   └── orchestrator-integration.test.ts

apps/web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── conversations/
│   │       │   ├── route.ts                    # POST /conversations
│   │       │   └── [id]/
│   │       │       ├── route.ts                # GET /conversations/:id
│   │       │       ├── select-unit/route.ts
│   │       │       ├── message/
│   │       │       │   ├── initial/route.ts
│   │       │       │   └── additional/route.ts
│   │       │       ├── split/
│   │       │       │   ├── confirm/route.ts
│   │       │       │   ├── merge/route.ts
│   │       │       │   ├── edit/route.ts
│   │       │       │   ├── add/route.ts
│   │       │       │   └── reject/route.ts
│   │       │       ├── followups/
│   │       │       │   └── answer/route.ts
│   │       │       ├── confirm-submission/route.ts
│   │       │       └── resume/route.ts
│   │       ├── conversations-drafts/
│   │       │   └── route.ts                    # GET /conversations/drafts
│   │       ├── photos/
│   │       │   ├── init/route.ts
│   │       │   └── complete/route.ts
│   │       └── health/
│   │           └── route.ts
│   └── middleware/
│       ├── auth.ts                             # Wire Phase 2 JWT to Next.js
│       ├── rate-limiter.ts                     # Spec §8 enforcement
│       └── request-context.ts                  # Request ID, structured logging
```

---

## Batch 1 — Event Infrastructure

> Goal: An append-only event repository interface and in-memory test implementation. INSERT + SELECT only. No UPDATE. No DELETE. Ever.

### Task 0: Event Types

**Files:**

- Create: `packages/core/src/events/types.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/events/event-repository.test.ts
import { describe, it, expect } from 'vitest';
import type { ConversationEvent, EventType } from '../../events/types.js';

describe('ConversationEvent type', () => {
  it('can construct a valid state_transition event', () => {
    const event: ConversationEvent = {
      event_id: 'evt-1',
      conversation_id: 'conv-1',
      event_type: 'state_transition',
      prior_state: 'intake_started',
      new_state: 'unit_selected',
      action_type: 'SELECT_UNIT',
      actor: 'tenant',
      payload: { unit_id: 'u1' },
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
      created_at: new Date().toISOString(),
    };
    expect(event.event_type).toBe('state_transition');
    expect(event.prior_state).toBe('intake_started');
  });

  it('can construct a message_received event', () => {
    const event: ConversationEvent = {
      event_id: 'evt-2',
      conversation_id: 'conv-1',
      event_type: 'message_received',
      prior_state: null,
      new_state: null,
      action_type: 'SUBMIT_INITIAL_MESSAGE',
      actor: 'tenant',
      payload: { message: 'My toilet is leaking' },
      pinned_versions: null,
      created_at: new Date().toISOString(),
    };
    expect(event.event_type).toBe('message_received');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/events/event-repository.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement types.ts**

```typescript
// packages/core/src/events/types.ts
import type { ActorType, PinnedVersions } from '@wo-agent/schemas';

/**
 * Event types for conversation_events table (spec §7, append-only-events skill).
 */
export type EventType =
  | 'state_transition'
  | 'message_received'
  | 'action_executed'
  | 'photo_attached'
  | 'error_occurred';

/**
 * Conversation event — append-only row in conversation_events (spec §7).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface ConversationEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: EventType;
  readonly prior_state: string | null;
  readonly new_state: string | null;
  readonly action_type: string | null;
  readonly actor: ActorType;
  readonly payload: Record<string, unknown> | null;
  readonly pinned_versions: PinnedVersions | null;
  readonly created_at: string;
}

/**
 * Query filters for reading events. SELECT only.
 */
export interface EventQuery {
  readonly conversation_id: string;
  readonly event_type?: EventType;
  readonly limit?: number;
  readonly order?: 'asc' | 'desc';
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/events/event-repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/events/types.ts packages/core/src/__tests__/events/event-repository.test.ts
git commit -m "feat(core): add ConversationEvent type for append-only event store"
```

---

### Task 1: Event Repository Interface

**Files:**

- Create: `packages/core/src/events/event-repository.ts`
- Modify: `packages/core/src/__tests__/events/event-repository.test.ts`

**Step 1: Add interface tests**

Append to `packages/core/src/__tests__/events/event-repository.test.ts`:

```typescript
import type { EventRepository } from '../../events/event-repository.js';

describe('EventRepository interface', () => {
  it('defines insert and query methods only (no update, no delete)', () => {
    // Type-level test: if this compiles, the interface is correct
    const repo: EventRepository = {
      insert: async (_event: ConversationEvent) => {},
      query: async (_filters: EventQuery) => [] as ConversationEvent[],
    };
    expect(typeof repo.insert).toBe('function');
    expect(typeof repo.query).toBe('function');
    // Verify no update/delete exists at type level
    expect((repo as Record<string, unknown>)['update']).toBeUndefined();
    expect((repo as Record<string, unknown>)['delete']).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/events/event-repository.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement event-repository.ts**

```typescript
// packages/core/src/events/event-repository.ts
import type { ConversationEvent, EventQuery } from './types.js';

/**
 * Append-only event repository (spec §7, append-only-events skill).
 * INSERT + SELECT only. No UPDATE. No DELETE. Ever.
 *
 * Implementations:
 * - InMemoryEventStore (testing)
 * - PostgresEventStore (production, Phase 8+)
 */
export interface EventRepository {
  /** Append a single event. */
  insert(event: ConversationEvent): Promise<void>;
  /** Query events by filters. Returns in order specified. */
  query(filters: EventQuery): Promise<readonly ConversationEvent[]>;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/events/event-repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/events/event-repository.ts packages/core/src/__tests__/events/event-repository.test.ts
git commit -m "feat(core): add EventRepository interface (INSERT+SELECT only)"
```

---

### Task 2: In-Memory Event Store

**Files:**

- Create: `packages/core/src/events/in-memory-event-store.ts`
- Create: `packages/core/src/__tests__/events/in-memory-event-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/events/in-memory-event-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import type { ConversationEvent } from '../../events/types.js';

function makeEvent(overrides: Partial<ConversationEvent> = {}): ConversationEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    conversation_id: 'conv-1',
    event_type: 'state_transition',
    prior_state: 'intake_started',
    new_state: 'unit_selected',
    action_type: 'SELECT_UNIT',
    actor: 'tenant',
    payload: null,
    pinned_versions: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('inserts and queries events', async () => {
    const event = makeEvent();
    await store.insert(event);
    const results = await store.query({ conversation_id: 'conv-1' });
    expect(results).toHaveLength(1);
    expect(results[0].event_id).toBe(event.event_id);
  });

  it('filters by conversation_id', async () => {
    await store.insert(makeEvent({ conversation_id: 'conv-1' }));
    await store.insert(makeEvent({ conversation_id: 'conv-2' }));
    const results = await store.query({ conversation_id: 'conv-1' });
    expect(results).toHaveLength(1);
  });

  it('filters by event_type', async () => {
    await store.insert(makeEvent({ event_type: 'state_transition' }));
    await store.insert(makeEvent({ event_type: 'message_received' }));
    const results = await store.query({
      conversation_id: 'conv-1',
      event_type: 'state_transition',
    });
    expect(results).toHaveLength(1);
    expect(results[0].event_type).toBe('state_transition');
  });

  it('returns events in ascending order by default', async () => {
    await store.insert(makeEvent({ event_id: 'e1', created_at: '2026-01-01T00:00:00Z' }));
    await store.insert(makeEvent({ event_id: 'e2', created_at: '2026-01-02T00:00:00Z' }));
    const results = await store.query({ conversation_id: 'conv-1' });
    expect(results[0].event_id).toBe('e1');
    expect(results[1].event_id).toBe('e2');
  });

  it('supports descending order', async () => {
    await store.insert(makeEvent({ event_id: 'e1', created_at: '2026-01-01T00:00:00Z' }));
    await store.insert(makeEvent({ event_id: 'e2', created_at: '2026-01-02T00:00:00Z' }));
    const results = await store.query({ conversation_id: 'conv-1', order: 'desc' });
    expect(results[0].event_id).toBe('e2');
  });

  it('respects limit', async () => {
    await store.insert(makeEvent({ event_id: 'e1', created_at: '2026-01-01T00:00:00Z' }));
    await store.insert(makeEvent({ event_id: 'e2', created_at: '2026-01-02T00:00:00Z' }));
    await store.insert(makeEvent({ event_id: 'e3', created_at: '2026-01-03T00:00:00Z' }));
    const results = await store.query({ conversation_id: 'conv-1', limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('rejects duplicate event_id', async () => {
    const event = makeEvent({ event_id: 'dup-1' });
    await store.insert(event);
    await expect(store.insert(event)).rejects.toThrow(/duplicate/i);
  });

  it('has no update or delete methods', () => {
    expect((store as Record<string, unknown>)['update']).toBeUndefined();
    expect((store as Record<string, unknown>)['delete']).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/events/in-memory-event-store.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement in-memory-event-store.ts**

```typescript
// packages/core/src/events/in-memory-event-store.ts
import type { EventRepository } from './event-repository.js';
import type { ConversationEvent, EventQuery } from './types.js';

/**
 * In-memory event store for testing (append-only-events skill).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export class InMemoryEventStore implements EventRepository {
  private readonly events: ConversationEvent[] = [];
  private readonly ids = new Set<string>();

  async insert(event: ConversationEvent): Promise<void> {
    if (this.ids.has(event.event_id)) {
      throw new Error(`Duplicate event_id: ${event.event_id}`);
    }
    this.ids.add(event.event_id);
    this.events.push(event);
  }

  async query(filters: EventQuery): Promise<readonly ConversationEvent[]> {
    let results = this.events.filter((e) => e.conversation_id === filters.conversation_id);

    if (filters.event_type) {
      results = results.filter((e) => e.event_type === filters.event_type);
    }

    results.sort((a, b) => {
      const cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return filters.order === 'desc' ? -cmp : cmp;
    });

    if (filters.limit !== undefined) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/events/in-memory-event-store.test.ts`
Expected: PASS

**Step 5: Create events barrel export**

```typescript
// packages/core/src/events/index.ts
export type { ConversationEvent, EventType, EventQuery } from './types.js';
export type { EventRepository } from './event-repository.js';
export { InMemoryEventStore } from './in-memory-event-store.js';
```

**Step 6: Commit**

```bash
git add packages/core/src/events/ packages/core/src/__tests__/events/
git commit -m "feat(core): add InMemoryEventStore implementing append-only EventRepository"
```

---

## Batch 2 — Orchestrator Core

> Goal: The central dispatch function that validates transitions, resolves guards, writes events, and builds responses.

### Task 3: Orchestrator Types and Dependencies

**Files:**

- Create: `packages/core/src/orchestrator/types.ts`

**Step 1: Implement types**

```typescript
// packages/core/src/orchestrator/types.ts
import type {
  ConversationState,
  OrchestratorActionRequest,
  OrchestratorActionResponse,
} from '@wo-agent/schemas';
import type { EventRepository } from '../events/event-repository.js';
import type { ConversationSession } from '../session/types.js';
import type { TransitionContext } from '../state-machine/guards.js';

/**
 * Dependencies injected into the orchestrator.
 * Follows dependency inversion — no concrete implementations here.
 */
export interface OrchestratorDependencies {
  readonly eventRepo: EventRepository;
  readonly sessionStore: SessionStore;
  readonly idGenerator: () => string;
  readonly clock: () => string; // ISO 8601
}

/**
 * Session store abstraction — the orchestrator reads/writes sessions through this.
 * Mutable table with optimistic locking (row_version).
 */
export interface SessionStore {
  get(conversationId: string): Promise<ConversationSession | null>;
  getByTenantUser(tenantUserId: string): Promise<readonly ConversationSession[]>;
  save(session: ConversationSession): Promise<void>;
}

/**
 * Result of dispatching an action through the orchestrator.
 */
export interface DispatchResult {
  readonly response: OrchestratorActionResponse;
  readonly session: ConversationSession;
}

/**
 * Context passed to individual action handlers.
 */
export interface ActionHandlerContext {
  readonly session: ConversationSession;
  readonly request: OrchestratorActionRequest;
  readonly deps: OrchestratorDependencies;
}

/**
 * Return type from an action handler.
 */
export interface ActionHandlerResult {
  readonly newState: ConversationState;
  readonly session: ConversationSession;
  readonly transitionContext?: TransitionContext;
  readonly uiMessages: readonly UIMessageInput[];
  readonly quickReplies?: readonly QuickReplyInput[];
  readonly sideEffects?: readonly SideEffectInput[];
  readonly errors?: readonly ErrorInput[];
  readonly eventPayload?: Record<string, unknown>;
  readonly eventType?: string;
}

export interface UIMessageInput {
  readonly role: 'system' | 'agent' | 'tenant';
  readonly content: string;
}

export interface QuickReplyInput {
  readonly label: string;
  readonly value: string;
  readonly action_type?: string;
}

export interface SideEffectInput {
  readonly effect_type: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly idempotency_key?: string;
}

export interface ErrorInput {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}
```

**Step 2: Commit**

```bash
git add packages/core/src/orchestrator/types.ts
git commit -m "feat(core): add orchestrator types and dependency interfaces"
```

---

### Task 4: Response Builder

**Files:**

- Create: `packages/core/src/orchestrator/response-builder.ts`
- Create: `packages/core/src/__tests__/orchestrator/response-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/response-builder.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { buildResponse } from '../../orchestrator/response-builder.js';
import type { ConversationSession } from '../../session/types.js';
import type { ActionHandlerResult, UIMessageInput } from '../../orchestrator/types.js';

const mockSession: ConversationSession = {
  conversation_id: 'conv-1',
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  state: ConversationState.UNIT_SELECTED,
  unit_id: 'u1',
  authorized_unit_ids: ['u1'],
  pinned_versions: {
    taxonomy_version: '1.0.0',
    schema_version: '1.0.0',
    model_id: 'gpt-4',
    prompt_version: '1.0.0',
  },
  prior_state_before_error: null,
  draft_photo_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  last_activity_at: '2026-01-01T01:00:00Z',
};

describe('buildResponse', () => {
  it('builds a response with conversation snapshot', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.UNIT_SELECTED,
      session: mockSession,
      uiMessages: [{ role: 'agent', content: 'Unit selected.' }],
    };
    const response = buildResponse(result);
    expect(response.conversation_snapshot.conversation_id).toBe('conv-1');
    expect(response.conversation_snapshot.state).toBe('unit_selected');
    expect(response.conversation_snapshot.unit_id).toBe('u1');
    expect(response.ui_directive.messages).toHaveLength(1);
    expect(response.errors).toEqual([]);
  });

  it('includes quick replies when provided', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.UNIT_SELECTION_REQUIRED,
      session: { ...mockSession, state: ConversationState.UNIT_SELECTION_REQUIRED },
      uiMessages: [{ role: 'agent', content: 'Select a unit:' }],
      quickReplies: [
        { label: 'Unit 1', value: 'u1', action_type: 'SELECT_UNIT' },
        { label: 'Unit 2', value: 'u2', action_type: 'SELECT_UNIT' },
      ],
    };
    const response = buildResponse(result);
    expect(response.ui_directive.quick_replies).toHaveLength(2);
  });

  it('includes errors when provided', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.INTAKE_STARTED,
      session: mockSession,
      uiMessages: [],
      errors: [{ code: 'INVALID_UNIT', message: 'Unit not authorized' }],
    };
    const response = buildResponse(result);
    expect(response.errors).toHaveLength(1);
    expect(response.errors[0].code).toBe('INVALID_UNIT');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/response-builder.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement response-builder.ts**

```typescript
// packages/core/src/orchestrator/response-builder.ts
import type {
  OrchestratorActionResponse,
  ConversationSnapshot,
  UIDirective,
} from '@wo-agent/schemas';
import type { ActionHandlerResult } from './types.js';

/**
 * Build an OrchestratorActionResponse from an action handler result.
 */
export function buildResponse(result: ActionHandlerResult): OrchestratorActionResponse {
  const snapshot: ConversationSnapshot = {
    conversation_id: result.session.conversation_id,
    state: result.session.state,
    unit_id: result.session.unit_id,
    pinned_versions: result.session.pinned_versions,
    created_at: result.session.created_at,
    last_activity_at: result.session.last_activity_at,
  };

  const directive: UIDirective = {
    messages: result.uiMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: result.session.last_activity_at,
    })),
    quick_replies: result.quickReplies?.map((qr) => ({
      label: qr.label,
      value: qr.value,
      action_type: qr.action_type as any,
    })),
  };

  return {
    conversation_snapshot: snapshot,
    ui_directive: directive,
    artifacts: [],
    pending_side_effects: result.sideEffects ?? [],
    errors: result.errors ?? [],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/response-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/response-builder.ts packages/core/src/__tests__/orchestrator/response-builder.test.ts
git commit -m "feat(core): add response builder for OrchestratorActionResponse"
```

---

### Task 5: Core Dispatcher

**Files:**

- Create: `packages/core/src/orchestrator/dispatcher.ts`
- Create: `packages/core/src/__tests__/orchestrator/dispatcher.test.ts`

The dispatcher is the heart of the orchestrator. It:

1. Validates the action is allowed from the current state
2. Delegates to the appropriate action handler
3. Validates the state transition
4. Writes a conversation event (append-only)
5. Updates the session
6. Returns the typed response

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/dispatcher.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { createSession } from '../../session/session.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

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

  // Test helper
  seed(session: ConversationSession) {
    this.sessions.set(session.conversation_id, session);
  }
}

function makeDeps(): OrchestratorDependencies & {
  sessionStore: InMemorySessionStore;
  eventRepo: InMemoryEventStore;
} {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-01-15T12:00:00Z',
  };
}

const testVersions = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'gpt-4',
  prompt_version: '1.0.0',
};

describe('createDispatcher', () => {
  let deps: ReturnType<typeof makeDeps>;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  it('dispatches CREATE_CONVERSATION and returns new session', async () => {
    const result = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.conversation_snapshot.state).toBe('intake_started');
    expect(result.response.errors).toEqual([]);
  });

  it('rejects invalid transitions with typed error', async () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: 'conv-1',
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.errors).toHaveLength(1);
    expect(result.response.errors[0].code).toBe('INVALID_TRANSITION');
  });

  it('rejects system events from client actions', async () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: 'conv-1',
      action_type: 'LLM_SPLIT_SUCCESS' as any,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.errors).toHaveLength(1);
    expect(result.response.errors[0].code).toBe('SYSTEM_EVENT_REJECTED');
  });

  it('writes a conversation event on successful dispatch', async () => {
    await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    const events = await deps.eventRepo.query({ conversation_id: 'id-1' });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event_type).toBe('state_transition');
  });

  it('handles photo upload without state change', async () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: testVersions,
    });
    deps.sessionStore.seed(session);

    const result = await dispatch({
      conversation_id: 'conv-1',
      action_type: ActionType.UPLOAD_PHOTO_INIT,
      actor: ActorType.TENANT,
      tenant_input: { filename: 'leak.jpg', content_type: 'image/jpeg', size_bytes: 1024 },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    });

    expect(result.response.conversation_snapshot.state).toBe('intake_started');
    expect(result.response.errors).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/dispatcher.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement dispatcher.ts**

```typescript
// packages/core/src/orchestrator/dispatcher.ts
import { ActionType, ALL_ACTION_TYPES } from '@wo-agent/schemas';
import type { OrchestratorActionRequest } from '@wo-agent/schemas';
import { isValidTransition, isPhotoAction } from '../state-machine/transition.js';
import { ALL_SYSTEM_EVENTS } from '../state-machine/system-events.js';
import { updateSessionState, touchActivity, createSession } from '../session/session.js';
import type { ConversationEvent } from '../events/types.js';
import { buildResponse } from './response-builder.js';
import { getActionHandler } from './action-handlers/index.js';
import type { OrchestratorDependencies, DispatchResult, ActionHandlerContext } from './types.js';

const SYSTEM_EVENT_SET = new Set<string>(ALL_SYSTEM_EVENTS);

/**
 * Create the orchestrator dispatcher.
 * The orchestrator is the ONLY component that transitions state,
 * calls LLM tools, creates WOs, sends notifications, and writes events (spec §10.1).
 */
export function createDispatcher(deps: OrchestratorDependencies) {
  return async function dispatch(request: OrchestratorActionRequest): Promise<DispatchResult> {
    const { action_type, auth_context } = request;

    // Guard: reject system events from client-facing requests (spec §11.2)
    if (SYSTEM_EVENT_SET.has(action_type)) {
      const errorSession = createSession({
        conversation_id: request.conversation_id ?? 'unknown',
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: {
          taxonomy_version: '',
          schema_version: '',
          model_id: '',
          prompt_version: '',
        },
      });
      return {
        response: buildResponse({
          newState: errorSession.state,
          session: errorSession,
          uiMessages: [],
          errors: [
            {
              code: 'SYSTEM_EVENT_REJECTED',
              message: 'System events cannot be submitted by clients',
            },
          ],
        }),
        session: errorSession,
      };
    }

    // For CREATE_CONVERSATION, create a new session
    if (action_type === ActionType.CREATE_CONVERSATION) {
      const conversationId = deps.idGenerator();
      const session = createSession({
        conversation_id: conversationId,
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: {
          taxonomy_version: '1.0.0',
          schema_version: '1.0.0',
          model_id: 'default',
          prompt_version: '1.0.0',
        },
      });

      const handler = getActionHandler(action_type);
      const handlerResult = await handler({
        session,
        request: { ...request, conversation_id: conversationId },
        deps,
      });

      // Write event
      const event: ConversationEvent = {
        event_id: deps.idGenerator(),
        conversation_id: conversationId,
        event_type: 'state_transition',
        prior_state: null,
        new_state: handlerResult.newState,
        action_type,
        actor: request.actor,
        payload: handlerResult.eventPayload ?? null,
        pinned_versions: session.pinned_versions,
        created_at: deps.clock(),
      };
      await deps.eventRepo.insert(event);

      await deps.sessionStore.save(handlerResult.session);

      return {
        response: buildResponse(handlerResult),
        session: handlerResult.session,
      };
    }

    // For all other actions, load existing session
    const session = await deps.sessionStore.get(request.conversation_id!);
    if (!session) {
      const errorSession = createSession({
        conversation_id: request.conversation_id!,
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: {
          taxonomy_version: '',
          schema_version: '',
          model_id: '',
          prompt_version: '',
        },
      });
      return {
        response: buildResponse({
          newState: errorSession.state,
          session: errorSession,
          uiMessages: [],
          errors: [{ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' }],
        }),
        session: errorSession,
      };
    }

    // Photo actions: valid from any state, no state change
    if (isPhotoAction(action_type)) {
      const handler = getActionHandler(action_type);
      const handlerResult = await handler({ session, request, deps });

      const event: ConversationEvent = {
        event_id: deps.idGenerator(),
        conversation_id: session.conversation_id,
        event_type: 'photo_attached',
        prior_state: session.state,
        new_state: session.state,
        action_type,
        actor: request.actor,
        payload: handlerResult.eventPayload ?? null,
        pinned_versions: null,
        created_at: deps.clock(),
      };
      await deps.eventRepo.insert(event);

      const updatedSession = touchActivity(session);
      await deps.sessionStore.save(updatedSession);

      return {
        response: buildResponse({ ...handlerResult, session: updatedSession }),
        session: updatedSession,
      };
    }

    // Validate transition
    if (!isValidTransition(session.state, action_type)) {
      return {
        response: buildResponse({
          newState: session.state,
          session,
          uiMessages: [],
          errors: [
            {
              code: 'INVALID_TRANSITION',
              message: `Action ${action_type} is not valid from state ${session.state}`,
            },
          ],
        }),
        session,
      };
    }

    // Dispatch to handler
    const handler = getActionHandler(action_type);
    const handlerResult = await handler({ session, request, deps });

    // Apply state change
    const updatedSession =
      handlerResult.newState !== session.state
        ? updateSessionState(handlerResult.session, handlerResult.newState)
        : touchActivity(handlerResult.session);

    // Write event
    const event: ConversationEvent = {
      event_id: deps.idGenerator(),
      conversation_id: session.conversation_id,
      event_type: (handlerResult.eventType as any) ?? 'state_transition',
      prior_state: session.state,
      new_state: handlerResult.newState,
      action_type,
      actor: request.actor,
      payload: handlerResult.eventPayload ?? null,
      pinned_versions: null,
      created_at: deps.clock(),
    };
    await deps.eventRepo.insert(event);

    await deps.sessionStore.save(updatedSession);

    return {
      response: buildResponse({ ...handlerResult, session: updatedSession }),
      session: updatedSession,
    };
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/dispatcher.test.ts`
Expected: PASS (once action handlers in Task 6 are in place — this test file is built iteratively)

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/dispatcher.ts packages/core/src/__tests__/orchestrator/dispatcher.test.ts
git commit -m "feat(core): add orchestrator dispatcher with transition validation and event writing"
```

---

## Batch 3 — Action Handlers

> Goal: One handler per action type. Each handler is a pure function that computes the new state and response data. LLM calls are stubbed (Phases 4–6).

### Task 6: Action Handler Registry + CREATE_CONVERSATION

**Files:**

- Create: `packages/core/src/orchestrator/action-handlers/index.ts`
- Create: `packages/core/src/orchestrator/action-handlers/create-conversation.ts`
- Create: `packages/core/src/__tests__/orchestrator/action-handlers/create-conversation.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/action-handlers/create-conversation.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleCreateConversation } from '../../../orchestrator/action-handlers/create-conversation.js';
import { createSession } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(unitIds: string[]): ActionHandlerContext {
  let counter = 0;
  const session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: unitIds,
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: unitIds,
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
    },
  };
}

describe('handleCreateConversation', () => {
  it('returns intake_started for multi-unit tenant', async () => {
    const ctx = makeContext(['u1', 'u2']);
    const result = await handleCreateConversation(ctx);
    expect(result.newState).toBe(ConversationState.INTAKE_STARTED);
    expect(result.uiMessages.length).toBeGreaterThan(0);
  });

  it('auto-selects unit for single-unit tenant', async () => {
    const ctx = makeContext(['u1']);
    const result = await handleCreateConversation(ctx);
    // Still intake_started — unit auto-resolve happens on SELECT_UNIT
    expect(result.newState).toBe(ConversationState.INTAKE_STARTED);
    expect(result.uiMessages.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/create-conversation.test.ts`
Expected: FAIL

**Step 3: Implement create-conversation.ts**

```typescript
// packages/core/src/orchestrator/action-handlers/create-conversation.ts
import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleCreateConversation(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request } = ctx;
  const unitCount = request.auth_context.authorized_unit_ids.length;

  const messages =
    unitCount > 1
      ? [
          {
            role: 'agent' as const,
            content: 'Welcome! Please select which unit this request is for.',
          },
        ]
      : [{ role: 'agent' as const, content: 'Welcome! How can we help you today?' }];

  const quickReplies =
    unitCount > 1
      ? request.auth_context.authorized_unit_ids.map((id) => ({
          label: `Unit ${id}`,
          value: id,
          action_type: 'SELECT_UNIT',
        }))
      : undefined;

  return {
    newState: ConversationState.INTAKE_STARTED,
    session,
    uiMessages: messages,
    quickReplies,
    eventPayload: { authorized_unit_ids: request.auth_context.authorized_unit_ids },
  };
}
```

**Step 4: Implement handler registry**

```typescript
// packages/core/src/orchestrator/action-handlers/index.ts
import { ActionType } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { handleCreateConversation } from './create-conversation.js';
import { handleSelectUnit } from './select-unit.js';
import { handleSubmitInitialMessage } from './submit-initial-message.js';
import { handleSubmitAdditionalMessage } from './submit-additional-message.js';
import { handleSplitAction } from './split-actions.js';
import { handleAnswerFollowups } from './answer-followups.js';
import { handleConfirmSubmission } from './confirm-submission.js';
import { handlePhotoUpload } from './photo-upload.js';
import { handleResume } from './resume.js';
import { handleAbandon } from './abandon.js';

type ActionHandler = (ctx: ActionHandlerContext) => Promise<ActionHandlerResult>;

const HANDLER_MAP: Record<string, ActionHandler> = {
  [ActionType.CREATE_CONVERSATION]: handleCreateConversation,
  [ActionType.SELECT_UNIT]: handleSelectUnit,
  [ActionType.SUBMIT_INITIAL_MESSAGE]: handleSubmitInitialMessage,
  [ActionType.SUBMIT_ADDITIONAL_MESSAGE]: handleSubmitAdditionalMessage,
  [ActionType.CONFIRM_SPLIT]: handleSplitAction,
  [ActionType.MERGE_ISSUES]: handleSplitAction,
  [ActionType.EDIT_ISSUE]: handleSplitAction,
  [ActionType.ADD_ISSUE]: handleSplitAction,
  [ActionType.REJECT_SPLIT]: handleSplitAction,
  [ActionType.ANSWER_FOLLOWUPS]: handleAnswerFollowups,
  [ActionType.CONFIRM_SUBMISSION]: handleConfirmSubmission,
  [ActionType.UPLOAD_PHOTO_INIT]: handlePhotoUpload,
  [ActionType.UPLOAD_PHOTO_COMPLETE]: handlePhotoUpload,
  [ActionType.RESUME]: handleResume,
  [ActionType.ABANDON]: handleAbandon,
};

export function getActionHandler(actionType: string): ActionHandler {
  const handler = HANDLER_MAP[actionType];
  if (!handler) {
    throw new Error(`No handler registered for action type: ${actionType}`);
  }
  return handler;
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/create-conversation.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/
git commit -m "feat(core): add action handler registry and CREATE_CONVERSATION handler"
```

---

### Task 7: SELECT_UNIT Handler

**Files:**

- Create: `packages/core/src/orchestrator/action-handlers/select-unit.ts`
- Create: `packages/core/src/__tests__/orchestrator/action-handlers/select-unit.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/action-handlers/select-unit.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSelectUnit } from '../../../orchestrator/action-handlers/select-unit.js';
import { createSession } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(
  unitIds: string[],
  selectedUnitId: string,
  state: string = ConversationState.INTAKE_STARTED,
): ActionHandlerContext {
  let counter = 0;
  const session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: unitIds,
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  return {
    session: { ...session, state: state as any },
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: selectedUnitId },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: unitIds,
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
    },
  };
}

describe('handleSelectUnit', () => {
  it('selects an authorized unit and transitions to unit_selected', async () => {
    const ctx = makeContext(['u1', 'u2'], 'u1');
    const result = await handleSelectUnit(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTED);
    expect(result.session.unit_id).toBe('u1');
  });

  it('rejects an unauthorized unit with error', async () => {
    const ctx = makeContext(['u1', 'u2'], 'u_invalid');
    const result = await handleSelectUnit(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0].code).toBe('UNIT_NOT_AUTHORIZED');
  });

  it('auto-selects when tenant has single unit', async () => {
    const ctx = makeContext(['u1'], 'u1');
    const result = await handleSelectUnit(ctx);
    expect(result.newState).toBe(ConversationState.UNIT_SELECTED);
    expect(result.session.unit_id).toBe('u1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/select-unit.test.ts`
Expected: FAIL

**Step 3: Implement select-unit.ts**

```typescript
// packages/core/src/orchestrator/action-handlers/select-unit.ts
import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSelectUnit } from '@wo-agent/schemas';
import { resolveSelectUnit } from '../../state-machine/guards.js';
import { setSessionUnit } from '../../session/session.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleSelectUnit(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, request } = ctx;
  const input = request.tenant_input as TenantInputSelectUnit;
  const unitId = input.unit_id;

  const targetState = resolveSelectUnit(session.state, {
    authorized_unit_ids: request.auth_context.authorized_unit_ids,
    selected_unit_id: unitId,
  });

  if (targetState === null) {
    return {
      newState: session.state,
      session,
      uiMessages: [
        {
          role: 'agent',
          content: 'That unit is not available. Please select from your authorized units.',
        },
      ],
      errors: [
        { code: 'UNIT_NOT_AUTHORIZED', message: `Unit ${unitId} is not in your authorized list` },
      ],
    };
  }

  const updatedSession = setSessionUnit(session, unitId);

  return {
    newState: targetState,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: 'Unit selected. How can we help you today?' }],
    eventPayload: { unit_id: unitId },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/select-unit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/select-unit.ts packages/core/src/__tests__/orchestrator/action-handlers/select-unit.test.ts
git commit -m "feat(core): add SELECT_UNIT handler with membership guard"
```

---

### Task 8: SUBMIT_INITIAL_MESSAGE Handler

**Files:**

- Create: `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts`
- Create: `packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSubmitInitialMessage } from '../../../orchestrator/action-handlers/submit-initial-message.js';
import { createSession, updateSessionState, setSessionUnit } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(unitResolved: boolean): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  if (unitResolved) {
    session = updateSessionState(session, ConversationState.UNIT_SELECTED);
    session = setSessionUnit(session, 'u1');
  }
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
    },
  };
}

describe('handleSubmitInitialMessage', () => {
  it('transitions to split_in_progress when unit is resolved', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });

  it('rejects when unit is not resolved', async () => {
    const ctx = makeContext(false);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('UNIT_NOT_RESOLVED');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`
Expected: FAIL

**Step 3: Implement submit-initial-message.ts**

```typescript
// packages/core/src/orchestrator/action-handlers/submit-initial-message.ts
import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSubmitInitialMessage } from '@wo-agent/schemas';
import { resolveSubmitInitialMessage } from '../../state-machine/guards.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleSubmitInitialMessage(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session } = ctx;
  const input = ctx.request.tenant_input as TenantInputSubmitInitialMessage;

  const targetState = resolveSubmitInitialMessage({ unit_resolved: session.unit_id !== null });

  if (targetState === null) {
    return {
      newState: session.state,
      session,
      uiMessages: [
        { role: 'agent', content: 'Please select a unit before submitting your request.' },
      ],
      errors: [
        {
          code: 'UNIT_NOT_RESOLVED',
          message: 'A unit must be selected before submitting a message',
        },
      ],
    };
  }

  // The actual IssueSplitter LLM call is stubbed — Phase 4 implements it.
  // For now, transition to split_in_progress and return a "processing" message.
  return {
    newState: ConversationState.SPLIT_IN_PROGRESS,
    session,
    uiMessages: [{ role: 'agent', content: 'Thank you. Analyzing your request...' }],
    eventPayload: { message: input.message },
    eventType: 'message_received',
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/submit-initial-message.ts packages/core/src/__tests__/orchestrator/action-handlers/submit-initial-message.test.ts
git commit -m "feat(core): add SUBMIT_INITIAL_MESSAGE handler with unit-resolved guard"
```

---

### Task 9: Split Actions Handler (CONFIRM, MERGE, EDIT, ADD, REJECT)

**Files:**

- Create: `packages/core/src/orchestrator/action-handlers/split-actions.ts`
- Create: `packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSplitAction } from '../../../orchestrator/action-handlers/split-actions.js';
import { createSession, updateSessionState } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(
  actionType: string,
  tenantInput: Record<string, unknown> = {},
): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  session = updateSessionState(session, ConversationState.SPLIT_PROPOSED);
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: actionType as any,
      actor: ActorType.TENANT,
      tenant_input: tenantInput as any,
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
    },
  };
}

describe('handleSplitAction', () => {
  it('CONFIRM_SPLIT transitions to split_finalized', async () => {
    const ctx = makeContext(ActionType.CONFIRM_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
  });

  it('REJECT_SPLIT transitions to split_finalized', async () => {
    const ctx = makeContext(ActionType.REJECT_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
  });

  it('MERGE_ISSUES stays in split_proposed', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1', 'i2'] });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });

  it('EDIT_ISSUE stays in split_proposed', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'Updated' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });

  it('ADD_ISSUE stays in split_proposed', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: 'New issue' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/split-actions.test.ts`
Expected: FAIL

**Step 3: Implement split-actions.ts**

```typescript
// packages/core/src/orchestrator/action-handlers/split-actions.ts
import { ConversationState, ActionType } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handler for split-related actions (spec §13):
 * CONFIRM_SPLIT, MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE, REJECT_SPLIT
 *
 * CONFIRM_SPLIT/REJECT_SPLIT → split_finalized
 * MERGE/EDIT/ADD → split_proposed (same state, updated data)
 */
export async function handleSplitAction(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, request } = ctx;
  const actionType = request.action_type;

  if (actionType === ActionType.CONFIRM_SPLIT) {
    return {
      newState: ConversationState.SPLIT_FINALIZED,
      session,
      uiMessages: [{ role: 'agent', content: 'Split confirmed. Classifying your issues...' }],
      eventPayload: { split_action: 'confirm' },
    };
  }

  if (actionType === ActionType.REJECT_SPLIT) {
    return {
      newState: ConversationState.SPLIT_FINALIZED,
      session,
      uiMessages: [{ role: 'agent', content: 'Treating as a single issue. Classifying...' }],
      eventPayload: { split_action: 'reject' },
    };
  }

  // MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE — stay in split_proposed
  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session,
    uiMessages: [{ role: 'agent', content: 'Updated. Review the issues and confirm when ready.' }],
    eventPayload: { split_action: actionType, tenant_input: request.tenant_input },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/split-actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/split-actions.ts packages/core/src/__tests__/orchestrator/action-handlers/split-actions.test.ts
git commit -m "feat(core): add split action handlers (confirm, reject, merge, edit, add)"
```

---

### Task 10: Remaining Action Handlers (stubs)

**Files:**

- Create: `packages/core/src/orchestrator/action-handlers/submit-additional-message.ts`
- Create: `packages/core/src/orchestrator/action-handlers/answer-followups.ts`
- Create: `packages/core/src/orchestrator/action-handlers/confirm-submission.ts`
- Create: `packages/core/src/orchestrator/action-handlers/photo-upload.ts`
- Create: `packages/core/src/orchestrator/action-handlers/resume.ts`
- Create: `packages/core/src/orchestrator/action-handlers/abandon.ts`
- Create: `packages/core/src/__tests__/orchestrator/action-handlers/remaining-handlers.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/orchestrator/action-handlers/remaining-handlers.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { handleSubmitAdditionalMessage } from '../../../orchestrator/action-handlers/submit-additional-message.js';
import { handleAnswerFollowups } from '../../../orchestrator/action-handlers/answer-followups.js';
import { handleConfirmSubmission } from '../../../orchestrator/action-handlers/confirm-submission.js';
import { handlePhotoUpload } from '../../../orchestrator/action-handlers/photo-upload.js';
import { handleResume } from '../../../orchestrator/action-handlers/resume.js';
import { handleAbandon } from '../../../orchestrator/action-handlers/abandon.js';
import { createSession, updateSessionState } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

function makeContext(
  state: string,
  actionType: string,
  tenantInput: Record<string, unknown> = {},
): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  if (state !== ConversationState.INTAKE_STARTED) {
    session = updateSessionState(session, state as any);
  }
  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: actionType as any,
      actor: ActorType.TENANT,
      tenant_input: tenantInput as any,
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
    },
  };
}

describe('handleSubmitAdditionalMessage', () => {
  it('stays in needs_tenant_input', async () => {
    const ctx = makeContext(
      ConversationState.NEEDS_TENANT_INPUT,
      ActionType.SUBMIT_ADDITIONAL_MESSAGE,
      { message: 'Also...' },
    );
    const result = await handleSubmitAdditionalMessage(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
  });

  it('stays in tenant_confirmation_pending', async () => {
    const ctx = makeContext(
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ActionType.SUBMIT_ADDITIONAL_MESSAGE,
      { message: 'Wait...' },
    );
    const result = await handleSubmitAdditionalMessage(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});

describe('handleAnswerFollowups', () => {
  it('transitions to classification_in_progress', async () => {
    const ctx = makeContext(ConversationState.NEEDS_TENANT_INPUT, ActionType.ANSWER_FOLLOWUPS, {
      answers: [{ question_id: 'q1', answer: 'yes' }],
    });
    const result = await handleAnswerFollowups(ctx);
    expect(result.newState).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
  });
});

describe('handleConfirmSubmission', () => {
  it('transitions to submitted', async () => {
    const ctx = makeContext(
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ActionType.CONFIRM_SUBMISSION,
    );
    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);
  });
});

describe('handlePhotoUpload', () => {
  it('returns same state for UPLOAD_PHOTO_INIT', async () => {
    const ctx = makeContext(ConversationState.SPLIT_PROPOSED, ActionType.UPLOAD_PHOTO_INIT, {
      filename: 'leak.jpg',
      content_type: 'image/jpeg',
      size_bytes: 1024,
    });
    const result = await handlePhotoUpload(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
  });

  it('returns same state for UPLOAD_PHOTO_COMPLETE', async () => {
    const ctx = makeContext(ConversationState.INTAKE_STARTED, ActionType.UPLOAD_PHOTO_COMPLETE, {
      photo_id: 'p1',
      storage_key: 'key',
      sha256: 'abc',
    });
    const result = await handlePhotoUpload(ctx);
    expect(result.newState).toBe(ConversationState.INTAKE_STARTED);
  });
});

describe('handleResume', () => {
  it('returns current state for non-abandoned session', async () => {
    const ctx = makeContext(ConversationState.SUBMITTED, ActionType.RESUME);
    const result = await handleResume(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);
  });
});

describe('handleAbandon', () => {
  it('transitions to intake_abandoned', async () => {
    const ctx = makeContext(ConversationState.UNIT_SELECTED, ActionType.ABANDON);
    const result = await handleAbandon(ctx);
    expect(result.newState).toBe(ConversationState.INTAKE_ABANDONED);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/remaining-handlers.test.ts`
Expected: FAIL

**Step 3: Implement all remaining handlers**

`packages/core/src/orchestrator/action-handlers/submit-additional-message.ts`:

```typescript
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** SUBMIT_ADDITIONAL_MESSAGE: stays in current state, queues message (spec §12.2). */
export async function handleSubmitAdditionalMessage(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: "Message received. We'll address it shortly." }],
    eventPayload: { message: (ctx.request.tenant_input as any).message },
    eventType: 'message_received',
  };
}
```

`packages/core/src/orchestrator/action-handlers/answer-followups.ts`:

```typescript
import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** ANSWER_FOLLOWUPS: loops back to classification_in_progress (spec §11.2). */
export async function handleAnswerFollowups(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  return {
    newState: ConversationState.CLASSIFICATION_IN_PROGRESS,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Thank you. Re-classifying with your answers...' }],
    eventPayload: { answers: (ctx.request.tenant_input as any).answers },
  };
}
```

`packages/core/src/orchestrator/action-handlers/confirm-submission.ts`:

```typescript
import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** CONFIRM_SUBMISSION: the only gate to side effects (spec §10, non-negotiable #4). */
export async function handleConfirmSubmission(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  // Actual WO creation, notifications, etc. happen here in Phase 8.
  // For now, transition to submitted and return confirmation.
  return {
    newState: ConversationState.SUBMITTED,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: "Your request has been submitted. We'll be in touch." }],
    sideEffects: [{ effect_type: 'create_work_orders', status: 'pending' }],
    eventPayload: { confirmed: true },
  };
}
```

`packages/core/src/orchestrator/action-handlers/photo-upload.ts`:

```typescript
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** Photo uploads: valid from any state, no state change (spec §11.2). */
export async function handlePhotoUpload(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Photo received.' }],
    eventPayload: { photo: ctx.request.tenant_input },
    eventType: 'photo_attached',
  };
}
```

`packages/core/src/orchestrator/action-handlers/resume.ts`:

```typescript
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** RESUME: returns to current or prior state (spec §11.2, §12). */
export async function handleResume(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // For abandoned sessions, the dispatcher + guard resolves the target.
  // For non-abandoned, RESUME is a no-op that returns current state.
  return {
    newState: ctx.session.state,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: 'Welcome back. Resuming where you left off.' }],
    eventPayload: { resumed_from: ctx.session.state },
  };
}
```

`packages/core/src/orchestrator/action-handlers/abandon.ts`:

```typescript
import { ConversationState } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/** ABANDON: system-generated when tenant leaves (spec §12.3). */
export async function handleAbandon(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  return {
    newState: ConversationState.INTAKE_ABANDONED,
    session: ctx.session,
    uiMessages: [],
    eventPayload: { prior_state: ctx.session.state },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @wo-agent/core test -- src/__tests__/orchestrator/action-handlers/remaining-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/ packages/core/src/__tests__/orchestrator/action-handlers/remaining-handlers.test.ts
git commit -m "feat(core): add remaining action handlers (message, followups, confirm, photo, resume, abandon)"
```

---

### Task 11: Orchestrator Barrel Exports + Core Index Update

**Files:**

- Create: `packages/core/src/orchestrator/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create orchestrator barrel**

```typescript
// packages/core/src/orchestrator/index.ts
export { createDispatcher } from './dispatcher.js';
export { buildResponse } from './response-builder.js';
export { getActionHandler } from './action-handlers/index.js';
export type {
  OrchestratorDependencies,
  SessionStore,
  DispatchResult,
  ActionHandlerContext,
  ActionHandlerResult,
  UIMessageInput,
  QuickReplyInput,
  SideEffectInput,
  ErrorInput,
} from './types.js';
```

**Step 2: Update core index.ts**

```typescript
// packages/core/src/index.ts
// @wo-agent/core — barrel export
// Phase 2: Auth/Session Scaffolding + Conversation State Machine
export * from './state-machine/index.js';
export * from './auth/index.js';
export * from './session/index.js';

// Phase 3: Orchestrator + Events
export * from './events/index.js';
export * from './orchestrator/index.js';
```

**Step 3: Run typecheck**

Run: `pnpm --filter @wo-agent/core typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/orchestrator/index.ts packages/core/src/index.ts
git commit -m "feat(core): add orchestrator and events barrel exports"
```

---

## Batch 4 — Next.js App Scaffold

> Goal: Initialize the `apps/web` package with Next.js, wired to `@wo-agent/core`.

### Task 12: Initialize apps/web Package

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`

**Step 1: Create package.json**

```json
{
  "name": "@wo-agent/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wo-agent/core": "workspace:*",
    "@wo-agent/schemas": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "outDir": "./dist"
  },
  "include": ["src", "next-env.d.ts", "next.config.ts"],
  "exclude": ["node_modules"]
}
```

**Step 3: Create next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@wo-agent/core', '@wo-agent/schemas'],
};

export default nextConfig;
```

**Step 4: Create minimal app shell**

`apps/web/src/app/layout.tsx`:

```tsx
export const metadata = { title: 'Maintenance Portal' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx`:

```tsx
export default function Home() {
  return <div>Maintenance Portal — API Ready</div>;
}
```

**Step 5: Install dependencies**

Run: `pnpm install`

**Step 6: Verify**

Run: `pnpm --filter @wo-agent/web typecheck`
Expected: PASS (or expected Next.js type generation messages)

**Step 7: Commit**

```bash
git add apps/web/
git commit -m "chore: initialize apps/web Next.js package"
```

---

## Batch 5 — Middleware

> Goal: Auth middleware, rate limiter, and request context for API routes.

### Task 13: Auth Middleware for Next.js

**Files:**

- Create: `apps/web/src/middleware/auth.ts`

**Step 1: Implement auth middleware**

```typescript
// apps/web/src/middleware/auth.ts
import { NextRequest, NextResponse } from 'next/server';
import type { AuthContext } from '@wo-agent/schemas';
import { extractAuthFromHeader } from '@wo-agent/core';
import type { JwtConfig } from '@wo-agent/core';

// In production, load from env. For stubs, use a test config.
function getJwtConfig(): JwtConfig {
  return {
    accessTokenSecret: new TextEncoder().encode(
      process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-at-least-32-characters!!',
    ),
    refreshTokenSecret: new TextEncoder().encode(
      process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-at-least-32-characters!',
    ),
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    issuer: 'wo-agent',
    audience: 'wo-agent',
  };
}

export type AuthenticatedRequest = {
  authContext: AuthContext;
};

/**
 * Extract and validate auth from request headers.
 * Returns AuthContext on success, or a 401 NextResponse on failure.
 */
export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthContext | NextResponse> {
  const authHeader = request.headers.get('authorization');
  const config = getJwtConfig();
  const result = await extractAuthFromHeader(authHeader ?? undefined, config);

  if (!result.valid) {
    return NextResponse.json(
      { errors: [{ code: result.error.code, message: result.error.message }] },
      { status: 401 },
    );
  }

  return result.authContext;
}
```

**Step 2: Commit**

```bash
git add apps/web/src/middleware/auth.ts
git commit -m "feat(web): add auth middleware wiring JWT extraction to Next.js"
```

---

### Task 14: Rate Limiter Middleware

**Files:**

- Create: `apps/web/src/middleware/rate-limiter.ts`

**Step 1: Implement rate limiter**

```typescript
// apps/web/src/middleware/rate-limiter.ts
import { NextResponse } from 'next/server';
import { DEFAULT_RATE_LIMITS } from '@wo-agent/schemas';
import type { RateLimitConfig } from '@wo-agent/schemas';

/**
 * In-memory rate limiter for MVP (spec §8).
 * Production should use Redis or similar.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  userId: string,
  limitKey: keyof RateLimitConfig,
  windowMs: number = 60_000,
): NextResponse | null {
  const limit = DEFAULT_RATE_LIMITS[limitKey];
  const key = `${userId}:${limitKey}`;
  const now = Date.now();

  let window = windows.get(key);
  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
  }

  window.count++;
  if (window.count > limit) {
    return NextResponse.json(
      { errors: [{ code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' }] },
      { status: 429 },
    );
  }

  return null; // within limit
}
```

**Step 2: Commit**

```bash
git add apps/web/src/middleware/rate-limiter.ts
git commit -m "feat(web): add rate limiter middleware enforcing spec §8 limits"
```

---

### Task 15: Request Context

**Files:**

- Create: `apps/web/src/middleware/request-context.ts`

**Step 1: Implement request context**

```typescript
// apps/web/src/middleware/request-context.ts
import { randomUUID } from 'crypto';

/**
 * Request context for structured logging (spec §25).
 */
export interface RequestContext {
  readonly request_id: string;
  readonly timestamp: string;
}

export function createRequestContext(): RequestContext {
  return {
    request_id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}
```

**Step 2: Commit**

```bash
git add apps/web/src/middleware/request-context.ts
git commit -m "feat(web): add request context for structured logging"
```

---

## Batch 6 — Endpoint Stubs

> Goal: Next.js API route handlers for all spec §24.1 conversation endpoints. Each route extracts auth, rate-limits, builds an OrchestratorActionRequest, and dispatches.

### Task 16: Orchestrator Instance Factory

**Files:**

- Create: `apps/web/src/lib/orchestrator-factory.ts`

A singleton factory that creates the orchestrator dispatcher with test-appropriate dependencies.

**Step 1: Implement factory**

```typescript
// apps/web/src/lib/orchestrator-factory.ts
import { randomUUID } from 'crypto';
import { createDispatcher, InMemoryEventStore } from '@wo-agent/core';
import type { SessionStore, OrchestratorDependencies } from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';

// In-memory session store for MVP — PostgreSQL in Phase 8
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

let dispatcher: ReturnType<typeof createDispatcher> | null = null;
let deps: OrchestratorDependencies | null = null;

export function getOrchestrator() {
  if (!dispatcher) {
    deps = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => randomUUID(),
      clock: () => new Date().toISOString(),
    };
    dispatcher = createDispatcher(deps);
  }
  return dispatcher;
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/orchestrator-factory.ts
git commit -m "feat(web): add orchestrator factory with in-memory stores for MVP"
```

---

### Task 17: Conversation Endpoint Stubs

**Files:**

- Create: `apps/web/src/app/api/conversations/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/select-unit/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/message/initial/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/message/additional/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/split/confirm/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/split/merge/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/split/edit/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/split/add/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/split/reject/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/followups/answer/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/confirm-submission/route.ts`
- Create: `apps/web/src/app/api/conversations/[id]/resume/route.ts`
- Create: `apps/web/src/app/api/conversations-drafts/route.ts`

Each route follows the same pattern. Here is the **template** and two **concrete examples**. The implementing engineer replicates the pattern for all routes.

**Route template pattern:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 1. Auth
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  // 2. Rate limit
  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_messages_per_minute_per_user',
  );
  if (rateLimitResult) return rateLimitResult;

  // 3. Parse body
  const body = await request.json();
  const { id } = await params;

  // 4. Dispatch
  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: id,
    action_type: ActionType.THE_ACTION,
    actor: ActorType.TENANT,
    tenant_input: body,
    auth_context: authResult,
  });

  // 5. Return
  return NextResponse.json(result.response);
}
```

**Example 1: POST /conversations (create)**

```typescript
// apps/web/src/app/api/conversations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_new_conversations_per_day_per_user',
    24 * 60 * 60 * 1000,
  );
  if (rateLimitResult) return rateLimitResult;

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: null,
    action_type: ActionType.CREATE_CONVERSATION,
    actor: ActorType.TENANT,
    tenant_input: {},
    auth_context: authResult,
  });

  return NextResponse.json(result.response, { status: 201 });
}
```

**Example 2: POST /conversations/:id/select-unit**

```typescript
// apps/web/src/app/api/conversations/[id]/select-unit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_messages_per_minute_per_user',
  );
  if (rateLimitResult) return rateLimitResult;

  const body = await request.json();
  const { id } = await params;

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: id,
    action_type: ActionType.SELECT_UNIT,
    actor: ActorType.TENANT,
    tenant_input: body,
    auth_context: authResult,
  });

  return NextResponse.json(result.response);
}
```

**Action-to-endpoint mapping (implement each following the template):**

| Endpoint                                     | Action Type                 | Rate Limit Key                           |
| -------------------------------------------- | --------------------------- | ---------------------------------------- |
| `POST /conversations`                        | `CREATE_CONVERSATION`       | `max_new_conversations_per_day_per_user` |
| `POST /conversations/:id/select-unit`        | `SELECT_UNIT`               | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/message/initial`    | `SUBMIT_INITIAL_MESSAGE`    | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/message/additional` | `SUBMIT_ADDITIONAL_MESSAGE` | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/split/confirm`      | `CONFIRM_SPLIT`             | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/split/merge`        | `MERGE_ISSUES`              | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/split/edit`         | `EDIT_ISSUE`                | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/split/add`          | `ADD_ISSUE`                 | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/split/reject`       | `REJECT_SPLIT`              | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/followups/answer`   | `ANSWER_FOLLOWUPS`          | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/confirm-submission` | `CONFIRM_SUBMISSION`        | `max_messages_per_minute_per_user`       |
| `POST /conversations/:id/resume`             | `RESUME`                    | `max_messages_per_minute_per_user`       |

**Step 2: Commit**

```bash
git add apps/web/src/app/api/
git commit -m "feat(web): add conversation endpoint stubs dispatching to orchestrator"
```

---

### Task 18: Photo and Health Endpoint Stubs

**Files:**

- Create: `apps/web/src/app/api/photos/init/route.ts`
- Create: `apps/web/src/app/api/photos/complete/route.ts`
- Create: `apps/web/src/app/api/health/route.ts`

**Step 1: Implement photo routes**

`apps/web/src/app/api/photos/init/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_photo_uploads_per_conversation',
  );
  if (rateLimitResult) return rateLimitResult;

  const body = await request.json();

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: body.conversation_id,
    action_type: ActionType.UPLOAD_PHOTO_INIT,
    actor: ActorType.TENANT,
    tenant_input: {
      filename: body.filename,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
    },
    auth_context: authResult,
  });

  return NextResponse.json(result.response);
}
```

`apps/web/src/app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      db: 'stub',
      llm: 'stub',
      storage: 'stub',
      notifications: 'stub',
    },
  });
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/api/photos/ apps/web/src/app/api/health/
git commit -m "feat(web): add photo and health endpoint stubs"
```

---

## Batch 7 — Integration Tests + Final Verification

> Goal: End-to-end orchestrator integration tests and full typecheck/test pass.

### Task 19: Orchestrator Integration Tests

**Files:**

- Create: `packages/core/src/__tests__/orchestrator-integration.test.ts`

**Step 1: Write integration tests**

```typescript
// packages/core/src/__tests__/orchestrator-integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { createDispatcher } from '../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../events/in-memory-event-store.js';
import type { OrchestratorDependencies, SessionStore } from '../orchestrator/types.js';
import type { ConversationSession } from '../session/types.js';

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

const AUTH = { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] };

function makeDeps() {
  let counter = 0;
  return {
    eventRepo: new InMemoryEventStore(),
    sessionStore: new InMemorySessionStore(),
    idGenerator: () => `id-${++counter}`,
    clock: () => new Date().toISOString(),
  };
}

describe('Orchestrator integration: happy path', () => {
  let dispatch: ReturnType<typeof createDispatcher>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    dispatch = createDispatcher(deps);
  });

  it('walks CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE', async () => {
    // Step 1: Create
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r1.response.conversation_snapshot.state).toBe('intake_started');
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Step 2: Select unit
    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });
    expect(r2.response.conversation_snapshot.state).toBe('unit_selected');

    // Step 3: Submit initial message
    const r3 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });
    expect(r3.response.conversation_snapshot.state).toBe('split_in_progress');

    // Verify events were written
    const events = await deps.eventRepo.query({ conversation_id: convId });
    expect(events.length).toBe(3);
  });

  it('rejects invalid transition and leaves state unchanged', async () => {
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Try to CONFIRM_SPLIT from intake_started — invalid
    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    expect(r2.response.errors[0].code).toBe('INVALID_TRANSITION');
    expect(r2.response.conversation_snapshot.state).toBe('intake_started');
  });

  it('handles photo upload without state change', async () => {
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    const r2 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.UPLOAD_PHOTO_INIT,
      actor: ActorType.TENANT,
      tenant_input: { filename: 'leak.jpg', content_type: 'image/jpeg', size_bytes: 1024 },
      auth_context: AUTH,
    });
    expect(r2.response.conversation_snapshot.state).toBe('intake_started');
    expect(r2.response.errors).toEqual([]);
  });
});
```

**Step 2: Run tests**

Run: `pnpm --filter @wo-agent/core test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/orchestrator-integration.test.ts
git commit -m "test(core): add orchestrator integration tests for happy path and error cases"
```

---

### Task 20: Final Verification + Cleanup

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass across all packages.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

**Step 3: Verify no regressions in schemas**

Run: `pnpm --filter @wo-agent/schemas test`
Expected: 85 tests pass.

**Step 4: Commit any cleanup**

```bash
git add -A && git commit -m "chore: Phase 3 final cleanup and verification"
```

---

## Dependency Graph

```
Batch 1 (Event Infrastructure)
  └── Batch 2 (Orchestrator Core — needs events)
        └── Batch 3 (Action Handlers — needs dispatcher)
              └── Batch 7 (Integration Tests)
Batch 4 (Next.js Scaffold — independent)
  └── Batch 5 (Middleware — needs Next.js)
        └── Batch 6 (Endpoint Stubs — needs middleware + orchestrator)
              └── Batch 7 (Final Verification)
```

Batches 1–3 and Batch 4 can run in parallel.
Batch 5 requires Batch 4.
Batch 6 requires Batches 3 and 5.
Batch 7 requires all others.

---

## Exit Criteria for Phase 3

All of the following must be true before moving to Phase 4:

- [ ] `packages/core/src/events/` exists with EventRepository interface and InMemoryEventStore
- [ ] EventRepository has INSERT + SELECT only — no UPDATE, no DELETE
- [ ] `packages/core/src/orchestrator/` exists with dispatcher, response builder, and all 15 action handlers
- [ ] Orchestrator validates transitions against state machine before applying
- [ ] System events (LLM_SPLIT_SUCCESS, etc.) rejected from client-facing dispatch
- [ ] Every state transition writes a conversation event (append-only)
- [ ] Photo uploads work from any state without changing state
- [ ] `apps/web/` exists as Next.js app with all spec §24.1 endpoint stubs
- [ ] Auth middleware extracts JWT and produces AuthContext
- [ ] Rate limiter enforces spec §8 defaults
- [ ] `pnpm test` passes across all packages
- [ ] `pnpm typecheck` passes across all packages
- [ ] All action handlers have tests for valid transitions
- [ ] Integration test covers CREATE → SELECT_UNIT → SUBMIT_INITIAL_MESSAGE flow
- [ ] Invalid transitions return typed errors (not silently ignored)

---

## Spec References

| Section | What it governs                                                         |
| ------- | ----------------------------------------------------------------------- |
| §2      | Non-negotiables (all 7 apply)                                           |
| §7      | Append-only events (conversation_events schema)                         |
| §8      | Rate limits and payload caps                                            |
| §9      | AuthN/AuthZ (JWT, membership checks)                                    |
| §10     | Orchestrator contract (sole controller, action types, request/response) |
| §11     | State machine + transition matrix (authoritative)                       |
| §12     | Draft discovery, additional message policy, abandonment                 |
| §24     | API surface (all endpoints)                                             |
| §25     | Observability (structured logging, request_id)                          |
