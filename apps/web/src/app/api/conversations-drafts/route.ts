import { NextRequest, NextResponse } from 'next/server';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/conversations-drafts (DEPRECATED)
 *
 * Redirects to the spec-correct path: /api/conversations/drafts
 */
export const GET = withObservedRoute(
  'conversations-drafts:redirect',
  async (request: NextRequest) => {
    const url = new URL('/api/conversations/drafts', request.url);
    return NextResponse.redirect(url, 301);
  },
);
