import type { WorkOrder } from '@wo-agent/schemas';
import type { WorkOrderRepository } from '../work-order/types.js';

/**
 * High-Value Tenant (HVT) threshold (spec §1.7).
 * A tenant with >= HVT_THRESHOLD open WOs is flagged as HVT.
 */
export const HVT_THRESHOLD = 3;

/**
 * Open WO statuses — WOs in these statuses count toward HVT.
 */
const OPEN_STATUSES = new Set(['created', 'action_required', 'scheduled']);

/**
 * Compute whether a tenant qualifies as a High-Value Tenant.
 * Returns { is_hvt, open_wo_count }.
 */
export function computeHvtFlag(workOrders: readonly WorkOrder[]): {
  is_hvt: boolean;
  open_wo_count: number;
} {
  const openCount = workOrders.filter((wo) => OPEN_STATUSES.has(wo.status)).length;
  return {
    is_hvt: openCount >= HVT_THRESHOLD,
    open_wo_count: openCount,
  };
}

/**
 * Query-based HVT check for a tenant user.
 * Fetches WOs from the repo and computes HVT status.
 */
export async function isHighValueTenant(
  tenantUserId: string,
  workOrderRepo: WorkOrderRepository,
): Promise<{ is_hvt: boolean; open_wo_count: number }> {
  const workOrders = await workOrderRepo.listAll({ tenant_user_id: tenantUserId });
  return computeHvtFlag(workOrders);
}
