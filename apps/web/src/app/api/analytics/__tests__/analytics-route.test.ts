import { describe, it, expect } from 'vitest';
import { GET } from '../route.js';

describe('GET /api/analytics (Phase 13)', () => {
  it('returns 200 with analytics result', async () => {
    const req = new Request('http://localhost:3000/api/analytics');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('overview');
    expect(body).toHaveProperty('taxonomy_breakdown');
    expect(body).toHaveProperty('sla');
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('generated_at');
    expect(body.overview).toHaveProperty('total_work_orders');
  });

  it('accepts query parameters for filtering', async () => {
    const req = new Request('http://localhost:3000/api/analytics?client_id=c-1&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query.client_id).toBe('c-1');
    expect(body.query.from).toBe('2026-01-01T00:00:00Z');
    expect(body.query.to).toBe('2026-03-01T00:00:00Z');
  });
});
