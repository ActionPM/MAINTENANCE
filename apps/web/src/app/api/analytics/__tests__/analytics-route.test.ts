import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Mock auth middleware — must be before route import
vi.mock('@/middleware/auth', () => ({
  authenticateRequest: vi.fn(),
}));

import { GET } from '../route.js';
import { authenticateRequest } from '@/middleware/auth';

const mockAuth = vi.mocked(authenticateRequest);

describe('GET /api/analytics (Phase 13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when auth fails', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json(
        { errors: [{ code: 'TOKEN_MISSING', message: 'Missing authorization header' }] },
        { status: 401 },
      ),
    );

    const req = new Request('http://localhost:3000/api/analytics');
    const res = await GET(req as any);

    expect(res.status).toBe(401);
  });

  it('returns 200 with analytics result when authenticated', async () => {
    mockAuth.mockResolvedValue({
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      authorized_unit_ids: ['u-1'],
    });

    const req = new Request('http://localhost:3000/api/analytics');
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('overview');
    expect(body).toHaveProperty('taxonomy_breakdown');
    expect(body).toHaveProperty('sla');
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('generated_at');
    expect(body.overview).toHaveProperty('total_work_orders');
  });

  it('passes query parameters and auth scope to analytics service', async () => {
    mockAuth.mockResolvedValue({
      tenant_user_id: 'tu-1',
      tenant_account_id: 'ta-1',
      authorized_unit_ids: ['u-1', 'u-2'],
    });

    const req = new Request(
      'http://localhost:3000/api/analytics?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z',
    );
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query.from).toBe('2026-01-01T00:00:00Z');
    expect(body.query.to).toBe('2026-03-01T00:00:00Z');
    expect(body.query.authorized_unit_ids).toEqual(['u-1', 'u-2']);
  });
});
