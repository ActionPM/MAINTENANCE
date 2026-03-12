import { NextResponse } from 'next/server';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

export const GET = withObservedRoute('health', async () => {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      db: 'stub',
      llm: 'stub',
      storage: 'stub',
      notifications: 'stub',
    },
  });
});
