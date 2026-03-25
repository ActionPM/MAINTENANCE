import { afterEach, describe, expect, it } from 'vitest';
import { getDatabaseUrl } from '../database-url.js';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDatabaseUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalDatabaseUrlUnpooled === undefined) {
    delete process.env.DATABASE_URL_UNPOOLED;
  } else {
    process.env.DATABASE_URL_UNPOOLED = originalDatabaseUrlUnpooled;
  }
});

describe('getDatabaseUrl', () => {
  it('prefers DATABASE_URL_UNPOOLED when both are set', () => {
    process.env.DATABASE_URL = 'postgres://pooled';
    process.env.DATABASE_URL_UNPOOLED = 'postgres://direct';

    expect(getDatabaseUrl()).toBe('postgres://direct');
  });

  it('falls back to DATABASE_URL when DATABASE_URL_UNPOOLED is unset', () => {
    process.env.DATABASE_URL = 'postgres://pooled';
    delete process.env.DATABASE_URL_UNPOOLED;

    expect(getDatabaseUrl()).toBe('postgres://pooled');
  });

  it('returns undefined when neither variable is set', () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;

    expect(getDatabaseUrl()).toBeUndefined();
  });
});
