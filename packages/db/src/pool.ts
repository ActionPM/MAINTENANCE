import { Pool } from '@neondatabase/serverless';

export interface PoolOptions {
  statementTimeoutMs?: number;
}

export const DEFAULT_POOL_OPTIONS: PoolOptions = {
  statementTimeoutMs: 5_000,
};

/**
 * Create a Neon connection pool.
 * In Vercel serverless, each invocation gets a short-lived pool.
 * The @neondatabase/serverless driver uses WebSockets for edge compat.
 */
export function createPool(
  databaseUrl: string | undefined,
  opts: PoolOptions = DEFAULT_POOL_OPTIONS,
): Pool {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for PostgreSQL connection');
  }
  const timeoutMs = opts.statementTimeoutMs ?? DEFAULT_POOL_OPTIONS.statementTimeoutMs;
  return new Pool({
    connectionString: databaseUrl,
    options: `-c statement_timeout=${timeoutMs}`,
  });
}

export type { Pool } from '@neondatabase/serverless';
