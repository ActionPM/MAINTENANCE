/**
 * Query filters for analytics endpoint (spec §24.1).
 * Scope is derived from auth context (authorized_unit_ids), never from
 * tenant-supplied client/property/unit params (Non-Negotiable #5).
 */
export interface AnalyticsQuery {
  /** ISO 8601 start of time range (inclusive). */
  readonly from?: string;
  /** ISO 8601 end of time range (exclusive). */
  readonly to?: string;
  /** Unit IDs the caller is authorized to see — derived from auth context. */
  readonly authorized_unit_ids?: readonly string[];
}

/**
 * High-level WO counts and flags.
 */
export interface OverviewMetrics {
  readonly total_work_orders: number;
  readonly by_status: Readonly<Record<string, number>>;
  readonly needs_human_triage: number;
  readonly has_emergency: number;
}

/**
 * WO counts grouped by taxonomy classification fields.
 * Key = field name (e.g. "Category"), Value = { label: count }.
 */
export type TaxonomyBreakdown = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * SLA adherence metrics (spec §22 — MVP compute + report only).
 */
export interface SlaMetrics {
  readonly total_with_sla: number;
  readonly response_adherence_pct: number;
  readonly resolution_adherence_pct: number;
  readonly avg_response_hours: number | null;
  readonly avg_resolution_hours: number | null;
}

/**
 * Notification delivery metrics (spec §20).
 */
export interface NotificationMetrics {
  readonly total_sent: number;
  readonly by_channel: Readonly<Record<string, number>>;
  readonly by_type: Readonly<Record<string, number>>;
  readonly delivery_success_pct: number;
}

/**
 * Full analytics response returned by GET /analytics.
 */
export interface AnalyticsResult {
  readonly query: AnalyticsQuery;
  readonly overview: OverviewMetrics;
  readonly taxonomy_breakdown: TaxonomyBreakdown;
  readonly sla: SlaMetrics;
  readonly notifications: NotificationMetrics;
  readonly generated_at: string;
}
