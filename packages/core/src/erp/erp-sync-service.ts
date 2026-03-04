import { ActorType } from '@wo-agent/schemas';
import type { WorkOrderRepository, WorkOrderEvent } from '../work-order/types.js';
import { buildWorkOrderStatusChangedEvent } from '../work-order/event-builder.js';
import type { ERPAdapter } from './types.js';

export interface ERPSyncServiceDeps {
  readonly erpAdapter: ERPAdapter;
  readonly workOrderRepo: WorkOrderRepository;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

export interface SyncResult {
  readonly applied: number;
  readonly failed: number;
  readonly errors: readonly SyncError[];
  readonly events: readonly WorkOrderEvent[];
}

export interface SyncError {
  readonly work_order_id: string;
  readonly ext_id: string;
  readonly reason: string;
}

/**
 * ERP sync service (spec §23).
 * Pulls status updates from the ERP adapter and applies them to the WO store.
 * Each applied update produces a status_changed WorkOrderEvent.
 */
export class ERPSyncService {
  private readonly deps: ERPSyncServiceDeps;

  constructor(deps: ERPSyncServiceDeps) {
    this.deps = deps;
  }

  async sync(since: string): Promise<SyncResult> {
    const { erpAdapter, workOrderRepo, idGenerator, clock } = this.deps;
    const updates = await erpAdapter.syncUpdates(since);

    let applied = 0;
    let failed = 0;
    const errors: SyncError[] = [];
    const events: WorkOrderEvent[] = [];

    for (const update of updates) {
      try {
        const wo = await workOrderRepo.getById(update.work_order_id);
        if (!wo) {
          errors.push({ work_order_id: update.work_order_id, ext_id: update.ext_id, reason: 'Work order not found' });
          failed++;
          continue;
        }

        const updated = await workOrderRepo.updateStatus(
          update.work_order_id,
          update.new_status,
          ActorType.SYSTEM,
          update.updated_at,
          wo.row_version,
        );

        const event = buildWorkOrderStatusChangedEvent({
          eventId: idGenerator(),
          workOrderId: update.work_order_id,
          conversationId: updated.conversation_id,
          previousStatus: update.previous_status,
          newStatus: update.new_status,
          actor: ActorType.SYSTEM,
          createdAt: clock(),
        });

        events.push(event);
        applied++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ work_order_id: update.work_order_id, ext_id: update.ext_id, reason });
        failed++;
      }
    }

    return { applied, failed, errors, events };
  }
}
