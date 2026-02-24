import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { filterResumableDrafts } from '../../session/draft-discovery.js';
import type { ConversationSession } from '../../session/types.js';
import { createSession } from '../../session/session.js';

function makeSession(overrides: Partial<ConversationSession>): ConversationSession {
  const base = createSession({
    conversation_id: 'conv-default',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  return { ...base, ...overrides };
}

describe('filterResumableDrafts', () => {
  it('returns only sessions in resumable states', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', state: ConversationState.NEEDS_TENANT_INPUT, last_activity_at: '2026-01-04T00:00:00Z' }),
      makeSession({ conversation_id: 'c2', state: ConversationState.SUBMITTED, last_activity_at: '2026-01-03T00:00:00Z' }),
      makeSession({ conversation_id: 'c3', state: ConversationState.SPLIT_PROPOSED, last_activity_at: '2026-01-02T00:00:00Z' }),
      makeSession({ conversation_id: 'c4', state: ConversationState.INTAKE_EXPIRED, last_activity_at: '2026-01-01T00:00:00Z' }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result.map((s) => s.conversation_id)).toEqual(['c1', 'c3']);
  });

  it('filters by tenant_user_id', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', tenant_user_id: 'user-1', state: ConversationState.SPLIT_PROPOSED }),
      makeSession({ conversation_id: 'c2', tenant_user_id: 'user-2', state: ConversationState.SPLIT_PROPOSED }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].conversation_id).toBe('c1');
  });

  it('sorts by last_activity_at descending (most recent first)', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', state: ConversationState.SPLIT_PROPOSED, last_activity_at: '2026-01-01T00:00:00Z' }),
      makeSession({ conversation_id: 'c2', state: ConversationState.NEEDS_TENANT_INPUT, last_activity_at: '2026-01-03T00:00:00Z' }),
      makeSession({ conversation_id: 'c3', state: ConversationState.UNIT_SELECTION_REQUIRED, last_activity_at: '2026-01-02T00:00:00Z' }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result.map((s) => s.conversation_id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('limits to 3 results', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', state: ConversationState.SPLIT_PROPOSED, last_activity_at: '2026-01-04T00:00:00Z' }),
      makeSession({ conversation_id: 'c2', state: ConversationState.NEEDS_TENANT_INPUT, last_activity_at: '2026-01-03T00:00:00Z' }),
      makeSession({ conversation_id: 'c3', state: ConversationState.UNIT_SELECTION_REQUIRED, last_activity_at: '2026-01-02T00:00:00Z' }),
      makeSession({ conversation_id: 'c4', state: ConversationState.LLM_ERROR_RETRYABLE, last_activity_at: '2026-01-01T00:00:00Z' }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.conversation_id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns empty array when no resumable drafts exist', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', state: ConversationState.SUBMITTED }),
      makeSession({ conversation_id: 'c2', state: ConversationState.INTAKE_EXPIRED }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result).toEqual([]);
  });
});
