import { SignJWT, jwtVerify } from 'jose';
import type { JwtConfig, JwtPayload, TokenPair, TokenVerifyResult } from './types.js';

/**
 * Create an access + refresh token pair for a tenant.
 */
export async function createTokenPair(
  payload: Pick<JwtPayload, 'sub' | 'account_id' | 'unit_ids'>,
  config: JwtConfig,
): Promise<TokenPair> {
  const accessToken = await new SignJWT({
    account_id: payload.account_id,
    unit_ids: payload.unit_ids,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.accessTokenExpiry)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(config.accessTokenSecret);

  const refreshToken = await new SignJWT({
    account_id: payload.account_id,
    unit_ids: payload.unit_ids,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.refreshTokenExpiry)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(config.refreshTokenSecret);

  return { accessToken, refreshToken };
}

async function verifyToken(
  token: string,
  secret: Uint8Array,
  config: JwtConfig,
): Promise<TokenVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: config.issuer,
      audience: config.audience,
    });

    return {
      valid: true,
      payload: {
        sub: payload.sub!,
        account_id: payload.account_id as string,
        unit_ids: payload.unit_ids as string[],
        iat: payload.iat,
        exp: payload.exp,
        iss: payload.iss,
        aud: payload.aud as string | undefined,
      },
    };
  } catch {
    return {
      valid: false,
      error: { code: 'TOKEN_INVALID', message: 'Token verification failed' },
    };
  }
}

/**
 * Verify an access token. Returns typed payload or error.
 */
export async function verifyAccessToken(
  token: string,
  config: JwtConfig,
): Promise<TokenVerifyResult> {
  return verifyToken(token, config.accessTokenSecret, config);
}

/**
 * Verify a refresh token. Returns typed payload or error.
 */
export async function verifyRefreshToken(
  token: string,
  config: JwtConfig,
): Promise<TokenVerifyResult> {
  return verifyToken(token, config.refreshTokenSecret, config);
}
