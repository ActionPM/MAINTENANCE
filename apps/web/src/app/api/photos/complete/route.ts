import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(authResult.tenant_user_id, 'max_photo_uploads_per_conversation');
  if (rateLimitResult) return rateLimitResult;

  const body = await request.json();

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: body.conversation_id,
    action_type: ActionType.UPLOAD_PHOTO_COMPLETE,
    actor: ActorType.TENANT,
    tenant_input: { photo_id: body.photo_id, storage_key: body.storage_key, sha256: body.sha256 },
    auth_context: authResult,
  });

  return NextResponse.json(result.response);
}
