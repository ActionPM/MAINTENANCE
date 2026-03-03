import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { SplitIssue, CueDictionary } from '@wo-agent/schemas';
import { handleSplitAction } from '../../../orchestrator/action-handlers/split-actions.js';
import { createSession, updateSessionState, setSplitIssues } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../../idempotency/in-memory-idempotency-store.js';
import type { UnitResolver } from '../../../unit-resolver/types.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

const taxonomy = loadTaxonomy();
const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

const ISSUES: SplitIssue[] = [
  { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
  { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light is broken' },
  { issue_id: 'i3', summary: 'Door squeaky', raw_excerpt: 'front door squeaks' },
];

function makeContext(
  actionType: string,
  tenantInput: Record<string, unknown> = {},
  issues: SplitIssue[] = ISSUES,
): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  session = updateSessionState(session, ConversationState.SPLIT_PROPOSED);
  session = setSplitIssues(session, issues);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: actionType as any,
      actor: ActorType.TENANT,
      tenant_input: tenantInput as any,
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({
        issue_id: 'issue-1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: MINI_CUES,
      taxonomy,
      unitResolver: { resolve: async () => null } satisfies UnitResolver,
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: async () => false,
    },
  };
}

describe('CONFIRM_SPLIT', () => {
  it('transitions to split_finalized with existing issues', async () => {
    const ctx = makeContext(ActionType.CONFIRM_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.session.split_issues).toEqual(ISSUES);
  });

  it('rejects when no issues are stored', async () => {
    const ctx = makeContext(ActionType.CONFIRM_SPLIT, {}, []);
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('NO_ISSUES');
  });
});

describe('REJECT_SPLIT', () => {
  it('collapses to single issue and transitions to split_finalized', async () => {
    const ctx = makeContext(ActionType.REJECT_SPLIT);
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_FINALIZED);
    expect(result.session.split_issues!.length).toBe(1);
    // Combined summary should include content from all original issues
    expect(result.session.split_issues![0].summary).toContain('Toilet leaking');
  });
});

describe('MERGE_ISSUES', () => {
  it('merges specified issues into one', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1', 'i2'] });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.split_issues!.length).toBe(2); // 3 - 2 merged + 1 new = 2
    const mergedIssue = result.session.split_issues!.find(i =>
      i.summary.includes('Toilet leaking') && i.summary.includes('Light broken')
    );
    expect(mergedIssue).toBeDefined();
  });

  it('rejects merge with fewer than 2 issue_ids', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1'] });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_MERGE');
  });

  it('rejects merge with unknown issue_id', async () => {
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['i1', 'unknown'] });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('ISSUE_NOT_FOUND');
  });

  it('rejects merge when combined summary exceeds 500 chars', async () => {
    const longIssues = [
      { issue_id: 'a', summary: 'x'.repeat(300), raw_excerpt: 'a' },
      { issue_id: 'b', summary: 'y'.repeat(300), raw_excerpt: 'b' },
    ];
    const ctx = makeContext(ActionType.MERGE_ISSUES, { issue_ids: ['a', 'b'] }, longIssues);
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('MERGED_SUMMARY_TOO_LONG');
    // Session should be unchanged
    expect(result.session.split_issues!.length).toBe(2);
  });
});

describe('EDIT_ISSUE', () => {
  it('updates issue summary', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'Bathroom faucet dripping' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    const edited = result.session.split_issues!.find(i => i.issue_id === 'i1');
    expect(edited!.summary).toBe('Bathroom faucet dripping');
  });

  it('sanitizes edited text', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'Has <script>  extra   spaces' });
    const result = await handleSplitAction(ctx);
    const edited = result.session.split_issues!.find(i => i.issue_id === 'i1');
    expect(edited!.summary).toBe('Has &lt;script&gt; extra spaces');
  });

  it('rejects empty summary after sanitization', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: '   ' });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_ISSUE_TEXT');
  });

  it('rejects edit of unknown issue_id', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'unknown', summary: 'Test' });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('ISSUE_NOT_FOUND');
  });

  it('rejects summary exceeding 500 chars', async () => {
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i1', summary: 'a'.repeat(501) });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_ISSUE_TEXT');
  });

  it('allows editing when at 10 issues (count cap does not apply to edits)', async () => {
    const tenIssues = Array.from({ length: 10 }, (_, i) => ({
      issue_id: `i${i}`, summary: `Issue ${i}`, raw_excerpt: `excerpt ${i}`,
    }));
    const ctx = makeContext(ActionType.EDIT_ISSUE, { issue_id: 'i0', summary: 'Updated issue' }, tenIssues);
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeUndefined();
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    const edited = result.session.split_issues!.find(i => i.issue_id === 'i0');
    expect(edited!.summary).toBe('Updated issue');
  });
});

describe('ADD_ISSUE', () => {
  it('adds a new issue', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: 'Window cracked' });
    const result = await handleSplitAction(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.split_issues!.length).toBe(4);
    const added = result.session.split_issues!.find(i => i.summary === 'Window cracked');
    expect(added).toBeDefined();
    expect(added!.issue_id).toBeDefined();
  });

  it('sanitizes added text', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: '<b>Bold</b>  issue' });
    const result = await handleSplitAction(ctx);
    const added = result.session.split_issues![result.session.split_issues!.length - 1];
    expect(added.summary).toBe('&lt;b&gt;Bold&lt;/b&gt; issue');
  });

  it('rejects when at 10 issues', async () => {
    const tenIssues = Array.from({ length: 10 }, (_, i) => ({
      issue_id: `i${i}`, summary: `Issue ${i}`, raw_excerpt: `excerpt ${i}`,
    }));
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: 'One too many' }, tenIssues);
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('INVALID_ISSUE_TEXT');
  });

  it('rejects empty summary', async () => {
    const ctx = makeContext(ActionType.ADD_ISSUE, { summary: '' });
    const result = await handleSplitAction(ctx);
    expect(result.errors).toBeDefined();
  });
});
