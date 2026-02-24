import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  // Stub: GET /conversations/drafts — full implementation in later phases
  // Would use filterResumableDrafts from @wo-agent/core
  return NextResponse.json({ drafts: [] });
}
