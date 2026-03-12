import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getSessionStore } from '@/lib/orchestrator-factory';
import { filterResumableDrafts } from '@wo-agent/core';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/conversations/drafts
 *
 * Returns resumable draft conversations for the authenticated tenant.
 * Sorted by last_activity_at descending, limited to 3 (spec §12.1).
 */
export const GET = withObservedRoute('conversations:drafts', async (request: NextRequest) => {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const sessionStore = getSessionStore();
  const sessions = await sessionStore.getByTenantUser(authResult.tenant_user_id);
  const drafts = filterResumableDrafts(sessions, authResult.tenant_user_id);

  return NextResponse.json({
    drafts: drafts.map((d) => ({
      conversation_id: d.conversation_id,
      state: d.state,
      unit_id: d.unit_id,
      created_at: d.created_at,
      last_activity_at: d.last_activity_at,
    })),
  });
});
