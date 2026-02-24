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
    const results = await store.query({ conversation_id: 'conv-1', event_type: 'state_transition' });
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
    expect((store as unknown as Record<string, unknown>)['update']).toBeUndefined();
    expect((store as unknown as Record<string, unknown>)['delete']).toBeUndefined();
  });
});
