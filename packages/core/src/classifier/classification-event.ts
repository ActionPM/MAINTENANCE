/**
 * Classification pipeline events — append-only, INSERT only (spec §7).
 * Logged during constraint resolution and hierarchy validation.
 */
export interface ClassificationEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type:
    | 'classification_hierarchy_violation_unresolved'
    | 'classification_constraint_resolution'
    | 'classification_pinned_answer_contradiction'
    | 'classification_descendant_invalidation';
  readonly issue_id: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}
