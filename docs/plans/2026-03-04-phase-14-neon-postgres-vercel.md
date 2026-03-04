# Phase 14: Neon PostgreSQL + Vercel Deployment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Replace all six in-memory stores with Neon PostgreSQL-backed repositories, and configure the Next.js app for Vercel deployment with Neon connection pooling.

**Architecture:** A new `packages/db` workspace package owns all SQL migrations, the Neon client pool, and six PostgreSQL repository classes — one per existing interface (`EventRepository`, `WorkOrderRepository`, `SessionStore`, `NotificationRepository`, `NotificationPreferenceStore`, `IdempotencyStore`). The web app's `orchestrator-factory.ts` switches from in-memory to Postgres repos based on a `DATABASE_URL` env var. Existing in-memory implementations remain for unit tests. Integration tests in `packages/db` verify SQL against a real Neon database.

**Tech Stack:** `@neondatabase/serverless` (Neon's WebSocket-based driver for Vercel edge/serverless), `postgres` (node-postgres for migrations), Vitest, pnpm workspaces

**Prerequisite skills:**
- @append-only-events — event tables are INSERT+SELECT only, never mutated
- @schema-first-development — repository interfaces are the contract
- @project-conventions — naming, file layout, barrel exports

---

### Task 0: Scaffold `packages/db` Workspace Package

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`
- Modify: `pnpm-workspace.yaml`

**Step 1: Create package.json**

```json
{
  "name": "@wo-agent/db",
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
    "migrate": "node --loader ts-node/esm src/migrate.ts",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.0",
    "@wo-agent/core": "workspace:*",
    "@wo-agent/schemas": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

**Step 3: Create empty barrel**

```typescript
// packages/db/src/index.ts
// Barrel — populated as repos are implemented.
```

**Step 4: Verify pnpm-workspace.yaml already includes `packages/**`**

Check that the existing `pnpm-workspace.yaml` glob covers `packages/db`. If it only lists specific paths, add `packages/db`.

**Step 5: Install dependencies**

Run: `cd /workspaces/MAINTENANCE && pnpm install`
Expected: lockfile updates, `@wo-agent/db` appears in workspace list.

**Step 6: Commit**

```bash
git add packages/db/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: scaffold @wo-agent/db package (phase 14)"
```

---

### Task 1: Neon Client Pool + Migration Runner

**Files:**
- Create: `packages/db/src/pool.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/migrations/`
- Test: `packages/db/src/__tests__/pool.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/pool.test.ts
import { describe, it, expect } from 'vitest';
import { createPool } from '../pool.js';

describe('createPool', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => createPool(undefined)).toThrow('DATABASE_URL');
  });

  it('returns a pool when DATABASE_URL is provided', () => {
    const pool = createPool('postgres://fake:fake@fake.neon.tech/fake?sslmode=require');
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/pool.test.ts`
Expected: FAIL — `createPool` not found.

**Step 3: Implement pool.ts**

```typescript
// packages/db/src/pool.ts
import { Pool } from '@neondatabase/serverless';

/**
 * Create a Neon connection pool.
 * In Vercel serverless, each invocation gets a short-lived pool.
 * The @neondatabase/serverless driver uses WebSockets for edge compat.
 */
export function createPool(databaseUrl: string | undefined): Pool {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for PostgreSQL connection');
  }
  return new Pool({ connectionString: databaseUrl });
}

export type { Pool } from '@neondatabase/serverless';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/pool.test.ts`
Expected: PASS

**Step 5: Create migration runner**

```typescript
// packages/db/src/migrate.ts
import { createPool } from './pool.js';

/**
 * Run all migrations in order.
 * Each migration is idempotent (IF NOT EXISTS).
 * Usage: DATABASE_URL=... pnpm --filter @wo-agent/db migrate
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Dynamically import all migration files
    const migrations = await loadMigrations();

    for (const migration of migrations) {
      const exists = await pool.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [migration.name],
      );
      if (exists.rows.length > 0) continue;

      await pool.query('BEGIN');
      try {
        await pool.query(migration.sql);
        await pool.query(
          'INSERT INTO _migrations (name) VALUES ($1)',
          [migration.name],
        );
        await pool.query('COMMIT');
        console.log(`  applied: ${migration.name}`);
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await pool.end();
  }
}

interface Migration {
  name: string;
  sql: string;
}

async function loadMigrations(): Promise<Migration[]> {
  // Migrations are co-located as .sql files, loaded in alphabetical order
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(import.meta.dirname, 'migrations');
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf-8');
    migrations.push({ name: file.replace('.sql', ''), sql });
  }
  return migrations;
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations complete'))
    .catch((err) => { console.error(err); process.exit(1); });
}
```

**Step 6: Commit**

```bash
git add packages/db/src/pool.ts packages/db/src/migrate.ts packages/db/src/__tests__/pool.test.ts
git commit -m "feat(db): add Neon pool + migration runner (phase 14)"
```

---

### Task 2: SQL Migrations — Event Tables (Append-Only)

**Files:**
- Create: `packages/db/src/migrations/001-conversation-events.sql`
- Create: `packages/db/src/migrations/002-notification-events.sql`

**Step 1: Write conversation_events migration**

```sql
-- 001-conversation-events.sql
-- Append-only event table (spec §7). INSERT + SELECT only.

CREATE TABLE IF NOT EXISTS conversation_events (
  event_id       UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  event_type     TEXT NOT NULL,
  prior_state    TEXT,
  new_state      TEXT,
  action_type    TEXT,
  actor          TEXT NOT NULL,
  payload        JSONB,
  pinned_versions JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_events_conversation
  ON conversation_events (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conv_events_type
  ON conversation_events (conversation_id, event_type);

-- Trigger guard: prevent UPDATE/DELETE on append-only table
CREATE OR REPLACE FUNCTION prevent_mutation()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'UPDATE/DELETE not allowed on append-only table %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'no_update_conversation_events'
  ) THEN
    CREATE TRIGGER no_update_conversation_events
      BEFORE UPDATE OR DELETE ON conversation_events
      FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
  END IF;
END;
$$;
```

**Step 2: Write notification_events migration**

```sql
-- 002-notification-events.sql
-- Append-only notification event table (spec §7, §20). INSERT + SELECT only.

CREATE TABLE IF NOT EXISTS notification_events (
  event_id           UUID PRIMARY KEY,
  notification_id    UUID NOT NULL,
  conversation_id    UUID NOT NULL,
  tenant_user_id     UUID NOT NULL,
  tenant_account_id  UUID NOT NULL,
  channel            TEXT NOT NULL,
  notification_type  TEXT NOT NULL,
  work_order_ids     UUID[] NOT NULL DEFAULT '{}',
  issue_group_id     UUID,
  template_id        TEXT NOT NULL,
  status             TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL UNIQUE,
  payload            JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at            TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  failed_at          TIMESTAMPTZ,
  failure_reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_notif_events_tenant_user
  ON notification_events (tenant_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_events_conversation
  ON notification_events (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_events_tenant_type_created
  ON notification_events (tenant_user_id, notification_type, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'no_update_notification_events'
  ) THEN
    CREATE TRIGGER no_update_notification_events
      BEFORE UPDATE OR DELETE ON notification_events
      FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
  END IF;
END;
$$;
```

**Step 3: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(db): add append-only event table migrations (phase 14)"
```

---

### Task 3: SQL Migrations — Mutable Tables

**Files:**
- Create: `packages/db/src/migrations/003-sessions.sql`
- Create: `packages/db/src/migrations/004-work-orders.sql`
- Create: `packages/db/src/migrations/005-idempotency-keys.sql`
- Create: `packages/db/src/migrations/006-notification-preferences.sql`

**Step 1: Write sessions migration**

```sql
-- 003-sessions.sql
-- Mutable session table. Stores JSON blob of ConversationSession.
-- Optimistic locking not needed here — session is only written by the
-- orchestrator within a single request, and the state machine prevents
-- concurrent transitions on the same conversation_id.

CREATE TABLE IF NOT EXISTS sessions (
  conversation_id  UUID PRIMARY KEY,
  tenant_user_id   UUID NOT NULL,
  state            TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user
  ON sessions (tenant_user_id);
```

**Step 2: Write work_orders migration**

```sql
-- 004-work-orders.sql
-- Mutable work order table with optimistic locking (spec §18).

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id    UUID PRIMARY KEY,
  issue_group_id   UUID NOT NULL,
  issue_id         UUID NOT NULL,
  conversation_id  UUID NOT NULL,
  client_id        UUID NOT NULL,
  property_id      UUID NOT NULL,
  unit_id          UUID NOT NULL,
  tenant_user_id   UUID NOT NULL,
  tenant_account_id UUID NOT NULL,
  status           TEXT NOT NULL DEFAULT 'created',
  status_history   JSONB NOT NULL DEFAULT '[]',
  raw_text         TEXT NOT NULL,
  summary_confirmed TEXT NOT NULL,
  photos           JSONB NOT NULL DEFAULT '[]',
  classification   JSONB NOT NULL DEFAULT '{}',
  confidence_by_field JSONB NOT NULL DEFAULT '{}',
  missing_fields   JSONB NOT NULL DEFAULT '[]',
  pets_present     TEXT NOT NULL DEFAULT 'unknown',
  risk_flags       JSONB,
  needs_human_triage BOOLEAN NOT NULL DEFAULT false,
  pinned_versions  JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_wo_issue_group
  ON work_orders (issue_group_id);

CREATE INDEX IF NOT EXISTS idx_wo_unit
  ON work_orders (unit_id);

CREATE INDEX IF NOT EXISTS idx_wo_client
  ON work_orders (client_id);

CREATE INDEX IF NOT EXISTS idx_wo_created
  ON work_orders (created_at);
```

**Step 3: Write idempotency_keys migration**

```sql
-- 005-idempotency-keys.sql
-- Idempotency store for deduplicating WO creation (spec §18).
-- Atomic reserve-then-complete protocol using INSERT ON CONFLICT.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key              TEXT PRIMARY KEY,
  work_order_ids   UUID[] NOT NULL DEFAULT '{}',
  completed        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Step 4: Write notification_preferences migration**

```sql
-- 006-notification-preferences.sql
-- Mutable notification preferences per tenant account (spec §20).

CREATE TABLE IF NOT EXISTS notification_preferences (
  preference_id               UUID PRIMARY KEY,
  tenant_account_id           UUID NOT NULL UNIQUE,
  in_app_enabled              BOOLEAN NOT NULL DEFAULT true,
  sms_enabled                 BOOLEAN NOT NULL DEFAULT false,
  sms_consent                 JSONB,
  notification_type_overrides JSONB NOT NULL DEFAULT '{}',
  cooldown_minutes            INTEGER NOT NULL DEFAULT 30,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Step 5: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(db): add mutable table migrations (phase 14)"
```

---

### Task 4: PostgresEventStore

**Files:**
- Create: `packages/db/src/repos/pg-event-store.ts`
- Test: `packages/db/src/__tests__/pg-event-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/pg-event-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresEventStore } from '../repos/pg-event-store.js';
import type { Pool } from '../pool.js';

// Fake pool for unit tests — integration tests hit real Neon
function createFakePool(): Pool & { lastQuery: { text: string; values: unknown[] } | null } {
  const fake = {
    lastQuery: null as { text: string; values: unknown[] } | null,
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    query: async (text: string, values?: unknown[]) => {
      const q = { text, values: values ?? [] };
      fake.lastQuery = q;
      fake.queries.push(q);
      return { rows: fake.nextRows, rowCount: fake.nextRows.length };
    },
    end: async () => {},
  };
  return fake as unknown as Pool & { lastQuery: { text: string; values: unknown[] } | null };
}

describe('PostgresEventStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresEventStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresEventStore(pool);
  });

  it('insert() executes INSERT with correct params', async () => {
    const event = {
      event_id: 'e-1',
      conversation_id: 'c-1',
      event_type: 'state_transition' as const,
      prior_state: 'awaiting_initial_message',
      new_state: 'split_in_progress',
      action_type: 'SUBMIT_INITIAL_MESSAGE',
      actor: 'tenant' as const,
      payload: { text: 'hello' },
      pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'm1', prompt_version: '1.0' },
      created_at: '2026-03-04T00:00:00Z',
    };

    await store.insert(event);

    expect(pool.lastQuery).not.toBeNull();
    expect(pool.lastQuery!.text).toContain('INSERT INTO conversation_events');
    expect(pool.lastQuery!.values[0]).toBe('e-1');
  });

  it('query() builds SELECT with filters', async () => {
    pool.nextRows = [];
    const result = await store.query({
      conversation_id: 'c-1',
      event_type: 'state_transition',
      order: 'desc',
      limit: 5,
    });

    expect(result).toEqual([]);
    expect(pool.lastQuery!.text).toContain('SELECT');
    expect(pool.lastQuery!.text).toContain('conversation_id');
    expect(pool.lastQuery!.text).toContain('event_type');
    expect(pool.lastQuery!.text).toContain('DESC');
    expect(pool.lastQuery!.text).toContain('LIMIT');
  });

  it('query() defaults to ASC order', async () => {
    pool.nextRows = [];
    await store.query({ conversation_id: 'c-1' });
    expect(pool.lastQuery!.text).toContain('ASC');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-event-store.test.ts`
Expected: FAIL — `PostgresEventStore` not found.

**Step 3: Implement PostgresEventStore**

```typescript
// packages/db/src/repos/pg-event-store.ts
import type { Pool } from '@neondatabase/serverless';
import type { FollowUpEvent, NotificationEvent } from '@wo-agent/schemas';
import type { EventRepository } from '@wo-agent/core';
import type { ConversationEvent, EventQuery } from '@wo-agent/core';
import type { ConfirmationEvent, StalenessEvent } from '@wo-agent/core';
import type { RiskEvent } from '@wo-agent/core';

type AnyEvent = ConversationEvent | FollowUpEvent | ConfirmationEvent | StalenessEvent | RiskEvent | NotificationEvent;

/**
 * PostgreSQL-backed event store (append-only, spec §7).
 * INSERT + SELECT only. Trigger guards prevent UPDATE/DELETE in the DB.
 */
export class PostgresEventStore implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async insert(event: AnyEvent): Promise<void> {
    const e = event as ConversationEvent;
    await this.pool.query(
      `INSERT INTO conversation_events
        (event_id, conversation_id, event_type, prior_state, new_state, action_type, actor, payload, pinned_versions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        e.event_id,
        e.conversation_id,
        e.event_type,
        e.prior_state ?? null,
        e.new_state ?? null,
        e.action_type ?? null,
        e.actor,
        e.payload ? JSON.stringify(e.payload) : null,
        e.pinned_versions ? JSON.stringify(e.pinned_versions) : null,
        e.created_at,
      ],
    );
  }

  async query(filters: EventQuery): Promise<readonly ConversationEvent[]> {
    const conditions: string[] = ['conversation_id = $1'];
    const values: unknown[] = [filters.conversation_id];
    let paramIndex = 2;

    if (filters.event_type) {
      conditions.push(`event_type = $${paramIndex}`);
      values.push(filters.event_type);
      paramIndex++;
    }

    const order = filters.order === 'desc' ? 'DESC' : 'ASC';
    let sql = `SELECT * FROM conversation_events WHERE ${conditions.join(' AND ')} ORDER BY created_at ${order}`;

    if (filters.limit !== undefined) {
      sql += ` LIMIT $${paramIndex}`;
      values.push(filters.limit);
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map(mapRowToConversationEvent);
  }
}

function mapRowToConversationEvent(row: Record<string, unknown>): ConversationEvent {
  return {
    event_id: row.event_id as string,
    conversation_id: row.conversation_id as string,
    event_type: row.event_type as ConversationEvent['event_type'],
    prior_state: (row.prior_state as string) ?? null,
    new_state: (row.new_state as string) ?? null,
    action_type: (row.action_type as string) ?? null,
    actor: row.actor as ConversationEvent['actor'],
    payload: (row.payload as Record<string, unknown>) ?? null,
    pinned_versions: (row.pinned_versions as ConversationEvent['pinned_versions']) ?? null,
    created_at: (row.created_at as Date).toISOString(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-event-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/repos/pg-event-store.ts packages/db/src/__tests__/pg-event-store.test.ts
git commit -m "feat(db): add PostgresEventStore (phase 14)"
```

---

### Task 5: PostgresWorkOrderStore

**Files:**
- Create: `packages/db/src/repos/pg-wo-store.ts`
- Test: `packages/db/src/__tests__/pg-wo-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/pg-wo-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresWorkOrderStore } from '../repos/pg-wo-store.js';

function createFakePool() {
  const fake = {
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    nextRowCount: 0,
    query: async (text: string, values?: unknown[]) => {
      fake.queries.push({ text, values: values ?? [] });
      return { rows: fake.nextRows, rowCount: fake.nextRowCount };
    },
    end: async () => {},
  };
  return fake;
}

function makeWo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    work_order_id: 'wo-1',
    issue_group_id: 'ig-1',
    issue_id: 'i-1',
    conversation_id: 'c-1',
    client_id: 'cl-1',
    property_id: 'p-1',
    unit_id: 'u-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    status: 'created',
    status_history: [{ status: 'created', changed_at: '2026-03-04T00:00:00Z', actor: 'system' }],
    raw_text: 'leaky faucet',
    summary_confirmed: 'Leaky faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'no' as const,
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'm1', prompt_version: '1.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

describe('PostgresWorkOrderStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresWorkOrderStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresWorkOrderStore(pool as never);
  });

  it('insertBatch() wraps multiple WOs in a transaction', async () => {
    const wo1 = makeWo({ work_order_id: 'wo-1' });
    const wo2 = makeWo({ work_order_id: 'wo-2' });
    await store.insertBatch([wo1, wo2] as never);

    const texts = pool.queries.map(q => q.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts.filter(t => t.includes('INSERT INTO work_orders')).length).toBe(2);
    expect(texts[texts.length - 1]).toBe('COMMIT');
  });

  it('getById() returns null when no rows', async () => {
    pool.nextRows = [];
    const result = await store.getById('wo-missing');
    expect(result).toBeNull();
  });

  it('updateStatus() uses optimistic locking', async () => {
    pool.nextRowCount = 1;
    pool.nextRows = [{ ...makeWo(), row_version: 2, status: 'action_required', status_history: [], updated_at: new Date() }];

    await store.updateStatus('wo-1', 'action_required', 'system', '2026-03-04T01:00:00Z', 1);

    const updateQuery = pool.queries.find(q => q.text.includes('UPDATE work_orders'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.text).toContain('row_version = $');
    expect(updateQuery!.text).toContain('row_version + 1');
  });

  it('updateStatus() throws on version mismatch', async () => {
    pool.nextRowCount = 0;
    pool.nextRows = [];

    await expect(
      store.updateStatus('wo-1', 'action_required', 'system', '2026-03-04T01:00:00Z', 1),
    ).rejects.toThrow('Version mismatch');
  });

  it('listAll() builds dynamic WHERE from filters', async () => {
    pool.nextRows = [];
    await store.listAll({ client_id: 'cl-1', from: '2026-01-01T00:00:00Z' });

    const query = pool.queries.find(q => q.text.includes('SELECT'));
    expect(query!.text).toContain('client_id');
    expect(query!.text).toContain('created_at >=');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-wo-store.test.ts`
Expected: FAIL — `PostgresWorkOrderStore` not found.

**Step 3: Implement PostgresWorkOrderStore**

```typescript
// packages/db/src/repos/pg-wo-store.ts
import type { Pool } from '@neondatabase/serverless';
import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import type { WorkOrderRepository, WorkOrderListFilters } from '@wo-agent/core';

export class PostgresWorkOrderStore implements WorkOrderRepository {
  constructor(private readonly pool: Pool) {}

  async insertBatch(workOrders: readonly WorkOrder[]): Promise<void> {
    await this.pool.query('BEGIN');
    try {
      for (const wo of workOrders) {
        await this.pool.query(
          `INSERT INTO work_orders
            (work_order_id, issue_group_id, issue_id, conversation_id, client_id, property_id, unit_id,
             tenant_user_id, tenant_account_id, status, status_history, raw_text, summary_confirmed,
             photos, classification, confidence_by_field, missing_fields, pets_present,
             risk_flags, needs_human_triage, pinned_versions, created_at, updated_at, row_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
          [
            wo.work_order_id, wo.issue_group_id, wo.issue_id, wo.conversation_id,
            wo.client_id, wo.property_id, wo.unit_id, wo.tenant_user_id, wo.tenant_account_id,
            wo.status, JSON.stringify(wo.status_history), wo.raw_text, wo.summary_confirmed,
            JSON.stringify(wo.photos), JSON.stringify(wo.classification),
            JSON.stringify(wo.confidence_by_field), JSON.stringify(wo.missing_fields),
            wo.pets_present, wo.risk_flags ? JSON.stringify(wo.risk_flags) : null,
            wo.needs_human_triage, JSON.stringify(wo.pinned_versions),
            wo.created_at, wo.updated_at, wo.row_version,
          ],
        );
      }
      await this.pool.query('COMMIT');
    } catch (err) {
      await this.pool.query('ROLLBACK');
      throw err;
    }
  }

  async getById(workOrderId: string): Promise<WorkOrder | null> {
    const result = await this.pool.query(
      'SELECT * FROM work_orders WHERE work_order_id = $1',
      [workOrderId],
    );
    return result.rows.length > 0 ? mapRowToWorkOrder(result.rows[0]) : null;
  }

  async getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]> {
    const result = await this.pool.query(
      'SELECT * FROM work_orders WHERE issue_group_id = $1',
      [issueGroupId],
    );
    return result.rows.map(mapRowToWorkOrder);
  }

  async listAll(filters?: WorkOrderListFilters): Promise<readonly WorkOrder[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.client_id) {
      conditions.push(`client_id = $${idx++}`);
      values.push(filters.client_id);
    }
    if (filters?.property_id) {
      conditions.push(`property_id = $${idx++}`);
      values.push(filters.property_id);
    }
    if (filters?.unit_id) {
      conditions.push(`unit_id = $${idx++}`);
      values.push(filters.unit_id);
    }
    if (filters?.unit_ids && filters.unit_ids.length > 0) {
      conditions.push(`unit_id = ANY($${idx++})`);
      values.push([...filters.unit_ids]);
    }
    if (filters?.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters?.to) {
      conditions.push(`created_at < $${idx++}`);
      values.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM work_orders ${where} ORDER BY created_at`,
      values,
    );
    return result.rows.map(mapRowToWorkOrder);
  }

  async updateStatus(
    workOrderId: string,
    newStatus: WorkOrderStatus,
    actor: ActorType,
    changedAt: string,
    expectedVersion: number,
  ): Promise<WorkOrder> {
    const result = await this.pool.query(
      `UPDATE work_orders
       SET status = $1,
           status_history = status_history || $2::jsonb,
           updated_at = $3,
           row_version = row_version + 1
       WHERE work_order_id = $4 AND row_version = $5
       RETURNING *`,
      [
        newStatus,
        JSON.stringify({ status: newStatus, changed_at: changedAt, actor }),
        changedAt,
        workOrderId,
        expectedVersion,
      ],
    );

    if (result.rowCount === 0) {
      throw new Error(`Version mismatch or not found: ${workOrderId}`);
    }

    return mapRowToWorkOrder(result.rows[0]);
  }
}

function mapRowToWorkOrder(row: Record<string, unknown>): WorkOrder {
  return {
    work_order_id: row.work_order_id as string,
    issue_group_id: row.issue_group_id as string,
    issue_id: row.issue_id as string,
    conversation_id: row.conversation_id as string,
    client_id: row.client_id as string,
    property_id: row.property_id as string,
    unit_id: row.unit_id as string,
    tenant_user_id: row.tenant_user_id as string,
    tenant_account_id: row.tenant_account_id as string,
    status: row.status as WorkOrderStatus,
    status_history: row.status_history as WorkOrder['status_history'],
    raw_text: row.raw_text as string,
    summary_confirmed: row.summary_confirmed as string,
    photos: row.photos as WorkOrder['photos'],
    classification: row.classification as Record<string, string>,
    confidence_by_field: row.confidence_by_field as Record<string, number>,
    missing_fields: row.missing_fields as readonly string[],
    pets_present: row.pets_present as WorkOrder['pets_present'],
    risk_flags: row.risk_flags as Record<string, unknown> | undefined,
    needs_human_triage: row.needs_human_triage as boolean,
    pinned_versions: row.pinned_versions as WorkOrder['pinned_versions'],
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
    row_version: row.row_version as number,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-wo-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/repos/pg-wo-store.ts packages/db/src/__tests__/pg-wo-store.test.ts
git commit -m "feat(db): add PostgresWorkOrderStore (phase 14)"
```

---

### Task 6: PostgresSessionStore

**Files:**
- Create: `packages/db/src/repos/pg-session-store.ts`
- Test: `packages/db/src/__tests__/pg-session-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/pg-session-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresSessionStore } from '../repos/pg-session-store.js';

function createFakePool() {
  const fake = {
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    query: async (text: string, values?: unknown[]) => {
      fake.queries.push({ text, values: values ?? [] });
      return { rows: fake.nextRows, rowCount: fake.nextRows.length };
    },
    end: async () => {},
  };
  return fake;
}

describe('PostgresSessionStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresSessionStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresSessionStore(pool as never);
  });

  it('get() returns null when no rows', async () => {
    pool.nextRows = [];
    const result = await store.get('c-missing');
    expect(result).toBeNull();
  });

  it('save() uses UPSERT', async () => {
    const session = {
      conversation_id: 'c-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      state: 'awaiting_initial_message',
      unit_id: null,
      authorized_unit_ids: ['u-1'],
      pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'm1', prompt_version: '1.0' },
      split_issues: null,
      classification_results: null,
      prior_state_before_error: null,
      followup_turn_number: 0,
      total_questions_asked: 0,
      previous_questions: [],
      pending_followup_questions: null,
      draft_photo_ids: [],
      created_at: '2026-03-04T00:00:00Z',
      last_activity_at: '2026-03-04T00:00:00Z',
      confirmation_entered_at: null,
      source_text_hash: null,
      split_hash: null,
      confirmation_presented: false,
      property_id: null,
      client_id: null,
      risk_triggers: [],
      escalation_state: { status: 'none' },
      escalation_plan_id: null,
    };

    await store.save(session as never);
    const query = pool.queries.find(q => q.text.includes('INSERT'));
    expect(query).toBeDefined();
    expect(query!.text).toContain('ON CONFLICT');
  });

  it('getByTenantUser() filters by tenant_user_id', async () => {
    pool.nextRows = [];
    await store.getByTenantUser('tu-1');
    const query = pool.queries.find(q => q.text.includes('tenant_user_id'));
    expect(query).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-session-store.test.ts`
Expected: FAIL

**Step 3: Implement PostgresSessionStore**

The session is stored as a JSONB `data` column containing the full `ConversationSession` object. This avoids mapping 20+ fields to individual columns — the session is an in-flight transient object, not a long-lived queryable entity.

```typescript
// packages/db/src/repos/pg-session-store.ts
import type { Pool } from '@neondatabase/serverless';
import type { SessionStore } from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

  async get(conversationId: string): Promise<ConversationSession | null> {
    const result = await this.pool.query(
      'SELECT data FROM sessions WHERE conversation_id = $1',
      [conversationId],
    );
    return result.rows.length > 0 ? result.rows[0].data as ConversationSession : null;
  }

  async getByTenantUser(tenantUserId: string): Promise<readonly ConversationSession[]> {
    const result = await this.pool.query(
      'SELECT data FROM sessions WHERE tenant_user_id = $1 ORDER BY last_activity_at DESC',
      [tenantUserId],
    );
    return result.rows.map(row => row.data as ConversationSession);
  }

  async save(session: ConversationSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (conversation_id, tenant_user_id, state, data, created_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conversation_id)
       DO UPDATE SET state = $3, data = $4, last_activity_at = $6`,
      [
        session.conversation_id,
        session.tenant_user_id,
        session.state,
        JSON.stringify(session),
        session.created_at,
        session.last_activity_at,
      ],
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-session-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/repos/pg-session-store.ts packages/db/src/__tests__/pg-session-store.test.ts
git commit -m "feat(db): add PostgresSessionStore (phase 14)"
```

---

### Task 7: PostgresNotificationStore + PostgresNotificationPreferenceStore

**Files:**
- Create: `packages/db/src/repos/pg-notification-store.ts`
- Test: `packages/db/src/__tests__/pg-notification-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/pg-notification-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresNotificationStore, PostgresNotificationPreferenceStore } from '../repos/pg-notification-store.js';

function createFakePool() {
  const fake = {
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    query: async (text: string, values?: unknown[]) => {
      fake.queries.push({ text, values: values ?? [] });
      return { rows: fake.nextRows, rowCount: fake.nextRows.length };
    },
    end: async () => {},
  };
  return fake;
}

describe('PostgresNotificationStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresNotificationStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresNotificationStore(pool as never);
  });

  it('insert() writes to notification_events', async () => {
    const event = {
      event_id: 'ne-1',
      notification_id: 'n-1',
      conversation_id: 'c-1',
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      channel: 'in_app' as const,
      notification_type: 'work_order_created' as const,
      work_order_ids: ['wo-1'],
      issue_group_id: 'ig-1',
      template_id: 'tpl-1',
      status: 'sent' as const,
      idempotency_key: 'ik-1',
      payload: {},
      created_at: '2026-03-04T00:00:00Z',
      sent_at: '2026-03-04T00:00:01Z',
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(event);
    expect(pool.queries[0].text).toContain('INSERT INTO notification_events');
  });

  it('queryByTenantUser() sorts by created_at DESC', async () => {
    pool.nextRows = [];
    await store.queryByTenantUser('tu-1', 10);
    expect(pool.queries[0].text).toContain('DESC');
    expect(pool.queries[0].text).toContain('LIMIT');
  });

  it('findRecentByTenantAndType() filters by cooldown', async () => {
    pool.nextRows = [];
    await store.findRecentByTenantAndType('tu-1', 'work_order_created', 30, '2026-03-04T01:00:00Z');
    expect(pool.queries[0].text).toContain('tenant_user_id');
    expect(pool.queries[0].text).toContain('notification_type');
    expect(pool.queries[0].text).toContain('created_at >=');
  });
});

describe('PostgresNotificationPreferenceStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresNotificationPreferenceStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresNotificationPreferenceStore(pool as never);
  });

  it('get() returns null for missing account', async () => {
    pool.nextRows = [];
    const result = await store.get('ta-missing');
    expect(result).toBeNull();
  });

  it('save() uses UPSERT on tenant_account_id', async () => {
    const pref = {
      preference_id: 'pref-1',
      tenant_account_id: 'ta-1',
      in_app_enabled: true,
      sms_enabled: false,
      sms_consent: null,
      notification_type_overrides: {},
      cooldown_minutes: 30,
      updated_at: '2026-03-04T00:00:00Z',
    };

    await store.save(pref);
    expect(pool.queries[0].text).toContain('ON CONFLICT');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-notification-store.test.ts`
Expected: FAIL

**Step 3: Implement both stores**

```typescript
// packages/db/src/repos/pg-notification-store.ts
import type { Pool } from '@neondatabase/serverless';
import type { NotificationEvent, NotificationPreference } from '@wo-agent/schemas';
import type { NotificationRepository, NotificationListFilters, NotificationPreferenceStore } from '@wo-agent/core';

export class PostgresNotificationStore implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async insert(event: NotificationEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_events
        (event_id, notification_id, conversation_id, tenant_user_id, tenant_account_id,
         channel, notification_type, work_order_ids, issue_group_id, template_id,
         status, idempotency_key, payload, created_at, sent_at, delivered_at, failed_at, failure_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.event_id, event.notification_id, event.conversation_id,
        event.tenant_user_id, event.tenant_account_id, event.channel,
        event.notification_type, event.work_order_ids,
        event.issue_group_id, event.template_id, event.status, event.idempotency_key,
        JSON.stringify(event.payload), event.created_at,
        event.sent_at, event.delivered_at, event.failed_at, event.failure_reason,
      ],
    );
  }

  async queryByTenantUser(tenantUserId: string, limit?: number): Promise<readonly NotificationEvent[]> {
    let sql = 'SELECT * FROM notification_events WHERE tenant_user_id = $1 ORDER BY created_at DESC';
    const values: unknown[] = [tenantUserId];
    if (limit !== undefined) {
      sql += ' LIMIT $2';
      values.push(limit);
    }
    const result = await this.pool.query(sql, values);
    return result.rows.map(mapRowToNotification);
  }

  async queryByConversation(conversationId: string): Promise<readonly NotificationEvent[]> {
    const result = await this.pool.query(
      'SELECT * FROM notification_events WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId],
    );
    return result.rows.map(mapRowToNotification);
  }

  async listAll(filters?: NotificationListFilters): Promise<readonly NotificationEvent[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.tenant_user_id) {
      conditions.push(`tenant_user_id = $${idx++}`);
      values.push(filters.tenant_user_id);
    }
    if (filters?.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters?.to) {
      conditions.push(`created_at < $${idx++}`);
      values.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM notification_events ${where} ORDER BY created_at`,
      values,
    );
    return result.rows.map(mapRowToNotification);
  }

  async findByIdempotencyKey(key: string): Promise<NotificationEvent | null> {
    const result = await this.pool.query(
      'SELECT * FROM notification_events WHERE idempotency_key = $1',
      [key],
    );
    return result.rows.length > 0 ? mapRowToNotification(result.rows[0]) : null;
  }

  async findRecentByTenantAndType(
    tenantUserId: string,
    notificationType: string,
    cooldownMinutes: number,
    now: string,
  ): Promise<readonly NotificationEvent[]> {
    const cutoff = new Date(new Date(now).getTime() - cooldownMinutes * 60_000).toISOString();
    const result = await this.pool.query(
      `SELECT * FROM notification_events
       WHERE tenant_user_id = $1 AND notification_type = $2 AND created_at >= $3`,
      [tenantUserId, notificationType, cutoff],
    );
    return result.rows.map(mapRowToNotification);
  }
}

export class PostgresNotificationPreferenceStore implements NotificationPreferenceStore {
  constructor(private readonly pool: Pool) {}

  async get(tenantAccountId: string): Promise<NotificationPreference | null> {
    const result = await this.pool.query(
      'SELECT * FROM notification_preferences WHERE tenant_account_id = $1',
      [tenantAccountId],
    );
    return result.rows.length > 0 ? mapRowToPref(result.rows[0]) : null;
  }

  async save(pref: NotificationPreference): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_preferences
        (preference_id, tenant_account_id, in_app_enabled, sms_enabled, sms_consent,
         notification_type_overrides, cooldown_minutes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_account_id)
       DO UPDATE SET in_app_enabled = $3, sms_enabled = $4, sms_consent = $5,
                     notification_type_overrides = $6, cooldown_minutes = $7, updated_at = $8`,
      [
        pref.preference_id, pref.tenant_account_id, pref.in_app_enabled, pref.sms_enabled,
        pref.sms_consent ? JSON.stringify(pref.sms_consent) : null,
        JSON.stringify(pref.notification_type_overrides), pref.cooldown_minutes, pref.updated_at,
      ],
    );
  }
}

function mapRowToNotification(row: Record<string, unknown>): NotificationEvent {
  return {
    event_id: row.event_id as string,
    notification_id: row.notification_id as string,
    conversation_id: row.conversation_id as string,
    tenant_user_id: row.tenant_user_id as string,
    tenant_account_id: row.tenant_account_id as string,
    channel: row.channel as NotificationEvent['channel'],
    notification_type: row.notification_type as NotificationEvent['notification_type'],
    work_order_ids: row.work_order_ids as string[],
    issue_group_id: (row.issue_group_id as string) ?? null,
    template_id: row.template_id as string,
    status: row.status as NotificationEvent['status'],
    idempotency_key: row.idempotency_key as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    created_at: (row.created_at as Date).toISOString(),
    sent_at: row.sent_at ? (row.sent_at as Date).toISOString() : null,
    delivered_at: row.delivered_at ? (row.delivered_at as Date).toISOString() : null,
    failed_at: row.failed_at ? (row.failed_at as Date).toISOString() : null,
    failure_reason: (row.failure_reason as string) ?? null,
  };
}

function mapRowToPref(row: Record<string, unknown>): NotificationPreference {
  return {
    preference_id: row.preference_id as string,
    tenant_account_id: row.tenant_account_id as string,
    in_app_enabled: row.in_app_enabled as boolean,
    sms_enabled: row.sms_enabled as boolean,
    sms_consent: (row.sms_consent as NotificationPreference['sms_consent']) ?? null,
    notification_type_overrides: (row.notification_type_overrides as Record<string, boolean>) ?? {},
    cooldown_minutes: row.cooldown_minutes as number,
    updated_at: (row.updated_at as Date).toISOString(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-notification-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/repos/pg-notification-store.ts packages/db/src/__tests__/pg-notification-store.test.ts
git commit -m "feat(db): add PostgresNotificationStore + PreferenceStore (phase 14)"
```

---

### Task 8: PostgresIdempotencyStore

**Files:**
- Create: `packages/db/src/repos/pg-idempotency-store.ts`
- Test: `packages/db/src/__tests__/pg-idempotency-store.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/pg-idempotency-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresIdempotencyStore } from '../repos/pg-idempotency-store.js';

function createFakePool() {
  const fake = {
    queries: [] as { text: string; values: unknown[] }[],
    nextRows: [] as Record<string, unknown>[],
    nextRowCount: 0,
    query: async (text: string, values?: unknown[]) => {
      fake.queries.push({ text, values: values ?? [] });
      return { rows: fake.nextRows, rowCount: fake.nextRowCount };
    },
    end: async () => {},
  };
  return fake;
}

describe('PostgresIdempotencyStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresIdempotencyStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresIdempotencyStore(pool as never);
  });

  it('tryReserve() uses INSERT ON CONFLICT', async () => {
    pool.nextRowCount = 1;
    pool.nextRows = [];
    const result = await store.tryReserve('key-1');
    expect(result.reserved).toBe(true);
    expect(pool.queries[0].text).toContain('INSERT INTO idempotency_keys');
    expect(pool.queries[0].text).toContain('ON CONFLICT');
  });

  it('complete() updates work_order_ids', async () => {
    pool.nextRowCount = 1;
    await store.complete('key-1', { work_order_ids: ['wo-1', 'wo-2'] });
    expect(pool.queries[0].text).toContain('UPDATE idempotency_keys');
    expect(pool.queries[0].text).toContain('completed = true');
  });

  it('get() returns null when no completed record', async () => {
    pool.nextRows = [];
    const result = await store.get('key-missing');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-idempotency-store.test.ts`
Expected: FAIL

**Step 3: Implement PostgresIdempotencyStore**

```typescript
// packages/db/src/repos/pg-idempotency-store.ts
import type { Pool } from '@neondatabase/serverless';
import type { IdempotencyStore, IdempotencyRecord, ReservationResult } from '@wo-agent/core';

/**
 * PostgreSQL idempotency store using INSERT ON CONFLICT for atomic reserve.
 * This implements the reserve-then-complete protocol from spec §18.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async tryReserve(key: string): Promise<ReservationResult> {
    // Attempt atomic insert. If key exists, the ON CONFLICT clause does nothing
    // and we detect it via rowCount.
    const result = await this.pool.query(
      `INSERT INTO idempotency_keys (key, work_order_ids, completed)
       VALUES ($1, '{}', false)
       ON CONFLICT (key) DO NOTHING`,
      [key],
    );

    if (result.rowCount === 1) {
      return { reserved: true };
    }

    // Key already exists — fetch the existing record
    const existing = await this.get(key);
    return {
      reserved: false,
      existing: existing ?? { work_order_ids: [] },
    };
  }

  async complete(key: string, record: IdempotencyRecord): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_keys
       SET work_order_ids = $1, completed = true
       WHERE key = $2 AND completed = false`,
      [[...record.work_order_ids], key],
    );
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      'SELECT work_order_ids FROM idempotency_keys WHERE key = $1 AND completed = true',
      [key],
    );
    if (result.rows.length === 0) return null;
    return { work_order_ids: result.rows[0].work_order_ids as string[] };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/pg-idempotency-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/repos/pg-idempotency-store.ts packages/db/src/__tests__/pg-idempotency-store.test.ts
git commit -m "feat(db): add PostgresIdempotencyStore (phase 14)"
```

---

### Task 9: Barrel Exports for @wo-agent/db

**Files:**
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/barrel.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/barrel.test.ts
import { describe, it, expect } from 'vitest';
import * as db from '../index.js';

describe('@wo-agent/db barrel exports', () => {
  it('exports createPool', () => {
    expect(typeof db.createPool).toBe('function');
  });

  it('exports PostgresEventStore', () => {
    expect(typeof db.PostgresEventStore).toBe('function');
  });

  it('exports PostgresWorkOrderStore', () => {
    expect(typeof db.PostgresWorkOrderStore).toBe('function');
  });

  it('exports PostgresSessionStore', () => {
    expect(typeof db.PostgresSessionStore).toBe('function');
  });

  it('exports PostgresNotificationStore', () => {
    expect(typeof db.PostgresNotificationStore).toBe('function');
  });

  it('exports PostgresNotificationPreferenceStore', () => {
    expect(typeof db.PostgresNotificationPreferenceStore).toBe('function');
  });

  it('exports PostgresIdempotencyStore', () => {
    expect(typeof db.PostgresIdempotencyStore).toBe('function');
  });

  it('exports runMigrations', () => {
    expect(typeof db.runMigrations).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- src/__tests__/barrel.test.ts`
Expected: FAIL

**Step 3: Populate barrel**

```typescript
// packages/db/src/index.ts
export { createPool } from './pool.js';
export type { Pool } from './pool.js';
export { runMigrations } from './migrate.js';
export { PostgresEventStore } from './repos/pg-event-store.js';
export { PostgresWorkOrderStore } from './repos/pg-wo-store.js';
export { PostgresSessionStore } from './repos/pg-session-store.js';
export { PostgresNotificationStore, PostgresNotificationPreferenceStore } from './repos/pg-notification-store.js';
export { PostgresIdempotencyStore } from './repos/pg-idempotency-store.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- src/__tests__/barrel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/index.ts packages/db/src/__tests__/barrel.test.ts
git commit -m "feat(db): barrel exports for @wo-agent/db (phase 14)"
```

---

### Task 10: Wire PostgreSQL Repos into Orchestrator Factory

**Files:**
- Modify: `apps/web/package.json` — add `@wo-agent/db` dependency
- Modify: `apps/web/src/lib/orchestrator-factory.ts` — conditional Postgres/InMemory

**Step 1: Add dependency**

Add `"@wo-agent/db": "workspace:*"` to `apps/web/package.json` dependencies.

Run: `pnpm install`

**Step 2: Modify orchestrator-factory.ts**

Replace the factory to choose Postgres repos when `DATABASE_URL` is set, falling back to in-memory otherwise.

```typescript
// apps/web/src/lib/orchestrator-factory.ts
import { randomUUID } from 'crypto';
import { createDispatcher, ERPSyncService, AnalyticsService } from '@wo-agent/core';
import { InMemoryEventStore, InMemoryWorkOrderStore, InMemoryIdempotencyStore } from '@wo-agent/core';
import { InMemoryNotificationStore, InMemoryNotificationPreferenceStore, MockSmsSender, NotificationService } from '@wo-agent/core';
import type { SessionStore, OrchestratorDependencies, UnitResolver, SlaPolicies, EventRepository, WorkOrderRepository, NotificationRepository, NotificationPreferenceStore, IdempotencyStore } from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';
import type { CueDictionary, IssueClassifierInput } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import { MockERPAdapter } from '@wo-agent/mock-erp';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };

// In-memory session store fallback
class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

interface Stores {
  eventRepo: EventRepository;
  workOrderRepo: WorkOrderRepository;
  notificationRepo: NotificationRepository;
  prefStore: NotificationPreferenceStore;
  sessionStore: SessionStore;
  idempotencyStore: IdempotencyStore;
}

function createStores(): Stores {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Lazy-import to avoid bundling @neondatabase/serverless when not needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPool, PostgresEventStore, PostgresWorkOrderStore, PostgresSessionStore, PostgresNotificationStore, PostgresNotificationPreferenceStore, PostgresIdempotencyStore } = require('@wo-agent/db');
    const pool = createPool(databaseUrl);
    return {
      eventRepo: new PostgresEventStore(pool),
      workOrderRepo: new PostgresWorkOrderStore(pool),
      notificationRepo: new PostgresNotificationStore(pool),
      prefStore: new PostgresNotificationPreferenceStore(pool),
      sessionStore: new PostgresSessionStore(pool),
      idempotencyStore: new PostgresIdempotencyStore(pool),
    };
  }

  // Fallback: in-memory for local dev without DATABASE_URL
  return {
    eventRepo: new InMemoryEventStore(),
    workOrderRepo: new InMemoryWorkOrderStore(),
    notificationRepo: new InMemoryNotificationStore(),
    prefStore: new InMemoryNotificationPreferenceStore(),
    sessionStore: new InMemorySessionStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
  };
}

let _deps: {
  workOrderRepo: WorkOrderRepository;
  notificationRepo: NotificationRepository;
  dispatcher: ReturnType<typeof createDispatcher>;
  erpAdapter: MockERPAdapter;
  erpSyncService: ERPSyncService;
  analyticsService: AnalyticsService;
} | null = null;

function ensureInitialized() {
  if (!_deps) {
    const stores = createStores();
    const smsSender = new MockSmsSender();
    const idGenerator = () => randomUUID();
    const clock = () => new Date().toISOString();

    const notificationService = new NotificationService({
      notificationRepo: stores.notificationRepo,
      preferenceStore: stores.prefStore,
      smsSender,
      idGenerator,
      clock,
    });

    const erpAdapter = new MockERPAdapter();
    const erpSyncService = new ERPSyncService({
      erpAdapter,
      workOrderRepo: stores.workOrderRepo,
      idGenerator,
      clock,
    });

    const deps: OrchestratorDependencies = {
      eventRepo: stores.eventRepo,
      sessionStore: stores.sessionStore,
      idGenerator,
      clock,
      issueSplitter: async (input) => ({
        issues: [{ issue_id: randomUUID(), summary: input.raw_text.slice(0, 200), raw_excerpt: input.raw_text }],
        issue_count: 1,
      }),
      issueClassifier: async (input: IssueClassifierInput) => ({
        issue_id: input.issue_id,
        classification: {
          Category: 'maintenance', Location: 'suite', Sub_Location: 'general',
          Maintenance_Category: 'general_maintenance', Maintenance_Object: 'other_object',
          Maintenance_Problem: 'not_working', Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj', Priority: 'normal',
        },
        model_confidence: {
          Category: 0.7, Location: 0.5, Sub_Location: 0.5, Maintenance_Category: 0.6,
          Maintenance_Object: 0.5, Maintenance_Problem: 0.5, Management_Category: 0.0,
          Management_Object: 0.0, Priority: 0.5,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: classificationCues as CueDictionary,
      taxonomy: loadTaxonomy(),
      unitResolver: {
        resolve: async (unitId: string) => ({ unit_id: unitId, property_id: `prop-${unitId}`, client_id: `client-${unitId}` }),
      } satisfies UnitResolver,
      workOrderRepo: stores.workOrderRepo,
      idempotencyStore: stores.idempotencyStore,
      notificationService,
      erpAdapter,
    };

    const analyticsService = new AnalyticsService({
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      slaPolicies: slaPoliciesJson as SlaPolicies,
      clock,
    });

    _deps = {
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      dispatcher: createDispatcher(deps),
      erpAdapter,
      erpSyncService,
      analyticsService,
    };
  }
  return _deps;
}

export function getOrchestrator() { return ensureInitialized().dispatcher; }
export function getWorkOrderRepo() { return ensureInitialized().workOrderRepo; }
export function getNotificationRepo() { return ensureInitialized().notificationRepo; }
export function getERPAdapter() { return ensureInitialized().erpAdapter; }
export function getERPSyncService() { return ensureInitialized().erpSyncService; }
export function getAnalyticsService() { return ensureInitialized().analyticsService; }
```

**Step 3: Run all tests**

Run: `pnpm test`
Expected: All existing tests pass (they use in-memory stores, unaffected by the factory change).

**Step 4: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/orchestrator-factory.ts pnpm-lock.yaml
git commit -m "feat(web): wire Postgres repos via DATABASE_URL env var (phase 14)"
```

---

### Task 11: Vercel Configuration

**Files:**
- Create: `apps/web/vercel.json`
- Create: `.env.example`

**Step 1: Create vercel.json**

```json
{
  "framework": "nextjs",
  "buildCommand": "pnpm --filter @wo-agent/web build",
  "installCommand": "pnpm install",
  "outputDirectory": "apps/web/.next"
}
```

**Step 2: Create .env.example**

```bash
# Neon PostgreSQL connection string (pooled endpoint for serverless)
# Get from: https://console.neon.tech → your project → Connection Details → Pooled
DATABASE_URL=postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# JWT secrets (32+ chars each)
JWT_ACCESS_SECRET=change-me-to-a-real-secret-at-least-32-chars
JWT_REFRESH_SECRET=change-me-to-a-real-secret-at-least-32-chars
```

**Step 3: Ensure .env is gitignored**

Check `.gitignore` contains `.env` and `.env.local`. If not, add them.

**Step 4: Commit**

```bash
git add apps/web/vercel.json .env.example .gitignore
git commit -m "chore: add Vercel config + env example (phase 14)"
```

---

### Task 12: Core Export Fixes — Ensure All Types Are Re-exported

**Files:**
- Modify: `packages/core/src/index.ts` — ensure `ConversationEvent`, `EventQuery`, `ConfirmationEvent`, `StalenessEvent`, `RiskEvent` types are exported so `@wo-agent/db` can import them

**Step 1: Write the failing test**

```typescript
// packages/db/src/__tests__/imports.test.ts
import { describe, it, expect } from 'vitest';

describe('core type imports used by @wo-agent/db', () => {
  it('can import EventRepository and related types', async () => {
    const core = await import('@wo-agent/core');
    expect(core.InMemoryEventStore).toBeDefined();
  });

  it('can import SessionStore type', async () => {
    // Type-only — just ensure the import resolves
    const core = await import('@wo-agent/core');
    expect(core).toBeDefined();
  });
});
```

**Step 2: Check current exports and add any missing ones**

Read `packages/core/src/index.ts` and verify all types needed by `@wo-agent/db` repos are exported. Add any missing re-exports (e.g., `ConversationEvent`, `EventQuery` from `./events/types.js`).

**Step 3: Run test to verify**

Run: `cd packages/db && pnpm test -- src/__tests__/imports.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/db/src/__tests__/imports.test.ts
git commit -m "fix(core): ensure all types needed by @wo-agent/db are exported (phase 14)"
```

---

### Task 13: Run Full Test Suite + Final Verification

**Files:** None (verification only)

**Step 1: Run all tests across all packages**

Run: `pnpm test`
Expected: All tests pass — in-memory tests in `packages/core`, fake-pool unit tests in `packages/db`, mock-erp tests, and web route tests.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors across all packages.

**Step 3: Verify build**

Run: `cd apps/web && pnpm build`
Expected: Next.js build succeeds.

**Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address final verification issues (phase 14)"
```

---

## Post-Plan: Deployment Checklist (Manual)

After all tasks are implemented, the following manual steps complete the deployment:

1. **Create Neon project** at console.neon.tech — choose `us-east-2` (closest to Vercel's default region)
2. **Run migrations:** `DATABASE_URL=<neon-pooled-url> pnpm --filter @wo-agent/db migrate`
3. **Create Vercel project** — link the GitHub repo, set root directory to `apps/web`
4. **Set environment variables** in Vercel dashboard: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
5. **Deploy** — push to main triggers automatic Vercel deploy
6. **Verify** — hit `/api/health` on the deployed URL
