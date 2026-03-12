import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

export const POST = withObservedRoute('photos:init', async (request: NextRequest, ctx) => {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_photo_uploads_per_conversation',
  );
  if (rateLimitResult) return rateLimitResult;

  const body = await request.json();

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: body.conversation_id,
    action_type: ActionType.UPLOAD_PHOTO_INIT,
    actor: ActorType.TENANT,
    tenant_input: {
      filename: body.filename,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
    },
    auth_context: authResult,
    request_id: ctx.request_id,
  });

  return NextResponse.json(result.response);
});
