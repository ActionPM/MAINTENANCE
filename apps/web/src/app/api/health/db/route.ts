import { NextResponse } from 'next/server';
import { getDatabaseUrl } from '@/lib/database-url';
import { withObservedRoute } from '@/lib/observability/with-observed-route';
import { StdoutJsonLogger } from '@wo-agent/core';
import type { Logger } from '@wo-agent/core';

const logger: Logger = new StdoutJsonLogger();

export const GET = withObservedRoute('health:db', async () => {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    return NextResponse.json(
      { status: 'misconfigured', kind: 'readiness', dependency: 'database' },
      { status: 503 },
    );
  }

  // Lazy-import to avoid bundling @neondatabase/serverless when not needed
  const { createPool } = await import('@wo-agent/db');
  const pool = createPool(databaseUrl);

  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const latency_ms = Date.now() - start;

    return NextResponse.json({
      status: 'ok',
      kind: 'readiness',
      dependency: 'database',
      latency_ms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log({
      component: 'health',
      event: 'db_check_failed',
      severity: 'warn',
      timestamp: new Date().toISOString(),
      error_message: message,
    });
    return NextResponse.json(
      { status: 'unavailable', kind: 'readiness', dependency: 'database' },
      { status: 503 },
    );
  } finally {
    await pool.end();
  }
});
