import { NextRequest, NextResponse } from 'next/server';
import type { AuthContext } from '@wo-agent/schemas';
import { extractAuthFromHeader } from '@wo-agent/core';
import type { JwtConfig } from '@wo-agent/core';

// In production, load from env. For stubs, use a test config.
function getJwtConfig(): JwtConfig {
  return {
    accessTokenSecret: new TextEncoder().encode(process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-at-least-32-characters!!'),
    refreshTokenSecret: new TextEncoder().encode(process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-at-least-32-characters!'),
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
  const authHeader = request.headers.get('authorization');
  const config = getJwtConfig();
  const result = await extractAuthFromHeader(authHeader ?? undefined, config);

  if (!result.valid) {
    return NextResponse.json(
      { errors: [{ code: result.error.code, message: result.error.message }] },
      { status: 401 },
    );
  }

  return result.authContext;
}
