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

  it('insert() routes ConversationEvent to conversation_events with all columns', async () => {
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
    expect(pool.lastQuery!.values[6]).toBe('tenant'); // actor column
    expect(pool.lastQuery!.values).toHaveLength(10);
  });

  it('insert() routes RiskEvent to conversation_events with system actor and null state columns', async () => {
    const event = {
      event_id: 'r-1',
      conversation_id: 'c-1',
      event_type: 'risk_detected' as const,
      payload: { has_emergency: true },
      created_at: '2026-03-04T00:00:00Z',
    };

    await store.insert(event);

    expect(pool.lastQuery!.text).toContain('INSERT INTO conversation_events');
    expect(pool.lastQuery!.text).toContain("'system'");
    expect(pool.lastQuery!.values[0]).toBe('r-1');
    expect(pool.lastQuery!.values[2]).toBe('risk_detected');
    expect(pool.lastQuery!.values[3]).toBe(JSON.stringify({ has_emergency: true }));
    expect(pool.lastQuery!.values).toHaveLength(5);
  });

  it('insert() routes ConfirmationEvent to conversation_events with system actor', async () => {
    const event = {
      event_id: 'conf-1',
      conversation_id: 'c-1',
      event_type: 'confirmation_accepted' as const,
      payload: { confirmation_payload: { issues: [] } },
      created_at: '2026-03-04T00:00:00Z',
    };

    await store.insert(event);

    expect(pool.lastQuery!.text).toContain('INSERT INTO conversation_events');
    expect(pool.lastQuery!.values[0]).toBe('conf-1');
    expect(pool.lastQuery!.values[2]).toBe('confirmation_accepted');
  });

  it('insert() routes StalenessEvent to conversation_events with system actor', async () => {
    const event = {
      event_id: 'stale-1',
      conversation_id: 'c-1',
      event_type: 'staleness_detected' as const,
      payload: { staleness_result: { isStale: true, reasons: [] } },
      created_at: '2026-03-04T00:00:00Z',
    };

    await store.insert(event);

    expect(pool.lastQuery!.text).toContain('INSERT INTO conversation_events');
    expect(pool.lastQuery!.values[0]).toBe('stale-1');
    expect(pool.lastQuery!.values[2]).toBe('staleness_detected');
  });

  it('insert() routes FollowUpEvent (questions) with derived event_type and packed payload', async () => {
    const event = {
      event_id: 'fu-1',
      conversation_id: 'c-1',
      issue_id: 'iss-1',
      turn_number: 1,
      questions_asked: [{ question_id: 'q1', field_target: 'color', prompt: 'What color?', options: [] as string[], answer_type: 'text' as const }],
      answers_received: null,
      created_at: '2026-03-04T00:00:00Z',
    };

    await store.insert(event);

    expect(pool.lastQuery!.text).toContain('INSERT INTO conversation_events');
    expect(pool.lastQuery!.values[0]).toBe('fu-1');
    expect(pool.lastQuery!.values[2]).toBe('followup_questions_asked');
    const payload = JSON.parse(pool.lastQuery!.values[3] as string);
    expect(payload.issue_id).toBe('iss-1');
    expect(payload.turn_number).toBe(1);
    expect(payload.questions_asked).toHaveLength(1);
    expect(payload.answers_received).toBeNull();
  });

  it('insert() routes FollowUpEvent (answers) with followup_answers_received type', async () => {
    const event = {
      event_id: 'fu-2',
      conversation_id: 'c-1',
      issue_id: 'iss-1',
      turn_number: 1,
      questions_asked: [{ question_id: 'q1', field_target: 'color', prompt: 'What color?', options: [] as string[], answer_type: 'text' as const }],
      answers_received: [{ question_id: 'q1', answer: 'blue', received_at: '2026-03-04T00:01:00Z' }],
      created_at: '2026-03-04T00:00:00Z',
    };

    await store.insert(event);

    expect(pool.lastQuery!.values[2]).toBe('followup_answers_received');
    const payload = JSON.parse(pool.lastQuery!.values[3] as string);
    expect(payload.answers_received).toHaveLength(1);
  });

  it('insert() routes NotificationEvent to notification_events table', async () => {
    const event = {
      event_id: 'n-1',
      notification_id: 'notif-1',
      conversation_id: 'c-1',
      tenant_user_id: 'u-1',
      tenant_account_id: 'a-1',
      channel: 'in_app' as const,
      notification_type: 'work_order_created' as const,
      work_order_ids: ['wo-1'],
      issue_group_id: null,
      template_id: 'tpl-1',
      status: 'pending' as const,
      idempotency_key: 'idem-1',
      payload: {},
      created_at: '2026-03-04T00:00:00Z',
      sent_at: null,
      delivered_at: null,
      failed_at: null,
      failure_reason: null,
    };

    await store.insert(event);

    expect(pool.lastQuery!.text).toContain('INSERT INTO notification_events');
    expect(pool.lastQuery!.values[0]).toBe('n-1');
    expect(pool.lastQuery!.values[1]).toBe('notif-1');
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
