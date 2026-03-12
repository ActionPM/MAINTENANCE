import { NextResponse } from 'next/server';
import { getERPAdapter } from '../../../../lib/orchestrator-factory.js';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

export const GET = withObservedRoute('health:erp', async () => {
  try {
    const adapter = getERPAdapter();
    const result = await adapter.healthCheck();
    const status = result.healthy ? 200 : 503;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ healthy: false }, { status: 503 });
  }
});
