import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresEscalationIncidentStore } from '../repos/pg-escalation-incident-store.js';
import type { EscalationIncident } from '@wo-agent/schemas';

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

const BASE_INCIDENT: EscalationIncident = {
  incident_id: 'inc-1',
  conversation_id: 'conv-1',
  building_id: 'bldg-1',
  plan_id: 'plan-1',
  summary: 'Test emergency',
  status: 'active',
  cycle_number: 1,
  max_cycles: 3,
  current_contact_index: 0,
  next_action_at: '2026-03-12T00:00:00.000Z',
  processing_lock_until: null,
  last_provider_action: null,
  accepted_by_phone: null,
  accepted_by_contact_id: null,
  accepted_at: null,
  contacted_phone_numbers: ['+15551234'],
  internal_alert_sent_cycles: [],
  attempts: [],
  row_version: 0,
  created_at: '2026-03-12T00:00:00.000Z',
  updated_at: '2026-03-12T00:00:00.000Z',
};

describe('PostgresEscalationIncidentStore', () => {
  let pool: ReturnType<typeof createFakePool>;
  let store: PostgresEscalationIncidentStore;

  beforeEach(() => {
    pool = createFakePool();
    store = new PostgresEscalationIncidentStore(pool as never);
  });

  it('create() inserts with all columns and returns true', async () => {
    pool.nextRowCount = 1;
    const result = await store.create(BASE_INCIDENT);
    expect(result).toBe(true);
    expect(pool.queries[0].text).toContain('INSERT INTO escalation_incidents');
    expect(pool.queries[0].values[0]).toBe('inc-1');
    expect(pool.queries[0].values[4]).toBe('Test emergency');
  });

  it('create() returns false on unique violation (duplicate active per conversation)', async () => {
    // Simulate Postgres 23505 unique_violation error
    pool.query = async () => {
      const err = new Error('unique_violation') as Error & { code: string };
      err.code = '23505';
      throw err;
    };
    const result = await store.create(BASE_INCIDENT);
    expect(result).toBe(false);
  });

  it('create() re-throws non-unique-violation errors', async () => {
    pool.query = async () => {
      const err = new Error('connection refused') as Error & { code: string };
      err.code = '08006';
      throw err;
    };
    await expect(store.create(BASE_INCIDENT)).rejects.toThrow('connection refused');
  });

  it('getById() returns mapped incident', async () => {
    pool.nextRows = [{ ...BASE_INCIDENT, attempts: [] }];
    const result = await store.getById('inc-1');
    expect(result).not.toBeNull();
    expect(result!.incident_id).toBe('inc-1');
    expect(result!.summary).toBe('Test emergency');
  });

  it('getById() returns null when not found', async () => {
    pool.nextRows = [];
    const result = await store.getById('missing');
    expect(result).toBeNull();
  });

  it('getActiveByConversation() filters by status and orders by created_at DESC', async () => {
    pool.nextRows = [{ ...BASE_INCIDENT }];
    const result = await store.getActiveByConversation('conv-1');
    expect(result).not.toBeNull();
    expect(pool.queries[0].text).toContain("status IN ('active', 'exhausted_retrying')");
    expect(pool.queries[0].text).toContain('ORDER BY created_at DESC LIMIT 1');
  });

  it('getDueIncidents() filters by next_action_at and lock', async () => {
    pool.nextRows = [{ ...BASE_INCIDENT }];
    const result = await store.getDueIncidents('2026-03-12T01:00:00.000Z');
    expect(result).toHaveLength(1);
    expect(pool.queries[0].text).toContain('next_action_at <= $1');
    expect(pool.queries[0].text).toContain('processing_lock_until');
  });

  it('getActiveByContactedPhone() uses ANY on text array', async () => {
    pool.nextRows = [{ ...BASE_INCIDENT }];
    const result = await store.getActiveByContactedPhone('+15551234');
    expect(result).toHaveLength(1);
    expect(pool.queries[0].text).toContain('ANY(contacted_phone_numbers)');
  });

  it('update() uses CAS with row_version and returns true on success', async () => {
    pool.nextRowCount = 1;
    const result = await store.update(BASE_INCIDENT, 0);
    expect(result).toBe(true);
    expect(pool.queries[0].text).toContain('row_version = row_version + 1');
    expect(pool.queries[0].text).toContain('WHERE incident_id = $14 AND row_version = $15');
  });

  it('update() returns false on CAS conflict', async () => {
    pool.nextRowCount = 0;
    const result = await store.update(BASE_INCIDENT, 99);
    expect(result).toBe(false);
  });

  it('mapRow handles Date objects for timestamp fields', async () => {
    pool.nextRows = [
      {
        ...BASE_INCIDENT,
        next_action_at: new Date('2026-03-12T00:00:00.000Z'),
        created_at: new Date('2026-03-12T00:00:00.000Z'),
        updated_at: new Date('2026-03-12T00:00:00.000Z'),
      },
    ];
    const result = await store.getById('inc-1');
    expect(result!.next_action_at).toBe('2026-03-12T00:00:00.000Z');
    expect(result!.created_at).toBe('2026-03-12T00:00:00.000Z');
  });
});
