/**
 * Classification pipeline events — append-only, INSERT only (spec §7).
 * Logged during constraint resolution and hierarchy validation.
 */
export interface ClassificationEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type:
    | 'classification_hierarchy_violation_unresolved'
    | 'classification_constraint_resolution';
  readonly issue_id: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}
