import { NextRequest, NextResponse } from 'next/server';
import { StdoutJsonLogger } from '@wo-agent/core';
import type { Logger } from '@wo-agent/core';
import { createRequestContext } from '@/middleware/request-context';

const logger: Logger = new StdoutJsonLogger();

type RouteContext = { request_id: string };

type RouteHandler = (
  request: NextRequest,
  routeCtx: RouteContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<NextResponse>;

/**
 * Wraps a Next.js route handler with structured logging.
 * Logs request_started, request_completed, and request_failed events.
 * Passes request_id to the inner handler so it can propagate to dispatch calls.
 */
export function withObservedRoute(
  routeName: string,
  handler: RouteHandler,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async function observedHandler(request: NextRequest, ...args: any[]) {
    const ctx = createRequestContext();
    const startTime = Date.now();

    logger.log({
      component: 'route',
      event: 'request_started',
      request_id: ctx.request_id,
      severity: 'info',
      timestamp: ctx.timestamp,
      route: routeName,
      method: request.method,
    });

    try {
      const response = await handler(request, ctx, ...args);
      const duration_ms = Date.now() - startTime;

      logger.log({
        component: 'route',
        event: 'request_completed',
        request_id: ctx.request_id,
        severity: 'info',
        timestamp: new Date().toISOString(),
        route: routeName,
        method: request.method,
        status: response.status,
        duration_ms,
      });

      return response;
    } catch (error) {
      const duration_ms = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      logger.log({
        component: 'route',
        event: 'request_failed',
        request_id: ctx.request_id,
        severity: 'error',
        timestamp: new Date().toISOString(),
        route: routeName,
        method: request.method,
        error_message: message,
        duration_ms,
      });

      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}
