import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSession, setClassificationResults } from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('setClassificationResults', () => {
  it('stores classification results on session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });
    expect(session.classification_results).toBeNull();

    const results: IssueClassificationResult[] = [
      {
        issue_id: 'i1',
        classifierOutput: {
          issue_id: 'i1',
          classification: { Category: 'maintenance' },
          model_confidence: { Category: 0.9 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.85 },
        fieldsNeedingInput: [],
        shouldAskFollowup: false,
        followupTypes: {},
        constraintPassed: true,
        recoverable_via_followup: false,
      },
    ];
    vi.advanceTimersByTime(1000);
    const updated = setClassificationResults(session, results);
    expect(updated.classification_results).toEqual(results);
    expect(updated.classification_results).not.toBe(results);
    expect(updated.last_activity_at).not.toBe(session.last_activity_at);
  });

  it('allows clearing classification results with null', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });
    session = setClassificationResults(session, [
      {
        issue_id: 'i1',
        classifierOutput: {
          issue_id: 'i1',
          classification: { Category: 'maintenance' },
          model_confidence: { Category: 0.9 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.85 },
        fieldsNeedingInput: [],
        shouldAskFollowup: false,
        followupTypes: {},
        constraintPassed: true,
        recoverable_via_followup: false,
      },
    ]);
    const cleared = setClassificationResults(session, null);
    expect(cleared.classification_results).toBeNull();
  });
});
