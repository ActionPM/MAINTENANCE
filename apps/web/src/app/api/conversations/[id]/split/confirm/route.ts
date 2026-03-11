import { NextRequest, NextResponse } from 'next/server';
import { ActionType, ActorType } from '@wo-agent/schemas';
import { authenticateRequest } from '@/middleware/auth';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { getOrchestrator } from '@/lib/orchestrator-factory';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const rateLimitResult = checkRateLimit(
    authResult.tenant_user_id,
    'max_messages_per_minute_per_user',
  );
  if (rateLimitResult) return rateLimitResult;

  const body = await request.json();
  const { id } = await params;

  const dispatch = getOrchestrator();
  const result = await dispatch({
    conversation_id: id,
    action_type: ActionType.CONFIRM_SPLIT,
    actor: ActorType.TENANT,
    tenant_input: body,
    auth_context: authResult,
  });

  return NextResponse.json(result.response);
}
