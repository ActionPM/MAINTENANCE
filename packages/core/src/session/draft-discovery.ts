import { RESUMABLE_STATES } from '@wo-agent/schemas';
import type { ConversationSession } from './types.js';

const MAX_DRAFTS = 3;

/**
 * Filter and sort resumable drafts for a tenant (spec §12.1).
 *
 * Resumable states: unit_selection_required, split_proposed,
 * classification_in_progress, needs_tenant_input,
 * tenant_confirmation_pending, llm_error_retryable, intake_abandoned.
 *
 * Sorted by last_activity_at descending, limited to 3.
 * Resumed conversations retain their pinned versions.
 */
export function filterResumableDrafts(
  sessions: readonly ConversationSession[],
  tenantUserId: string,
): ConversationSession[] {
  return sessions
    .filter((s) => s.tenant_user_id === tenantUserId && RESUMABLE_STATES.has(s.state))
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
    .slice(0, MAX_DRAFTS);
}
