import type { RecordBundle, CommunicationEntry, ResolutionInfo, NotificationEvent } from '@wo-agent/schemas';
import { WorkOrderStatus } from '@wo-agent/schemas';
import type { RecordBundleDeps } from './types.js';
import { computeSlaMetadata } from './sla-calculator.js';

const TERMINAL_STATUSES: readonly string[] = [WorkOrderStatus.RESOLVED, WorkOrderStatus.CANCELLED];

/**
 * Assemble a tenant-copyable record bundle for a work order (spec §21).
 * Pure read-only operation — no mutations, no side effects.
 * Returns null if the work order does not exist.
 */
export async function assembleRecordBundle(
  workOrderId: string,
  deps: RecordBundleDeps,
): Promise<RecordBundle | null> {
  const wo = await deps.workOrderRepo.getById(workOrderId);
  if (!wo) return null;

  // 1. Communications from notification events
  const notifications = await deps.notificationRepo.queryByConversation(wo.conversation_id);
  const communications: CommunicationEntry[] = notifications
    .filter(n => n.work_order_ids.includes(workOrderId))
    .map(toCommunicationEntry);

  // 2. SLA schedule
  const priority = (wo.classification['Priority'] as string) ?? 'normal';
  const schedule = computeSlaMetadata({
    priority,
    classification: wo.classification,
    createdAt: wo.created_at,
    slaPolicies: deps.slaPolicies,
  });

  // 3. Resolution
  const resolution = computeResolution(wo.status, wo.status_history);

  // 4. Urgency basis from risk_flags
  const riskFlags = wo.risk_flags as Record<string, unknown> | undefined;
  const urgencyBasis = {
    has_emergency: (riskFlags?.['has_emergency'] as boolean) ?? false,
    highest_severity: (riskFlags?.['highest_severity'] as string) ?? null,
    trigger_ids: (riskFlags?.['trigger_ids'] as string[]) ?? [],
  };

  return {
    work_order_id: wo.work_order_id,
    conversation_id: wo.conversation_id,
    created_at: wo.created_at,
    unit_id: wo.unit_id,
    summary: wo.summary_confirmed,
    classification: wo.classification,
    urgency_basis: urgencyBasis,
    status_history: [...wo.status_history],
    communications,
    schedule,
    resolution,
    exported_at: deps.clock(),
  };
}

function toCommunicationEntry(n: NotificationEvent): CommunicationEntry {
  return {
    notification_id: n.notification_id,
    channel: n.channel,
    notification_type: n.notification_type,
    status: n.status,
    created_at: n.created_at,
    sent_at: n.sent_at,
  };
}

function computeResolution(
  currentStatus: string,
  statusHistory: readonly { readonly status: string; readonly changed_at: string; readonly actor: string }[],
): ResolutionInfo {
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus);
  if (!isTerminal) {
    return { resolved: false, final_status: currentStatus as ResolutionInfo['final_status'], resolved_at: null };
  }

  // Find the last entry with the terminal status
  const terminalEntry = [...statusHistory].reverse().find(e => e.status === currentStatus);

  return {
    resolved: currentStatus === WorkOrderStatus.RESOLVED,
    final_status: currentStatus as ResolutionInfo['final_status'],
    resolved_at: terminalEntry?.changed_at ?? null,
  };
}
