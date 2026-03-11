import { NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Stub: GET /conversations/:id — full implementation in later phases
  return NextResponse.json({ conversation_id: id, status: 'stub' });
}
