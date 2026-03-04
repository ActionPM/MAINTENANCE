import type { StatusHistoryEntry } from './work-order.js';
import type { WorkOrderStatus } from '../work-order-status.js';

export interface SlaMetadata {
  readonly priority: string;
  readonly response_hours: number;
  readonly resolution_hours: number;
  readonly response_due_at: string;
  readonly resolution_due_at: string;
}

export interface CommunicationEntry {
  readonly notification_id: string;
  readonly channel: 'in_app' | 'sms';
  readonly notification_type: string;
  readonly status: 'pending' | 'sent' | 'delivered' | 'failed';
  readonly created_at: string;
  readonly sent_at: string | null;
}

export interface ResolutionInfo {
  readonly resolved: boolean;
  readonly final_status: WorkOrderStatus;
  readonly resolved_at: string | null;
}

export interface RecordBundle {
  readonly work_order_id: string;
  readonly conversation_id: string;
  readonly created_at: string;
  readonly unit_id: string;
  readonly summary: string;
  readonly classification: Record<string, string>;
  readonly urgency_basis: {
    readonly has_emergency: boolean;
    readonly highest_severity: string | null;
    readonly trigger_ids: readonly string[];
  };
  readonly status_history: readonly StatusHistoryEntry[];
  readonly communications: readonly CommunicationEntry[];
  readonly schedule: SlaMetadata;
  readonly resolution: ResolutionInfo;
  readonly exported_at: string;
}
