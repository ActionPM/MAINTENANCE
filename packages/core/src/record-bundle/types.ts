import type { WorkOrderRepository } from '../work-order/types.js';
import type { NotificationRepository } from '../notifications/types.js';

export interface SlaPolicyEntry {
  readonly response_hours: number;
  readonly resolution_hours: number;
}

export interface SlaOverride {
  readonly taxonomy_path: string;
  readonly response_hours: number;
  readonly resolution_hours: number;
}

export interface SlaPolicies {
  readonly version: string;
  readonly client_defaults: Record<string, SlaPolicyEntry>;
  readonly overrides: readonly SlaOverride[];
}

export interface RecordBundleDeps {
  readonly workOrderRepo: WorkOrderRepository;
  readonly notificationRepo: NotificationRepository;
  readonly slaPolicies: SlaPolicies;
  readonly clock: () => string;
}
