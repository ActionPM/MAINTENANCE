import { describe, it, expect } from 'vitest';
import {
  extractAuthFromHeader,
  validateUnitAccess,
} from '../../auth/middleware.js';
import { createTokenPair } from '../../auth/jwt.js';
import type { JwtConfig } from '../../auth/types.js';

const TEST_CONFIG: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('test-access-secret-at-least-32-chars!!'),
  refreshTokenSecret: new TextEncoder().encode('test-refresh-secret-at-least-32-chars!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent-test',
  audience: 'wo-agent-test',
};

describe('extractAuthFromHeader', () => {
  it('extracts AuthContext from a valid Bearer token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1', 'u2'] },
      TEST_CONFIG,
    );
    const result = await extractAuthFromHeader(`Bearer ${pair.accessToken}`, TEST_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.authContext.tenant_user_id).toBe('user-1');
      expect(result.authContext.tenant_account_id).toBe('acct-1');
      expect(result.authContext.authorized_unit_ids).toEqual(['u1', 'u2']);
    }
  });

  it('returns error for missing header', async () => {
    const result = await extractAuthFromHeader(undefined, TEST_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('TOKEN_MISSING');
    }
  });

  it('returns error for malformed header', async () => {
    const result = await extractAuthFromHeader('NotBearer xyz', TEST_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('TOKEN_INVALID');
    }
  });

  it('returns error for invalid token', async () => {
    const result = await extractAuthFromHeader('Bearer invalid.token.here', TEST_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('TOKEN_INVALID');
    }
  });
});

describe('validateUnitAccess', () => {
  it('returns true when unit_id is in authorized list', () => {
    expect(validateUnitAccess(['u1', 'u2', 'u3'], 'u2')).toBe(true);
  });

  it('returns false when unit_id is not in authorized list', () => {
    expect(validateUnitAccess(['u1', 'u2'], 'u_other')).toBe(false);
  });

  it('returns false for empty authorized list', () => {
    expect(validateUnitAccess([], 'u1')).toBe(false);
  });
});
