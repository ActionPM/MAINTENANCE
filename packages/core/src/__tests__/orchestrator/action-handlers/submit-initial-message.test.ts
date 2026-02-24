import { describe, it, expect, vi } from 'vitest';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import type { IssueSplitterOutput } from '@wo-agent/schemas';
import { handleSubmitInitialMessage } from '../../../orchestrator/action-handlers/submit-initial-message.js';
import { createSession, updateSessionState, setSessionUnit } from '../../../session/session.js';
import { InMemoryEventStore } from '../../../events/in-memory-event-store.js';
import type { ActionHandlerContext } from '../../../orchestrator/types.js';

const VALID_SPLIT: IssueSplitterOutput = {
  issues: [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
    { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light is broken' },
  ],
  issue_count: 2,
};

function makeContext(
  unitResolved: boolean,
  splitterResult?: IssueSplitterOutput | Error,
): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'gpt-4', prompt_version: '1.0.0' },
  });
  if (unitResolved) {
    session = updateSessionState(session, ConversationState.UNIT_SELECTED);
    session = setSessionUnit(session, 'u1');
  }

  const issueSplitter = splitterResult instanceof Error
    ? vi.fn().mockRejectedValue(splitterResult)
    : vi.fn().mockResolvedValue(splitterResult ?? VALID_SPLIT);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking and kitchen light is broken' },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['u1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: async () => null, getByTenantUser: async () => [], save: async () => {} },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-01-15T12:00:00Z',
      issueSplitter,
    },
  };
}

describe('handleSubmitInitialMessage', () => {
  it('transitions to split_proposed on successful split', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.split_issues).toEqual(VALID_SPLIT.issues);
    expect(result.quickReplies).toBeDefined();
    expect(result.quickReplies!.length).toBeGreaterThan(0);
  });

  it('passes correct input to splitter', async () => {
    const ctx = makeContext(true);
    await handleSubmitInitialMessage(ctx);
    expect(ctx.deps.issueSplitter).toHaveBeenCalledWith({
      raw_text: 'My toilet is leaking and kitchen light is broken',
      conversation_id: 'conv-1',
      taxonomy_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    });
  });

  it('transitions to llm_error_retryable on splitter failure', async () => {
    const ctx = makeContext(true, new Error('LLM timeout'));
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.newState).toBe(ConversationState.LLM_ERROR_RETRYABLE);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('SPLITTER_FAILED');
  });

  it('stores prior state for error recovery', async () => {
    const ctx = makeContext(true, new Error('LLM timeout'));
    const result = await handleSubmitInitialMessage(ctx);
    // The session should have prior_state set for RESUME/RETRY recovery
    expect(result.transitionContext?.prior_state).toBe(ConversationState.UNIT_SELECTED);
  });

  it('rejects when unit is not resolved', async () => {
    const ctx = makeContext(false);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].code).toBe('UNIT_NOT_RESOLVED');
    expect(ctx.deps.issueSplitter).not.toHaveBeenCalled();
  });

  it('includes issues in UI messages', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.uiMessages.length).toBeGreaterThan(0);
    // Should describe the split to the tenant
    const content = result.uiMessages.map(m => m.content).join(' ');
    expect(content).toContain('2'); // issue count
  });

  it('includes event payload with split result', async () => {
    const ctx = makeContext(true);
    const result = await handleSubmitInitialMessage(ctx);
    expect(result.eventPayload).toBeDefined();
    expect(result.eventPayload!.message).toBe('My toilet is leaking and kitchen light is broken');
    expect(result.eventPayload!.split_result).toEqual(VALID_SPLIT);
  });
});
