import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_new_conversations_per_day_per_user',
    24 * 60 * 60 * 1000,
  );
  if (rateLimitResult) return rateLimitResult;

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: null,
    action_type: ActionType.CREATE_CONVERSATION,
    actor: ActorType.TENANT,
    tenant_input: {},
    auth_context: authResult,
  });

  return NextResponse.json(result.response, { status: 201 });
}
