import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType } from '@wo-agent/schemas';
import { SystemEvent } from '../state-machine/system-events.js';
import { isValidTransition, getPossibleTargets } from '../state-machine/transition.js';
import {
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
} from '../state-machine/guards.js';
import { createSession, updateSessionState, markAbandoned, markExpired, isExpired, setSessionUnit } from '../session/session.js';
import { filterResumableDrafts } from '../session/draft-discovery.js';
import { createTokenPair, verifyAccessToken } from '../auth/jwt.js';
import { extractAuthFromHeader } from '../auth/middleware.js';
import type { JwtConfig } from '../auth/types.js';

const TEST_JWT_CONFIG: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('integration-test-access-secret-32!!'),
  refreshTokenSecret: new TextEncoder().encode('integration-test-refresh-secret-32!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent-test',
  audience: 'wo-agent-test',
};

describe('Integration: full happy-path lifecycle', () => {
  it('walks through intake_started → submitted', () => {
    // 1. Create session
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' },
    });
    expect(session.state).toBe(ConversationState.INTAKE_STARTED);

    // 2. SELECT_UNIT (single unit → auto-select)
    expect(isValidTransition(session.state, ActionType.SELECT_UNIT)).toBe(true);
    const unitTarget = resolveSelectUnit(session.state, { authorized_unit_ids: ['u1'], selected_unit_id: null });
    expect(unitTarget).toBe(ConversationState.UNIT_SELECTED);
    session = updateSessionState(session, unitTarget!);
    session = setSessionUnit(session, 'u1');
    expect(session.state).toBe(ConversationState.UNIT_SELECTED);

    // 3. SUBMIT_INITIAL_MESSAGE
    expect(isValidTransition(session.state, ActionType.SUBMIT_INITIAL_MESSAGE)).toBe(true);
    const msgTarget = resolveSubmitInitialMessage({ unit_resolved: true });
    session = updateSessionState(session, msgTarget!);
    expect(session.state).toBe(ConversationState.SPLIT_IN_PROGRESS);

    // 4. LLM_SPLIT_SUCCESS (system)
    expect(isValidTransition(session.state, SystemEvent.LLM_SPLIT_SUCCESS)).toBe(true);
    session = updateSessionState(session, ConversationState.SPLIT_PROPOSED);

    // 5. CONFIRM_SPLIT
    expect(isValidTransition(session.state, ActionType.CONFIRM_SPLIT)).toBe(true);
    session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);

    // 6. START_CLASSIFICATION (system)
    expect(isValidTransition(session.state, SystemEvent.START_CLASSIFICATION)).toBe(true);
    session = updateSessionState(session, ConversationState.CLASSIFICATION_IN_PROGRESS);

    // 7. LLM_CLASSIFY_SUCCESS → no follow-ups needed
    const classTarget = resolveLlmClassifySuccess({ fields_needing_input: [] });
    expect(classTarget).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    session = updateSessionState(session, classTarget);

    // 8. CONFIRM_SUBMISSION
    expect(isValidTransition(session.state, ActionType.CONFIRM_SUBMISSION)).toBe(true);
    session = updateSessionState(session, ConversationState.SUBMITTED);
    expect(session.state).toBe(ConversationState.SUBMITTED);
  });
});

describe('Integration: error recovery with retry', () => {
  it('handles LLM failure → retry → success', () => {
    let session = createSession({
      conversation_id: 'conv-2',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' },
    });

    session = updateSessionState(session, ConversationState.UNIT_SELECTED);
    session = updateSessionState(session, ConversationState.SPLIT_IN_PROGRESS);

    // LLM fails (first failure → retryable)
    const failTarget = resolveLlmFailure({ retry_count: 0 });
    expect(failTarget).toBe(ConversationState.LLM_ERROR_RETRYABLE);
    session = updateSessionState(session, failTarget);
    expect(session.prior_state_before_error).toBe(ConversationState.SPLIT_IN_PROGRESS);

    // RETRY_LLM → back to split_in_progress
    const retryTarget = resolveRetryLlm({ prior_state: session.prior_state_before_error });
    expect(retryTarget).toBe(ConversationState.SPLIT_IN_PROGRESS);
    session = updateSessionState(session, retryTarget!);
    expect(session.state).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });
});

