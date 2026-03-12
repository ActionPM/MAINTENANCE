import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getWorkOrderRepo, getNotificationRepo } from '@/lib/orchestrator-factory';
import { assembleRecordBundle } from '@wo-agent/core';
import type { SlaPolicies } from '@wo-agent/core';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };
import { withObservedRoute } from '@/lib/observability/with-observed-route';

const slaPolicies = slaPoliciesJson as SlaPolicies;

export const GET = withObservedRoute(
  'work-orders:record-bundle',
  async (request: NextRequest, _ctx, { params }: { params: Promise<{ id: string }> }) => {
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
    // Ownership check — return NOT_FOUND to avoid leaking record existence
    if (wo.tenant_user_id !== authResult.tenant_user_id) {
      return NextResponse.json(
        { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
        { status: 404 },
      );
    }

    // Unit membership check — tenant must still have access to the WO's unit
    const unitSet = new Set(authResult.authorized_unit_ids);
    if (!unitSet.has(wo.unit_id)) {
      return NextResponse.json(
        { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
        { status: 404 },
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
  },
);
