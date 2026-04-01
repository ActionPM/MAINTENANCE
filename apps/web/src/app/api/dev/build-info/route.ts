import { NextResponse } from 'next/server';
import { getBuildInfo } from '@/lib/build-info';

export async function GET() {
  return NextResponse.json(getBuildInfo());
}
