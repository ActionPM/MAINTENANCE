import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import type { SplitIssue } from '@wo-agent/schemas';
import {
  createSession,
  updateSessionState,
  touchActivity,
  setSessionUnit,
  markAbandoned,
  markExpired,
  isExpired,
  setSplitIssues,
  type ExpirationConfig,
} from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('createSession', () => {
  it('creates a session in intake_started state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1', 'u2'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    expect(session.conversation_id).toBe('conv-1');
    expect(session.state).toBe(ConversationState.INTAKE_STARTED);
    expect(session.unit_id).toBeNull();
    expect(session.authorized_unit_ids).toEqual(['u1', 'u2']);
    expect(session.prior_state_before_error).toBeNull();
    expect(session.created_at).toBeTruthy();
    expect(session.last_activity_at).toBeTruthy();
  });
});

describe('updateSessionState', () => {
  it('updates the state and last_activity_at', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    vi.advanceTimersByTime(1000);
    const updated = updateSessionState(session, ConversationState.UNIT_SELECTED);
    expect(updated.state).toBe(ConversationState.UNIT_SELECTED);
    expect(updated.last_activity_at).not.toBe(session.last_activity_at);
  });

  it('stores prior state when transitioning to error state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    const inProgress = updateSessionState(session, ConversationState.SPLIT_IN_PROGRESS);
    const errored = updateSessionState(inProgress, ConversationState.LLM_ERROR_RETRYABLE);
    expect(errored.prior_state_before_error).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });

  it('stores prior state when transitioning to abandoned', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    const withUnit = updateSessionState(session, ConversationState.UNIT_SELECTED);
    const abandoned = updateSessionState(withUnit, ConversationState.INTAKE_ABANDONED);
    expect(abandoned.prior_state_before_error).toBe(ConversationState.UNIT_SELECTED);
  });

  it('does not overwrite prior state for non-error transitions', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    const updated = updateSessionState(session, ConversationState.UNIT_SELECTED);
    expect(updated.prior_state_before_error).toBeNull();
  });
});

describe('touchActivity', () => {
  it('updates last_activity_at without changing state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    vi.advanceTimersByTime(1000);
    const touched = touchActivity(session);
    expect(touched.state).toBe(session.state);
    expect(touched.last_activity_at).not.toBe(session.last_activity_at);
  });
});

describe('markAbandoned', () => {
  it('transitions to intake_abandoned and stores prior state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    const withUnit = updateSessionState(session, ConversationState.UNIT_SELECTED);
    const abandoned = markAbandoned(withUnit);
    expect(abandoned.state).toBe(ConversationState.INTAKE_ABANDONED);
    expect(abandoned.prior_state_before_error).toBe(ConversationState.UNIT_SELECTED);
  });
});

describe('markExpired', () => {
  it('transitions to intake_expired', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    const abandoned = markAbandoned(session);
    const expired = markExpired(abandoned);
    expect(expired.state).toBe(ConversationState.INTAKE_EXPIRED);
  });
});

describe('isExpired', () => {
  const config: ExpirationConfig = { abandonedExpiryMs: 60 * 60 * 1000 }; // 1 hour

  it('returns false for non-abandoned sessions', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    expect(isExpired(session, config)).toBe(false);
  });

  it('returns true when abandoned session exceeds expiry time', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    const abandoned = markAbandoned(session);
    const oldAbandoned = {
      ...abandoned,
      last_activity_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    };
    expect(isExpired(oldAbandoned, config)).toBe(true);
  });

  it('returns false when abandoned session is within expiry window', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    const abandoned = markAbandoned(session);
    expect(isExpired(abandoned, config)).toBe(false);
  });
});

describe('setSplitIssues', () => {
  it('stores split issues on session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    expect(session.split_issues).toBeNull();

    vi.advanceTimersByTime(1000);
    const issues: SplitIssue[] = [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
      { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light is broken' },
    ];
    const updated = setSplitIssues(session, issues);
    expect(updated.split_issues).toEqual(issues);
    expect(updated.split_issues).not.toBe(issues); // defensive copy
    expect(updated.last_activity_at).not.toBe(session.last_activity_at);
  });

  it('allows clearing split issues with null', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    session = setSplitIssues(session, [{ issue_id: 'i1', summary: 'Test', raw_excerpt: 'test' }]);
    const cleared = setSplitIssues(session, null);
    expect(cleared.split_issues).toBeNull();
  });
});
