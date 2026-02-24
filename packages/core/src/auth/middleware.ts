import type { AuthContext } from '@wo-agent/schemas';
import type { AuthError, JwtConfig } from './types.js';
import { toAuthContext } from './types.js';
import { verifyAccessToken } from './jwt.js';

export type AuthExtractionResult =
  | { readonly valid: true; readonly authContext: AuthContext }
  | { readonly valid: false; readonly error: AuthError };

/**
 * Extract AuthContext from an Authorization header value.
 * Expects "Bearer <token>" format. Returns typed error on failure.
 */
export async function extractAuthFromHeader(
  authHeader: string | undefined | null,
  config: JwtConfig,
): Promise<AuthExtractionResult> {
  if (!authHeader) {
    return { valid: false, error: { code: 'TOKEN_MISSING', message: 'Authorization header is required' } };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: { code: 'TOKEN_INVALID', message: 'Expected Bearer token format' } };
  }

  const result = await verifyAccessToken(parts[1], config);
  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return { valid: true, authContext: toAuthContext(result.payload) };
}

/**
 * Check if a unit_id is in the tenant's authorized list (spec §9).
 * Tenant cannot set unit/property IDs — server derives from membership.
 */
export function validateUnitAccess(
  authorizedUnitIds: readonly string[],
  unitId: string,
): boolean {
  return authorizedUnitIds.includes(unitId);
}
