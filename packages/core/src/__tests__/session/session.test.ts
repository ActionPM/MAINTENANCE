import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { createSession, updateSessionState, touchActivity } from '../../session/session.js';
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
      },
    });

    vi.advanceTimersByTime(1000);
    const touched = touchActivity(session);
    expect(touched.state).toBe(session.state);
    expect(touched.last_activity_at).not.toBe(session.last_activity_at);
  });
});
