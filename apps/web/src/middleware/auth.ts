import { NextRequest, NextResponse } from 'next/server';
import type { AuthContext } from '@wo-agent/schemas';
import { extractAuthFromHeader } from '@wo-agent/core';
import type { JwtConfig } from '@wo-agent/core';

/**
 * Build JWT config from environment. Returns null when secrets are missing
 * so the caller can fail closed (401) rather than accepting tokens signed
 * with predictable defaults.
 */
function getJwtConfig(): JwtConfig | null {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!accessSecret || !refreshSecret) return null;

  return {
    accessTokenSecret: new TextEncoder().encode(accessSecret),
    refreshTokenSecret: new TextEncoder().encode(refreshSecret),
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    issuer: 'wo-agent',
    audience: 'wo-agent',
  };
}

export type AuthenticatedRequest = {
  authContext: AuthContext;
};

/**
 * Extract and validate auth from request headers.
 * Returns AuthContext on success, or a 401 NextResponse on failure.
 */
export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthContext | NextResponse> {
  const config = getJwtConfig();
  if (!config) {
    return NextResponse.json(
      { errors: [{ code: 'AUTH_CONFIG_ERROR', message: 'JWT secrets not configured' }] },
      { status: 401 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const result = await extractAuthFromHeader(authHeader ?? undefined, config);

  if (!result.valid) {
    return NextResponse.json(
      { errors: [{ code: result.error.code, message: result.error.message }] },
      { status: 401 },
    );
  }

  return result.authContext;
}
