import { describe, it, expect } from 'vitest';
import { createPool } from '../pool.js';

describe('createPool', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => createPool(undefined)).toThrow('DATABASE_URL');
  });

  it('returns a pool when DATABASE_URL is provided', () => {
    const pool = createPool('postgres://fake:fake@fake.neon.tech/fake?sslmode=require');
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });
});
