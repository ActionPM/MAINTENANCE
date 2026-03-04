import { Pool } from '@neondatabase/serverless';

/**
 * Create a Neon connection pool.
 * In Vercel serverless, each invocation gets a short-lived pool.
 * The @neondatabase/serverless driver uses WebSockets for edge compat.
 */
export function createPool(databaseUrl: string | undefined): Pool {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for PostgreSQL connection');
  }
  return new Pool({ connectionString: databaseUrl });
}

export type { Pool } from '@neondatabase/serverless';
