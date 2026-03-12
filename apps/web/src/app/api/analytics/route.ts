import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getAnalyticsService } from '../../../lib/orchestrator-factory.js';
import type { AnalyticsQuery } from '@wo-agent/core';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

export const GET = withObservedRoute('analytics', async (request: NextRequest) => {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const url = new URL(request.url);

  const query: AnalyticsQuery = {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    authorized_unit_ids: authResult.authorized_unit_ids as string[],
  };

  const result = await getAnalyticsService().compute(query);
  return NextResponse.json(result);
});
