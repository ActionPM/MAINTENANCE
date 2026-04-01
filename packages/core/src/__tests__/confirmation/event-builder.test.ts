import { describe, it, expect } from 'vitest';
import {
  buildConfirmationEvent,
  buildStalenessEvent,
  type ConfirmationEventInput,
  type StalenessEventInput,
} from '../../confirmation/event-builder.js';

describe('buildConfirmationEvent', () => {
  it('creates an event with event_type confirmation_accepted', () => {
    const input: ConfirmationEventInput = {
      eventId: 'evt-1',
      conversationId: 'conv-1',
      confirmationPayload: {
        issues: [
          {
            issue_id: 'issue-1',
            summary: 'Leaking toilet',
            raw_excerpt: 'My toilet is leaking',
            classification: { Category: 'maintenance' },
            confidence_by_field: { Category: 0.9 },
            missing_fields: [],
            needs_human_triage: false,
            recoverable_via_followup: false,
          },
        ],
      },
      createdAt: '2026-01-01T12:00:00.000Z',
    };
    const event = buildConfirmationEvent(input);
    expect(event.event_type).toBe('confirmation_accepted');
    expect(event.event_id).toBe('evt-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.payload.confirmation_payload.issues).toHaveLength(1);
  });
});

describe('buildStalenessEvent', () => {
  it('creates an event with event_type staleness_detected', () => {
    const input: StalenessEventInput = {
      eventId: 'evt-2',
      conversationId: 'conv-1',
      stalenessResult: {
        isStale: true,
        reasons: ['source_hash_changed'],
      },
      createdAt: '2026-01-01T12:00:00.000Z',
    };
    const event = buildStalenessEvent(input);
    expect(event.event_type).toBe('staleness_detected');
    expect(event.payload.staleness_result.isStale).toBe(true);
    expect(event.payload.staleness_result.reasons).toContain('source_hash_changed');
  });
});
