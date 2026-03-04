import { NextResponse } from 'next/server';
import { getAnalyticsService } from '../../../lib/orchestrator-factory.js';
import type { AnalyticsQuery } from '@wo-agent/core';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const query: AnalyticsQuery = {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    client_id: url.searchParams.get('client_id') ?? undefined,
    property_id: url.searchParams.get('property_id') ?? undefined,
    unit_id: url.searchParams.get('unit_id') ?? undefined,
  };

  const result = await getAnalyticsService().compute(query);
  return NextResponse.json(result);
}
