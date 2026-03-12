import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/middleware/auth';
import { getWorkOrderRepo } from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/work-orders
 *
 * Returns work orders owned by the authenticated tenant, additionally
 * scoped to their authorized_unit_ids. Filters at the data layer via
 * WorkOrderListFilters — not in route code.
 */
export const GET = withObservedRoute('work-orders:list', async (request: NextRequest) => {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const workOrderRepo = getWorkOrderRepo();
  const workOrders = await workOrderRepo.listAll({
    tenant_user_id: authResult.tenant_user_id,
    unit_ids: authResult.authorized_unit_ids,
  });

  return NextResponse.json({ work_orders: workOrders });
});
