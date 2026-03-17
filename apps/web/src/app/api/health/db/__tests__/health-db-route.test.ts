import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('@wo-agent/db', () => ({
  createPool: vi.fn(() => ({
    query: mockQuery,
    end: mockEnd,
  })),
}));

import { GET } from '../route.js';

describe('GET /api/health/db (readiness)', () => {
  const originalEnv = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalEnv;
    }
  });

  it('returns 503 misconfigured when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;

    const req = new Request('http://localhost:3000/api/health/db');
    const res = await GET(req as any);

    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe('misconfigured');
    expect(body.kind).toBe('readiness');
    expect(body.dependency).toBe('database');
  });

  it('returns 200 ok with latency_ms when pool query succeeds', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockEnd.mockResolvedValue(undefined);

    const req = new Request('http://localhost:3000/api/health/db');
    const res = await GET(req as any);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.kind).toBe('readiness');
    expect(body.dependency).toBe('database');
    expect(typeof body.latency_ms).toBe('number');
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns 503 unavailable without leaking error details when pool query throws', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    mockQuery.mockRejectedValue(new Error('connection refused'));
    mockEnd.mockResolvedValue(undefined);

    const req = new Request('http://localhost:3000/api/health/db');
    const res = await GET(req as any);

    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe('unavailable');
    expect(body.kind).toBe('readiness');
    expect(body.dependency).toBe('database');
    expect(body).not.toHaveProperty('error');
  });

  it('closes the pool even when the query fails', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    mockQuery.mockRejectedValue(new Error('connection refused'));
    mockEnd.mockResolvedValue(undefined);

    const req = new Request('http://localhost:3000/api/health/db');
    await GET(req as any);

    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
