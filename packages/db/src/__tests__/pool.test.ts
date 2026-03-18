import { describe, it, expect, vi } from 'vitest';

// Mock @neondatabase/serverless before importing createPool
vi.mock('@neondatabase/serverless', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    end: vi.fn(),
  }));
  return { Pool: MockPool };
});

import { Pool } from '@neondatabase/serverless';
import { createPool, DEFAULT_POOL_OPTIONS } from '../pool.js';

const MockPool = vi.mocked(Pool);

describe('createPool', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => createPool(undefined)).toThrow('DATABASE_URL');
  });

  it('returns a pool when DATABASE_URL is provided', () => {
    const pool = createPool('postgres://fake:fake@fake.neon.tech/fake?sslmode=require');
    expect(pool).toBeDefined();
  });

  it('passes default statement_timeout=5000 in options', () => {
    createPool('postgres://fake:fake@fake.neon.tech/fake?sslmode=require');
    expect(MockPool).toHaveBeenCalledWith({
      connectionString: 'postgres://fake:fake@fake.neon.tech/fake?sslmode=require',
      options: '-c statement_timeout=5000',
    });
  });

  it('passes custom timeout when specified', () => {
    createPool('postgres://fake:fake@fake.neon.tech/fake?sslmode=require', {
      statementTimeoutMs: 10_000,
    });
    expect(MockPool).toHaveBeenCalledWith({
      connectionString: 'postgres://fake:fake@fake.neon.tech/fake?sslmode=require',
      options: '-c statement_timeout=10000',
    });
  });

  it('passes statement_timeout=0 when zero is specified', () => {
    createPool('postgres://fake:fake@fake.neon.tech/fake?sslmode=require', {
      statementTimeoutMs: 0,
    });
    expect(MockPool).toHaveBeenCalledWith({
      connectionString: 'postgres://fake:fake@fake.neon.tech/fake?sslmode=require',
      options: '-c statement_timeout=0',
    });
  });

  it('exports DEFAULT_POOL_OPTIONS with expected defaults', () => {
    expect(DEFAULT_POOL_OPTIONS).toEqual({ statementTimeoutMs: 5_000 });
  });
});