describe('Integration: abandon and resume', () => {
  it('abandons and resumes to prior state', () => {
    let session = createSession({
      conversation_id: 'conv-3',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' },
    });

    session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
    session = markAbandoned(session);
    expect(session.state).toBe(ConversationState.INTAKE_ABANDONED);
    expect(session.prior_state_before_error).toBe(ConversationState.NEEDS_TENANT_INPUT);

    // Resume
    const resumeTarget = resolveAbandonResume({ prior_state: session.prior_state_before_error });
    expect(resumeTarget).toBe(ConversationState.NEEDS_TENANT_INPUT);
    session = updateSessionState(session, resumeTarget!);
    expect(session.state).toBe(ConversationState.NEEDS_TENANT_INPUT);
  });
});

describe('Integration: draft discovery with auth', () => {
  it('creates auth, creates sessions, filters drafts', async () => {
    // Create auth token
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1'] },
      TEST_JWT_CONFIG,
    );
    const authResult = await extractAuthFromHeader(`Bearer ${pair.accessToken}`, TEST_JWT_CONFIG);
    expect(authResult.valid).toBe(true);
    if (!authResult.valid) return;

    const { tenant_user_id } = authResult.authContext;

    // Create sessions in various states
    const sessions = [
      { ...createSession({ conversation_id: 'c1', tenant_user_id, tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'], pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' } }), state: ConversationState.NEEDS_TENANT_INPUT as ConversationState, last_activity_at: '2026-01-02T00:00:00Z' },
      { ...createSession({ conversation_id: 'c2', tenant_user_id, tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'], pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' } }), state: ConversationState.SUBMITTED as ConversationState, last_activity_at: '2026-01-03T00:00:00Z' },
      { ...createSession({ conversation_id: 'c3', tenant_user_id, tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'], pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' } }), state: ConversationState.SPLIT_PROPOSED as ConversationState, last_activity_at: '2026-01-01T00:00:00Z' },
    ];

    const drafts = filterResumableDrafts(sessions, tenant_user_id);
    expect(drafts).toHaveLength(2); // c1 (needs_tenant_input) + c3 (split_proposed); c2 is submitted
    expect(drafts[0].conversation_id).toBe('c1'); // more recent
    expect(drafts[1].conversation_id).toBe('c3');
  });
});

describe('Integration: photo uploads never change state', () => {
  it('allows photo upload in every state without transition', () => {
    const allStates = Object.values(ConversationState);
    for (const state of allStates) {
      expect(isValidTransition(state, ActionType.UPLOAD_PHOTO_INIT)).toBe(true);
      expect(isValidTransition(state, ActionType.UPLOAD_PHOTO_COMPLETE)).toBe(true);
      expect(getPossibleTargets(state, ActionType.UPLOAD_PHOTO_INIT)).toEqual([state]);
      expect(getPossibleTargets(state, ActionType.UPLOAD_PHOTO_COMPLETE)).toEqual([state]);
    }
  });
});

describe('Integration: follow-up loop', () => {
  it('cycles through classification → follow-ups → re-classification', () => {
    let session = createSession({
      conversation_id: 'conv-4',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: { taxonomy_version: '1.0', schema_version: '1.0', model_id: 'gpt-4', prompt_version: '1.0' },
    });

    // Fast-forward to classification
    session = updateSessionState(session, ConversationState.CLASSIFICATION_IN_PROGRESS);

    // Classify → needs input
    const target1 = resolveLlmClassifySuccess({ fields_needing_input: ['Maintenance_Object'] });
    expect(target1).toBe(ConversationState.NEEDS_TENANT_INPUT);
    session = updateSessionState(session, target1);

    // Answer follow-ups → back to classification
    expect(isValidTransition(session.state, ActionType.ANSWER_FOLLOWUPS)).toBe(true);
    session = updateSessionState(session, ConversationState.CLASSIFICATION_IN_PROGRESS);

    // Classify again → all good
    const target2 = resolveLlmClassifySuccess({ fields_needing_input: [] });
    expect(target2).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    session = updateSessionState(session, target2);
    expect(session.state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});
