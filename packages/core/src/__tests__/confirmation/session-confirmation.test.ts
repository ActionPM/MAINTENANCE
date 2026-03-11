import { describe, it, expect } from 'vitest';
import { setConfirmationTracking, markConfirmationPresented } from '../../session/session.js';
import { createSession } from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';

function makeSession(): ConversationSession {
  return createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'default',
      prompt_version: '1.0.0',
    },
  });
}

describe('setConfirmationTracking', () => {
  it('sets confirmation_entered_at to provided timestamp', () => {
    const session = makeSession();
    const updated = setConfirmationTracking(session, {
      confirmationEnteredAt: '2026-01-01T10:00:00.000Z',
      sourceTextHash: 'hash-src',
      splitHash: 'hash-split',
    });
    expect(updated.confirmation_entered_at).toBe('2026-01-01T10:00:00.000Z');
  });

  it('sets source and split hashes', () => {
    const session = makeSession();
    const updated = setConfirmationTracking(session, {
      confirmationEnteredAt: '2026-01-01T10:00:00.000Z',
      sourceTextHash: 'hash-src',
      splitHash: 'hash-split',
    });
    expect(updated.source_text_hash).toBe('hash-src');
    expect(updated.split_hash).toBe('hash-split');
  });

  it('sets confirmation_presented to false by default', () => {
    const session = makeSession();
    const updated = setConfirmationTracking(session, {
      confirmationEnteredAt: '2026-01-01T10:00:00.000Z',
      sourceTextHash: 'hash-src',
      splitHash: 'hash-split',
    });
    expect(updated.confirmation_presented).toBe(false);
  });
});

describe('markConfirmationPresented', () => {
  it('sets confirmation_presented to true', () => {
    const session = setConfirmationTracking(makeSession(), {
      confirmationEnteredAt: '2026-01-01T10:00:00.000Z',
      sourceTextHash: 'hash-src',
      splitHash: 'hash-split',
    });
    const updated = markConfirmationPresented(session);
    expect(updated.confirmation_presented).toBe(true);
  });
});
