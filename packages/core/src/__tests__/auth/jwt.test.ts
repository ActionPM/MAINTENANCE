import { describe, it, expect } from 'vitest';
import { createTokenPair, verifyAccessToken, verifyRefreshToken } from '../../auth/jwt.js';
import type { JwtConfig } from '../../auth/types.js';

const TEST_CONFIG: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('test-access-secret-at-least-32-chars!!'),
  refreshTokenSecret: new TextEncoder().encode('test-refresh-secret-at-least-32-chars!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent-test',
  audience: 'wo-agent-test',
};

describe('createTokenPair', () => {
  it('creates an access token and refresh token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1', 'u2'] },
      TEST_CONFIG,
    );
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });
});

describe('verifyAccessToken', () => {
  it('verifies a valid access token and returns payload', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1'] },
      TEST_CONFIG,
    );
    const result = await verifyAccessToken(pair.accessToken, TEST_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('user-1');
      expect(result.payload.account_id).toBe('acct-1');
      expect(result.payload.unit_ids).toEqual(['u1']);
    }
  });

  it('rejects a tampered token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: [] },
      TEST_CONFIG,
    );
    const result = await verifyAccessToken(pair.accessToken + 'tampered', TEST_CONFIG);
    expect(result.valid).toBe(false);
  });

  it('rejects a refresh token used as access token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: [] },
      TEST_CONFIG,
    );
    const result = await verifyAccessToken(pair.refreshToken, TEST_CONFIG);
    expect(result.valid).toBe(false);
  });
});

describe('verifyRefreshToken', () => {
  it('verifies a valid refresh token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1'] },
      TEST_CONFIG,
    );
    const result = await verifyRefreshToken(pair.refreshToken, TEST_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('user-1');
    }
  });
});
