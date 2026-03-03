import { describe, it, expect } from 'vitest';
import {
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
} from '../../risk/event-builder.js';
import type { MatchedTrigger, EscalationResult } from '@wo-agent/schemas';

describe('buildRiskDetectedEvent', () => {
  it('builds a risk_detected event with trigger details', () => {
    const triggers: MatchedTrigger[] = [{
      trigger: {
        trigger_id: 'fire-001',
        name: 'Fire',
        grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
        requires_confirmation: true,
        severity: 'emergency',
        mitigation_template_id: 'mit-fire',
      },
      matched_keywords: ['fire'],
      matched_regex: [],
      matched_taxonomy_paths: [],
    }];

    const event = buildRiskDetectedEvent({
      eventId: 'evt-1',
      conversationId: 'conv-1',
      triggersMatched: triggers,
      hasEmergency: true,
      highestSeverity: 'emergency',
      createdAt: '2026-03-03T00:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.event_type).toBe('risk_detected');
    expect(event.payload.triggers_matched).toHaveLength(1);
    expect(event.payload.has_emergency).toBe(true);
  });
});

describe('buildEscalationAttemptEvent', () => {
  it('builds an escalation_attempt event', () => {
    const event = buildEscalationAttemptEvent({
      eventId: 'evt-2',
      conversationId: 'conv-1',
      contactId: 'c-1',
      role: 'building_manager',
      name: 'BM',
      answered: false,
      createdAt: '2026-03-03T00:01:00Z',
    });

    expect(event.event_type).toBe('escalation_attempt');
    expect(event.payload.contact_id).toBe('c-1');
    expect(event.payload.answered).toBe(false);
  });
});

describe('buildEscalationResultEvent', () => {
  it('builds an escalation_result event for completed escalation', () => {
    const result: EscalationResult = {
      plan_id: 'plan-1',
      state: 'completed',
      attempts: [{ contact_id: 'c-1', role: 'bm', name: 'BM', attempted_at: '2026-03-03T00:00:00Z', answered: true }],
      answered_by: { role: 'bm', contact_id: 'c-1', name: 'BM', phone: '+1' },
      exhaustion_message: null,
    };

    const event = buildEscalationResultEvent({
      eventId: 'evt-3',
      conversationId: 'conv-1',
      escalationResult: result,
      createdAt: '2026-03-03T00:02:00Z',
    });

    expect(event.event_type).toBe('escalation_result');
    expect(event.payload.state).toBe('completed');
    expect(event.payload.answered_by).toBeDefined();
  });

  it('builds an escalation_result event for exhausted escalation', () => {
    const result: EscalationResult = {
      plan_id: 'plan-1',
      state: 'exhausted',
      attempts: [],
      answered_by: null,
      exhaustion_message: 'Unable to reach anyone.',
    };

    const event = buildEscalationResultEvent({
      eventId: 'evt-4',
      conversationId: 'conv-1',
      escalationResult: result,
      createdAt: '2026-03-03T00:03:00Z',
    });

    expect(event.payload.state).toBe('exhausted');
    expect(event.payload.exhaustion_message).toBe('Unable to reach anyone.');
  });
});
