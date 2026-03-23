import { describe, it, expect } from 'vitest';
import type { ConversationEvent, EventType, EventQuery } from '../../events/types.js';
import type { EventRepository } from '../../events/event-repository.js';

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
      cue_version: '1.2.0',
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
    expect((repo as unknown as Record<string, unknown>)['update']).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>)['delete']).toBeUndefined();
  });
});
