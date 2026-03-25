/**
 * Prefer Neon/Vercel integration's unpooled URL when available.
 * The pooled URL rejects our startup statement_timeout option.
 */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
}
