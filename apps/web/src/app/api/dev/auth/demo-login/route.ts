import { NextRequest, NextResponse } from 'next/server';
import { createTokenPair } from '@wo-agent/core';
import type { JwtConfig } from '@wo-agent/core';
import { getDemoTenant } from '@/lib/dev-auth/demo-tenants';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * POST /api/dev/auth/demo-login
 *
 * Dev-only token issuance for demo tenants. Disabled unless
 * ENABLE_DEV_AUTH is explicitly set to 'true'.
 *
 * Request body: { "persona_key": "alice" | "bob" | "carol" }
 * Response: { "access_token": "...", "refresh_token": "...", "tenant": { ... } }
 */
export const POST = withObservedRoute('dev:auth:demo-login', async (request: NextRequest) => {
  // Gate: disabled unless explicitly enabled
  if (process.env.ENABLE_DEV_AUTH !== 'true') {
    return NextResponse.json(
      { errors: [{ code: 'DEV_AUTH_DISABLED', message: 'Dev auth is not enabled' }] },
      { status: 403 },
    );
  }

  // Lightweight rate limiting keyed by IP (no auth context yet)
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const rateLimitResult = checkRateLimit(ip, 'max_messages_per_minute_per_user');
  if (rateLimitResult) return rateLimitResult;

  // Parse and validate request body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: [{ code: 'INVALID_BODY', message: 'Request body must be valid JSON' }] },
      { status: 400 },
    );
  }

  const personaKey = body.persona_key;
  if (typeof personaKey !== 'string') {
    return NextResponse.json(
      { errors: [{ code: 'MISSING_PERSONA_KEY', message: 'persona_key is required' }] },
      { status: 400 },
    );
  }

  const tenant = getDemoTenant(personaKey);
  if (!tenant) {
    return NextResponse.json(
      { errors: [{ code: 'UNKNOWN_PERSONA', message: `Unknown persona key: ${personaKey}` }] },
      { status: 400 },
    );
  }

  // Require explicit JWT secrets — refuse to mint tokens with the auth
  // middleware's predictable dev fallbacks, since that would let anyone
  // who knows the defaults forge tokens in any ENABLE_DEV_AUTH=true env.
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!accessSecret || !refreshSecret) {
    return NextResponse.json(
      {
        errors: [
          {
            code: 'MISSING_JWT_SECRETS',
            message:
              'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set when dev auth is enabled',
          },
        ],
      },
      { status: 500 },
    );
  }

  const jwtConfig: JwtConfig = {
    accessTokenSecret: new TextEncoder().encode(accessSecret),
    refreshTokenSecret: new TextEncoder().encode(refreshSecret),
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    issuer: 'wo-agent',
    audience: 'wo-agent',
  };

  const tokens = await createTokenPair(
    {
      sub: tenant.tenant_user_id,
      account_id: tenant.tenant_account_id,
      unit_ids: [...tenant.authorized_unit_ids],
    },
    jwtConfig,
  );

  return NextResponse.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    tenant: {
      tenant_user_id: tenant.tenant_user_id,
      tenant_account_id: tenant.tenant_account_id,
      authorized_unit_ids: tenant.authorized_unit_ids,
      display_name: tenant.display_name,
      default_unit_id: tenant.default_unit_id,
    },
  });
});
