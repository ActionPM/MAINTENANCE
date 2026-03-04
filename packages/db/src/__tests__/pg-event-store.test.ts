import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresEventStore } from '../repos/pg-event-store.js';
import type { Pool } from '../pool.js';

// Fake pool for unit tests — integration tests hit real Neon
interface FakePool extends Pool {
  lastQuery: { text: string; values: unknown[] } | null;
  queries: { text: string; values: unknown[] }[];
  nextRows: Record<string, unknown>[];
}

function createFakePool(): FakePool {
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
  return fake as unknown as FakePool;
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
