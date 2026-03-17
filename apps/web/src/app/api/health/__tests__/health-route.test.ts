import { describe, it, expect } from 'vitest';
import { GET } from '../route.js';

describe('GET /api/health (liveness)', () => {
  it('returns 200 with liveness payload', async () => {
    const req = new Request('http://localhost:3000/api/health');
    const res = await GET(req as any);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.kind).toBe('liveness');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.timestamp).toBe('string');
  });

  it('does not include a services field', async () => {
    const req = new Request('http://localhost:3000/api/health');
    const res = await GET(req as any);
    const body = await res.json();

    expect(body).not.toHaveProperty('services');
  });

  it('returns a valid ISO 8601 timestamp', async () => {
    const req = new Request('http://localhost:3000/api/health');
    const res = await GET(req as any);
    const body = await res.json();

    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });
});
