import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getWorkOrderRepo } from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/work-orders/:id
 *
 * Returns a single work order by ID. Ownership is verified server-side;
 * another tenant's work order returns 404 (not 403) to avoid leaking
 * record existence.
 */
export const GET = withObservedRoute(
  'work-orders:detail',
  async (request: NextRequest, _ctx, { params }: { params: Promise<{ id: string }> }) => {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
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

    // Unit membership check — tenant must still have access to the WO's unit.
    // A tenant who has lost unit access (membership change) should not be able
    // to fetch the work order by ID, matching the list route's behavior.
    const unitSet = new Set(authResult.authorized_unit_ids);
    if (!unitSet.has(wo.unit_id)) {
      return NextResponse.json(
        { errors: [{ code: 'NOT_FOUND', message: 'Work order not found' }] },
        { status: 404 },
      );
    }

    return NextResponse.json(wo);
  },
);
