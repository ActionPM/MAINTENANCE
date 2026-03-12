import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock rate limiter — must be before route import
vi.mock('@/middleware/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockReturnValue(null),
}));

// Mock createTokenPair — jose doesn't work in jsdom; JWT logic tested in core
const mockCreateTokenPair = vi.fn().mockResolvedValue({
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
});
vi.mock('@wo-agent/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, createTokenPair: (...args: unknown[]) => mockCreateTokenPair(...args) };
});

import { POST } from '../route.js';

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost:3000/api/dev/auth/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dev/auth/demo-login', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Snapshot env vars we'll mutate
    savedEnv.ENABLE_DEV_AUTH = process.env.ENABLE_DEV_AUTH;
    savedEnv.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
    savedEnv.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  function enableDevAuth() {
    process.env.ENABLE_DEV_AUTH = 'true';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters!!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters!!';
  }

  it('returns 403 when ENABLE_DEV_AUTH is false', async () => {
    process.env.ENABLE_DEV_AUTH = 'false';
    const res = await POST(makeRequest({ persona_key: 'alice' }) as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.errors[0].code).toBe('DEV_AUTH_DISABLED');
  });

  it('returns 403 when ENABLE_DEV_AUTH env var is absent', async () => {
    delete process.env.ENABLE_DEV_AUTH;
    const res = await POST(makeRequest({ persona_key: 'alice' }) as any);
    expect(res.status).toBe(403);
  });

  it('returns 500 when ENABLE_DEV_AUTH is true but JWT secrets are missing', async () => {
    process.env.ENABLE_DEV_AUTH = 'true';
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    const res = await POST(makeRequest({ persona_key: 'alice' }) as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.errors[0].code).toBe('MISSING_JWT_SECRETS');
  });

  it('returns 400 for unknown persona key', async () => {
    enableDevAuth();
    const res = await POST(makeRequest({ persona_key: 'unknown-person' }) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].code).toBe('UNKNOWN_PERSONA');
  });

  it('returns 400 when persona_key is missing', async () => {
    enableDevAuth();
    const res = await POST(makeRequest({}) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].code).toBe('MISSING_PERSONA_KEY');
  });

  it('returns tokens with correct tenant metadata for alice', async () => {
    enableDevAuth();
    const res = await POST(makeRequest({ persona_key: 'alice' }) as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.access_token).toBe('mock-access-token');
    expect(body.refresh_token).toBe('mock-refresh-token');
    expect(body.tenant.tenant_user_id).toBe('tu-demo-alice');
    expect(body.tenant.tenant_account_id).toBe('ta-demo-acme');
    expect(body.tenant.authorized_unit_ids).toEqual(['unit-101']);
    expect(body.tenant.display_name).toBe('Alice Johnson');
    expect(body.tenant.default_unit_id).toBe('unit-101');

    // Verify createTokenPair was called with correct JWT claims
    expect(mockCreateTokenPair).toHaveBeenCalledWith(
      {
        sub: 'tu-demo-alice',
        account_id: 'ta-demo-acme',
        unit_ids: ['unit-101'],
      },
      expect.objectContaining({
        issuer: 'wo-agent',
        audience: 'wo-agent',
      }),
    );
  });

  it('returns tokens with correct claims for bob (multi-unit)', async () => {
    enableDevAuth();
    const res = await POST(makeRequest({ persona_key: 'bob' }) as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tenant.tenant_user_id).toBe('tu-demo-bob');
    expect(body.tenant.tenant_account_id).toBe('ta-demo-acme');
    expect(body.tenant.authorized_unit_ids).toEqual(['unit-201', 'unit-202', 'unit-203']);

    expect(mockCreateTokenPair).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'tu-demo-bob',
        unit_ids: ['unit-201', 'unit-202', 'unit-203'],
      }),
      expect.any(Object),
    );
  });

  it('returns tokens with correct claims for carol (different account)', async () => {
    enableDevAuth();
    const res = await POST(makeRequest({ persona_key: 'carol' }) as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tenant.tenant_user_id).toBe('tu-demo-carol');
    expect(body.tenant.tenant_account_id).toBe('ta-demo-birch');
    expect(body.tenant.authorized_unit_ids).toEqual(['unit-301']);
  });
});
