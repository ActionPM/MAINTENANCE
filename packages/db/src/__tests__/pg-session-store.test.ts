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
      pinned_versions: {
        taxonomy_version: '1.0',
        schema_version: '1.0',
        model_id: 'm1',
        prompt_version: '1.0',
        cue_version: '1.2.0',
      },
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
      building_id: null,
      risk_triggers: [],
      escalation_state: { status: 'none' },
      escalation_plan_id: null,
    };

    await store.save(session as never);
    const query = pool.queries.find((q) => q.text.includes('INSERT'));
    expect(query).toBeDefined();
    expect(query!.text).toContain('ON CONFLICT');
  });

  it('getByTenantUser() filters by tenant_user_id', async () => {
    pool.nextRows = [];
    await store.getByTenantUser('tu-1');
    const query = pool.queries.find((q) => q.text.includes('tenant_user_id'));
    expect(query).toBeDefined();
  });
});
