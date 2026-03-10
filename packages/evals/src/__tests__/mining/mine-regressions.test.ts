import { describe, it, expect } from 'vitest';
import { mineRegressionCandidates } from '../../mining/mine-regressions.js';
import { redactCandidate } from '../../mining/redact-candidate.js';
import { ReviewQueue } from '../../mining/review-queue.js';

describe('mineRegressionCandidates', () => {
  it('extracts candidates from needs_human_triage events', () => {
    const events = [
      {
        event_type: 'classification',
        needs_human_triage: true,
        conversation_id: 'conv-1',
        issue_text: 'Something broke',
        classification: { Category: 'unknown' },
        created_at: '2026-03-10T12:00:00Z',
      },
    ];

    const candidates = mineRegressionCandidates(events);
    expect(candidates.length).toBe(1);
    expect(candidates[0].signal).toBe('needs_human_triage');
  });

  it('extracts candidates from followup cap exhaustion', () => {
    const events = [
      {
        event_type: 'followup',
        cap_exhausted: true,
        conversation_id: 'conv-2',
        issue_text: 'My heater is broken I think',
        turn_number: 8,
        created_at: '2026-03-10T12:00:00Z',
      },
    ];

    const candidates = mineRegressionCandidates(events);
    expect(candidates.length).toBe(1);
    expect(candidates[0].signal).toBe('followup_cap_exhaustion');
  });

  it('extracts candidates from tenant corrections', () => {
    const events = [
      {
        event_type: 'confirmation',
        conversation_id: 'conv-3',
        tenant_edited_fields: ['Category', 'Maintenance_Category'],
        issue_text: 'Water coming from ceiling',
        classification: { Category: 'management' },
        created_at: '2026-03-10T12:00:00Z',
      },
    ];

    const candidates = mineRegressionCandidates(events);
    expect(candidates.length).toBe(1);
    expect(candidates[0].signal).toBe('tenant_correction');
  });

  it('returns empty for events with no regression signals', () => {
    const events = [
      {
        event_type: 'classification',
        conversation_id: 'conv-4',
        created_at: '2026-03-10T12:00:00Z',
      },
    ];

    const candidates = mineRegressionCandidates(events);
    expect(candidates.length).toBe(0);
  });
});

describe('redactCandidate', () => {
  it('hashes conversation_id and redacts PII', () => {
    const result = redactCandidate({
      conversation_id: 'conv-secret-123',
      issue_text: 'I live in unit 302 and my phone is 555-123-4567',
    });
    expect(result.conversation_id).toMatch(/^redacted-/);
    expect(result.issue_text).not.toContain('302');
    expect(result.issue_text).not.toContain('555-123-4567');
  });
});

describe('ReviewQueue', () => {
  it('manages review lifecycle', () => {
    const queue = new ReviewQueue();
    queue.add({
      conversation_id: 'c1',
      signal: 'needs_human_triage',
      metadata: {},
      created_at: '2026-03-10T12:00:00Z',
    });

    expect(queue.getPending().length).toBe(1);
    expect(queue.getApproved().length).toBe(0);

    queue.review(0, 'approved', 'reviewer-1', 'Looks good');
    expect(queue.getPending().length).toBe(0);
    expect(queue.getApproved().length).toBe(1);
  });
});
