import type { AuthContext } from '@wo-agent/schemas';

/**
 * JWT payload shape embedded in access tokens.
 * Maps to AuthContext fields for server-side extraction.
 */
export interface JwtPayload {
  readonly sub: string;          // tenant_user_id
  readonly account_id: string;   // tenant_account_id
  readonly unit_ids: readonly string[];  // authorized_unit_ids
  readonly iat?: number;
  readonly exp?: number;
  readonly iss?: string;
  readonly aud?: string;
}

/**
 * Configuration for JWT token creation and verification.
 */
export interface JwtConfig {
  readonly accessTokenSecret: Uint8Array;
  readonly refreshTokenSecret: Uint8Array;
  readonly accessTokenExpiry: string;   // e.g., '15m'
  readonly refreshTokenExpiry: string;  // e.g., '7d'
  readonly issuer: string;
  readonly audience: string;
}

/**
 * Token pair returned on successful authentication.
 */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * Result of token verification — success or typed error.
 */
export type TokenVerifyResult =
  | { readonly valid: true; readonly payload: JwtPayload }
  | { readonly valid: false; readonly error: AuthError };

/**
 * Auth-specific error codes.
 */
export type AuthErrorCode =
  | 'TOKEN_MISSING'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'UNIT_NOT_AUTHORIZED'
  | 'MEMBERSHIP_CHECK_FAILED';

export interface AuthError {
  readonly code: AuthErrorCode;
  readonly message: string;
}

/**
 * Convert a verified JWT payload to the schemas AuthContext.
 */
export function toAuthContext(payload: JwtPayload): AuthContext {
  return {
    tenant_user_id: payload.sub,
    tenant_account_id: payload.account_id,
    authorized_unit_ids: payload.unit_ids,
  };
}
