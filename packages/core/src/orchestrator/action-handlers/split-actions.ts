import { ConversationState, ActionType } from '@wo-agent/schemas';
import type {
  TenantInputMergeIssues,
  TenantInputEditIssue,
  TenantInputAddIssue,
  SplitIssue,
} from '@wo-agent/schemas';
import { setSplitIssues } from '../../session/session.js';
import { sanitizeIssueText, validateIssueConstraints } from '../../splitter/input-sanitizer.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handler for split-related actions (spec §13):
 * CONFIRM_SPLIT, MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE, REJECT_SPLIT
 */
export async function handleSplitAction(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, request } = ctx;
  const actionType = request.action_type;
  const issues = session.split_issues ?? [];

  if (actionType === ActionType.CONFIRM_SPLIT) {
    return handleConfirmSplit(ctx, issues);
  }
  if (actionType === ActionType.REJECT_SPLIT) {
    return handleRejectSplit(ctx, issues);
  }
  if (actionType === ActionType.MERGE_ISSUES) {
    return handleMergeIssues(ctx, issues);
  }
  if (actionType === ActionType.EDIT_ISSUE) {
    return handleEditIssue(ctx, issues);
  }
  if (actionType === ActionType.ADD_ISSUE) {
    return handleAddIssue(ctx, issues);
  }

  return {
    newState: session.state,
    session,
    uiMessages: [],
    errors: [{ code: 'UNKNOWN_SPLIT_ACTION', message: `Unhandled split action: ${actionType}` }],
  };
}

function handleConfirmSplit(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  if (issues.length === 0) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: 'No issues to confirm. Please try again.' }],
      errors: [{ code: 'NO_ISSUES', message: 'Cannot confirm split with no issues' }],
    };
  }

  return {
    newState: ConversationState.SPLIT_FINALIZED,
    session: ctx.session,
    uiMessages: [{ role: 'agent', content: `Split confirmed with ${issues.length} issue(s). Classifying...` }],
    eventPayload: { split_action: 'confirm', issue_count: issues.length },
  };
}

function handleRejectSplit(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  // Collapse all issues into a single issue
  const combinedSummary = issues.map(i => i.summary).join('; ');
  const combinedExcerpt = issues.map(i => i.raw_excerpt).join(' ');
  const singleIssue: SplitIssue = {
    issue_id: issues[0]?.issue_id ?? ctx.deps.idGenerator(),
    summary: combinedSummary || 'Single issue',
    raw_excerpt: combinedExcerpt || '',
  };

  const updatedSession = setSplitIssues(ctx.session, [singleIssue]);

  return {
    newState: ConversationState.SPLIT_FINALIZED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: 'Treating as a single issue. Classifying...' }],
    eventPayload: { split_action: 'reject', collapsed_to: singleIssue },
  };
}

function handleMergeIssues(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  const input = ctx.request.tenant_input as TenantInputMergeIssues;
  const idsToMerge = input.issue_ids;

  if (!idsToMerge || idsToMerge.length < 2) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: 'Please select at least 2 issues to merge.' }],
      errors: [{ code: 'INVALID_MERGE', message: 'Merge requires at least 2 issue IDs' }],
    };
  }

  // Validate all IDs exist
  const issueMap = new Map(issues.map(i => [i.issue_id, i]));
  for (const id of idsToMerge) {
    if (!issueMap.has(id)) {
      return {
        newState: ctx.session.state,
        session: ctx.session,
        uiMessages: [{ role: 'agent', content: `Issue "${id}" not found.` }],
        errors: [{ code: 'ISSUE_NOT_FOUND', message: `Issue ID not found: ${id}` }],
      };
    }
  }

  const mergeSet = new Set(idsToMerge);
  const toMerge = issues.filter(i => mergeSet.has(i.issue_id));
  const remaining = issues.filter(i => !mergeSet.has(i.issue_id));

  const merged: SplitIssue = {
    issue_id: toMerge[0].issue_id,
    summary: toMerge.map(i => i.summary).join('; '),
    raw_excerpt: toMerge.map(i => i.raw_excerpt).join(' '),
  };

  const newIssues = [...remaining, merged];
  const updatedSession = setSplitIssues(ctx.session, newIssues);

  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: buildIssueListMessage(newIssues) }],
    quickReplies: buildSplitQuickReplies(),
    eventPayload: { split_action: 'merge', merged_ids: idsToMerge },
  };
}

