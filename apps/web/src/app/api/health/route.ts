import { NextResponse } from 'next/server';

export async function GET() {
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
}
