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
}

export interface CreateSessionInput {
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly authorized_unit_ids: readonly string[];
  readonly pinned_versions: PinnedVersions;
}
