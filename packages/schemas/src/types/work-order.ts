import type { WorkOrderStatus } from '../work-order-status.js';
import type { ActorType } from '../action-types.js';
import type { PinnedVersions } from '../version-pinning.js';

export interface StatusHistoryEntry {
  readonly status: WorkOrderStatus;
  readonly changed_at: string;
  readonly actor: ActorType;
}

export interface PhotoReference {
  readonly photo_id: string;
  readonly storage_key: string;
  readonly sha256: string;
  readonly scanned_status: 'pending' | 'clean' | 'infected' | 'error';
}

export type PetsPresent = 'yes' | 'no' | 'unknown';

export interface WorkOrder {
  readonly work_order_id: string;
  readonly issue_group_id: string;
  readonly issue_id: string;
  readonly client_id: string;
  readonly property_id: string;
  readonly unit_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly status: WorkOrderStatus;
  readonly status_history: readonly StatusHistoryEntry[];
  readonly raw_text: string;
  readonly summary_confirmed: string;
  readonly photos: readonly PhotoReference[];
  readonly classification: Record<string, string>;
  readonly confidence_by_field: Record<string, number>;
  readonly missing_fields: readonly string[];
  readonly pets_present: PetsPresent;
  readonly risk_flags?: Record<string, unknown>;
  readonly needs_human_triage: boolean;
  readonly pinned_versions: PinnedVersions;
  readonly created_at: string;
  readonly updated_at: string;
  readonly row_version: number;
}
