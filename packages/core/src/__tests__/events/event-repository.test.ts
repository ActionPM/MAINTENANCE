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
