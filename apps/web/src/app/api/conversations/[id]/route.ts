import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getSessionStore } from '@/lib/orchestrator-factory';
import { buildResponse } from '@wo-agent/core';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/conversations/:id
 *
 * Returns the ConversationSnapshot for a conversation owned by the
 * authenticated tenant. Ownership is verified server-side; another
 * tenant's session returns 404 (not 403) to avoid leaking existence.
 */
export const GET = withObservedRoute('conversations:detail', async (request: NextRequest, _ctx, { params }: { params: Promise<{ id: string }> }) => {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const sessionStore = getSessionStore();
  const session = await sessionStore.get(id);

  if (!session) {
    return NextResponse.json(
      { errors: [{ code: 'NOT_FOUND', message: 'Conversation not found' }] },
      { status: 404 },
    );
  }

  // Ownership check — return NOT_FOUND to avoid leaking record existence
  if (session.tenant_user_id !== authResult.tenant_user_id) {
    return NextResponse.json(
      { errors: [{ code: 'NOT_FOUND', message: 'Conversation not found' }] },
      { status: 404 },
    );
  }

  // Build ConversationSnapshot using the existing projection logic
  const response = buildResponse({
    newState: session.state,
    session,
    uiMessages: [],
  });

  return NextResponse.json(response.conversation_snapshot);
});
