import type { ConversationState, IssueClassifierOutput, PinnedVersions, SplitIssue, PreviousQuestion, FollowUpQuestion } from '@wo-agent/schemas';

/**
 * Per-issue classification result stored on the session.
 * Includes the classifier output plus the computed confidence scores.
 */
export interface IssueClassificationResult {
  readonly issue_id: string;
  readonly classifierOutput: IssueClassifierOutput;
  readonly computedConfidence: Record<string, number>;
  readonly fieldsNeedingInput: readonly string[];
}

/**
 * Server-side conversation session (spec §11, §12).
 * This is the authoritative state — ConversationSnapshot (from schemas)
 * is the client-facing projection produced from this.
 */
export interface ConversationSession {
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly state: ConversationState;
  readonly unit_id: string | null;
  readonly authorized_unit_ids: readonly string[];
  readonly pinned_versions: PinnedVersions;
  readonly split_issues: readonly SplitIssue[] | null;
  readonly classification_results: readonly IssueClassificationResult[] | null;
  readonly prior_state_before_error: ConversationState | null;
  readonly followup_turn_number: number;
  readonly total_questions_asked: number;
  readonly previous_questions: readonly PreviousQuestion[];
  readonly pending_followup_questions: readonly FollowUpQuestion[] | null;
  readonly draft_photo_ids: readonly string[];
  readonly created_at: string;
  readonly last_activity_at: string;
  /** ISO timestamp when session entered tenant_confirmation_pending */
  readonly confirmation_entered_at: string | null;
  /** SHA-256 hash of source text at classification time */
  readonly source_text_hash: string | null;
  /** SHA-256 hash of split issues at classification time */
  readonly split_hash: string | null;
  /** Whether confirmation payload has been shown to the tenant */
  readonly confirmation_presented: boolean;
  /** Property ID derived from unit_id via UnitResolver (spec §2.5) */
  readonly property_id: string | null;
  /** Client ID derived from unit_id via UnitResolver (spec §2.5) */
  readonly client_id: string | null;
}

export interface CreateSessionInput {
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly authorized_unit_ids: readonly string[];
  readonly pinned_versions: PinnedVersions;
}
