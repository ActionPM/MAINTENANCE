import { describe, it, expect, vi } from 'vitest';

const { mockQuery, mockEnd, mockCreatePool } = vi.hoisted(() => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  const mockCreatePool = vi.fn().mockReturnValue({
    query: mockQuery,
    end: mockEnd,
  });
  return { mockQuery, mockEnd, mockCreatePool };
});

vi.mock('../pool.js', () => ({
  createPool: mockCreatePool,
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:path', () => ({
  join: vi.fn().mockReturnValue('/fake/migrations'),
}));

import { runMigrations } from '../migrate.js';

describe('runMigrations timeout', () => {
  it('creates pool with 30s statement timeout', async () => {
    await runMigrations('postgres://fake');
    expect(mockCreatePool).toHaveBeenCalledWith('postgres://fake', {
      statementTimeoutMs: 30_000,
    });
  });
});
