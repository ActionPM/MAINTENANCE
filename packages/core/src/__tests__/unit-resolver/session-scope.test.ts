import { describe, it, expect } from 'vitest';
import { createSession, setSessionScope } from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';

describe('setSessionScope', () => {
  const base = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'm',
      prompt_version: '1',
    },
  });

  it('sets property_id and client_id from UnitInfo', () => {
    const updated = setSessionScope(base, {
      property_id: 'prop-1',
      client_id: 'client-1',
    });
    expect(updated.property_id).toBe('prop-1');
    expect(updated.client_id).toBe('client-1');
  });

  it('returns a new session object (immutability)', () => {
    const updated = setSessionScope(base, {
      property_id: 'prop-1',
      client_id: 'client-1',
    });
    expect(updated).not.toBe(base);
    expect(base.property_id).toBeNull();
  });

  it('preserves all other session fields', () => {
    const updated = setSessionScope(base, {
      property_id: 'prop-2',
      client_id: 'client-2',
    });
    expect(updated.conversation_id).toBe(base.conversation_id);
    expect(updated.state).toBe(base.state);
    expect(updated.tenant_user_id).toBe(base.tenant_user_id);
  });
});