function handleEditIssue(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  const input = ctx.request.tenant_input as TenantInputEditIssue;

  const idx = issues.findIndex(i => i.issue_id === input.issue_id);
  if (idx === -1) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: `Issue "${input.issue_id}" not found.` }],
      errors: [{ code: 'ISSUE_NOT_FOUND', message: `Issue ID not found: ${input.issue_id}` }],
    };
  }

  // Validate raw length before sanitization (spec §13: reject, don't truncate)
  // Skip count check — editing doesn't increase issue count
  const validation = validateIssueConstraints(input.summary, issues.length, { checkCount: false });
  if (!validation.valid) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: validation.error! }],
      errors: [{ code: 'INVALID_ISSUE_TEXT', message: validation.error! }],
    };
  }

  const sanitized = sanitizeIssueText(input.summary);
  if (sanitized.length === 0) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: 'Issue text must not be empty' }],
      errors: [{ code: 'INVALID_ISSUE_TEXT', message: 'Issue text must not be empty' }],
    };
  }

  const newIssues = [...issues];
  newIssues[idx] = { ...issues[idx], summary: sanitized };
  const updatedSession = setSplitIssues(ctx.session, newIssues);

  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: buildIssueListMessage(newIssues) }],
    quickReplies: buildSplitQuickReplies(),
    eventPayload: { split_action: 'edit', issue_id: input.issue_id, new_summary: sanitized },
  };
}

function handleAddIssue(
  ctx: ActionHandlerContext,
  issues: readonly SplitIssue[],
): ActionHandlerResult {
  const input = ctx.request.tenant_input as TenantInputAddIssue;

  // Validate raw length before sanitization (spec §13: reject, don't truncate)
  const validation = validateIssueConstraints(input.summary, issues.length);
  if (!validation.valid) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: validation.error! }],
      errors: [{ code: 'INVALID_ISSUE_TEXT', message: validation.error! }],
    };
  }

  const sanitized = sanitizeIssueText(input.summary);
  if (sanitized.length === 0) {
    return {
      newState: ctx.session.state,
      session: ctx.session,
      uiMessages: [{ role: 'agent', content: 'Issue text must not be empty' }],
      errors: [{ code: 'INVALID_ISSUE_TEXT', message: 'Issue text must not be empty' }],
    };
  }

  const newIssue: SplitIssue = {
    issue_id: ctx.deps.idGenerator(),
    summary: sanitized,
    raw_excerpt: sanitized, // tenant-added issues use summary as excerpt
  };

  const newIssues = [...issues, newIssue];
  const updatedSession = setSplitIssues(ctx.session, newIssues);

  return {
    newState: ConversationState.SPLIT_PROPOSED,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: buildIssueListMessage(newIssues) }],
    quickReplies: buildSplitQuickReplies(),
    eventPayload: { split_action: 'add', new_issue: newIssue },
  };
}

function buildIssueListMessage(issues: readonly SplitIssue[]): string {
  const list = issues.map((issue, i) => `${i + 1}. ${issue.summary}`).join('\n');
  return `Updated issues:\n\n${list}\n\nReview and confirm when ready.`;
}

function buildSplitQuickReplies() {
  return [
    { label: 'Confirm', value: 'confirm', action_type: 'CONFIRM_SPLIT' },
    { label: 'Reject (single issue)', value: 'reject', action_type: 'REJECT_SPLIT' },
  ] as const;
}
