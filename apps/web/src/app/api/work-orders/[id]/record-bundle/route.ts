import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getWorkOrderRepo, getNotificationRepo } from '@/lib/orchestrator-factory';
import { assembleRecordBundle } from '@wo-agent/core';
import type { SlaPolicies } from '@wo-agent/core';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };

const slaPolicies = slaPoliciesJson as SlaPolicies;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  // 2. Ownership check — load WO first to verify tenant_user_id
  const workOrderRepo = getWorkOrderRepo();
  const wo = await workOrderRepo.getById(id);
  if (!wo) {
    return NextResponse.json(
      { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
      { status: 404 },
    );
  }
  if (wo.tenant_user_id !== authResult.tenant_user_id) {
    return NextResponse.json(
      { errors: [{ code: 'FORBIDDEN', message: 'Not authorized to view this work order' }] },
      { status: 403 },
    );
  }

  // 3. Assemble record bundle
  const bundle = await assembleRecordBundle(id, {
    workOrderRepo,
    notificationRepo: getNotificationRepo(),
    slaPolicies,
    clock: () => new Date().toISOString(),
  });

  // bundle should not be null since we already found the WO, but guard defensively
  if (!bundle) {
    return NextResponse.json(
      { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
      { status: 404 },
    );
  }

  return NextResponse.json(bundle);
}
