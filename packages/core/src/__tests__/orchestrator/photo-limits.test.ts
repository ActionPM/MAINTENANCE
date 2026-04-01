import { describe, it, expect } from 'vitest';
import { ConversationState, DEFAULT_RATE_LIMITS, resolveCurrentVersions } from '@wo-agent/schemas';
import { handlePhotoUpload } from '../../orchestrator/action-handlers/photo-upload.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    state: ConversationState.SPLIT_PROPOSED,
    unit_id: 'u1',
    authorized_unit_ids: ['u1'],
    pinned_versions: resolveCurrentVersions(),
    split_issues: null,
    classification_results: null,
    prior_state_before_error: null,
    draft_photo_ids: [],
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    created_at: '2026-01-15T12:00:00Z',
    last_activity_at: '2026-01-15T12:00:00Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: null,
    client_id: null,
    building_id: null,
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
    queued_messages: [],
    ...overrides,
    confirmed_followup_answers: overrides.confirmed_followup_answers ?? {},
  };
}

function makeCtx(
  session: ConversationSession,
  tenantInput: Record<string, unknown> = {
    filename: 'default.jpg',
    content_type: 'image/jpeg',
    size_bytes: 1000,
  },
): ActionHandlerContext {
  return {
    session,
    request: {
      conversation_id: session.conversation_id,
      action_type: 'UPLOAD_PHOTO_INIT',
      actor: 'tenant',
      tenant_input: tenantInput as any,
      auth_context: {
        tenant_user_id: session.tenant_user_id,
        tenant_account_id: session.tenant_account_id,
        authorized_unit_ids: session.authorized_unit_ids as string[],
      },
    },
    deps: {} as any,
    request_id: 'req-1',
  };
}

describe('handlePhotoUpload — per-conversation limits', () => {
  it('accepts photo when under limit', async () => {
    const session = makeSession({ draft_photo_ids: ['p1', 'p2'] });
    const result = await handlePhotoUpload(
      makeCtx(session, { filename: 'test.jpg', content_type: 'image/jpeg', size_bytes: 1000 }),
    );

    expect(result.errors).toBeUndefined();
    expect(result.eventType).toBe('photo_attached');
  });

  it('rejects photo when at max limit (S08-03)', async () => {
    const photoIds = Array.from(
      { length: DEFAULT_RATE_LIMITS.max_photo_uploads_per_conversation },
      (_, i) => `p${i}`,
    );
    const session = makeSession({ draft_photo_ids: photoIds });
    const result = await handlePhotoUpload(makeCtx(session));

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].code).toBe('PHOTO_LIMIT_EXCEEDED');
  });

  it('rejects photo when declared size exceeds max (S08-04)', async () => {
    const session = makeSession();
    const oversizedBytes = DEFAULT_RATE_LIMITS.max_photo_size_mb * 1024 * 1024 + 1;
    const result = await handlePhotoUpload(
      makeCtx(session, {
        filename: 'big.jpg',
        content_type: 'image/jpeg',
        size_bytes: oversizedBytes,
      }),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].code).toBe('PHOTO_SIZE_EXCEEDED');
  });

  it('accepts photo at exactly max size', async () => {
    const session = makeSession();
    const exactMaxBytes = DEFAULT_RATE_LIMITS.max_photo_size_mb * 1024 * 1024;
    const result = await handlePhotoUpload(
      makeCtx(session, {
        filename: 'ok.jpg',
        content_type: 'image/jpeg',
        size_bytes: exactMaxBytes,
      }),
    );

    expect(result.errors).toBeUndefined();
  });

  it('accepts photo when size_bytes not provided (no crash)', async () => {
    const session = makeSession();
    const result = await handlePhotoUpload(makeCtx(session, { filename: 'test.jpg' }));

    expect(result.errors).toBeUndefined();
  });
});
