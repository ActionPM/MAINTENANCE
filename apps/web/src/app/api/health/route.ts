import { NextResponse } from 'next/server';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

export const GET = withObservedRoute('health', async () => {
  return NextResponse.json({
    status: 'ok',
    kind: 'liveness',
    timestamp: new Date().toISOString(),
  });
});
