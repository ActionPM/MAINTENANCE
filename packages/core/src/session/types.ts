import type { ConversationState, PinnedVersions, SplitIssue } from '@wo-agent/schemas';

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
  readonly prior_state_before_error: ConversationState | null;
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
