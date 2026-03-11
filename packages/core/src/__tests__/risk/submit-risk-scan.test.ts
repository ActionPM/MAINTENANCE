import { describe, it, expect, vi } from 'vitest';
import { handleSubmitInitialMessage } from '../../orchestrator/action-handlers/submit-initial-message.js';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import { createSession, updateSessionState, setSessionUnit } from '../../session/session.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import type { ActionHandlerContext } from '../../orchestrator/types.js';

function buildCtx(message: string, overrides?: Record<string, unknown>): ActionHandlerContext {
  let counter = 0;
  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'm',
      prompt_version: '1',
    },
  });
  session = updateSessionState(session, ConversationState.UNIT_SELECTED);
  session = setSessionUnit(session, 'unit-1');

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['unit-1'],
      },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T00:00:00Z',
      issueSplitter: vi.fn().mockResolvedValue({
        issue_count: 1,
        issues: [
          {
            issue_id: 'iss-1',
            summary: 'Fire in kitchen',
            raw_excerpt: 'There is fire in my kitchen',
          },
        ],
      }),
      issueClassifier: vi.fn(),
      followUpGenerator: vi.fn(),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', fields: {} },
      unitResolver: { resolve: vi.fn() },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: {
        version: '1.0.0',
        triggers: [
          {
            trigger_id: 'fire-001',
            name: 'Fire',
            grammar: { keyword_any: ['fire'], regex_any: [], taxonomy_path_any: [] },
            requires_confirmation: true,
            severity: 'emergency',
            mitigation_template_id: 'mit-fire',
          },
        ],
        mitigation_templates: [
          {
            template_id: 'mit-fire',
            name: 'Fire Safety',
            message_template: 'If active fire, call 911.',
            safety_instructions: ['Call 911', 'Evacuate'],
          },
        ],
      },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: vi.fn(),
      ...overrides,
    } as any,
  };
}

describe('submit-initial-message risk scanning', () => {
  it('includes mitigation message when emergency keyword detected', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    const result = await handleSubmitInitialMessage(ctx);

    // Normal split flow still works
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);

    // Mitigation message included
    const allContent = result.uiMessages.map((m) => m.content).join(' ');
    expect(allContent).toContain('Fire Safety');
    expect(allContent).toContain('911');
  });

  it('stores risk triggers on session', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    const result = await handleSubmitInitialMessage(ctx);

    expect(result.session.risk_triggers).toHaveLength(1);
    expect(result.session.risk_triggers[0].trigger.trigger_id).toBe('fire-001');
  });

  it('records risk_detected event', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    await handleSubmitInitialMessage(ctx);

    const events = await ctx.deps.eventRepo.query({ conversation_id: 'conv-1' });
    const riskEvents = events.filter((e: any) => e.event_type === 'risk_detected');
    expect(riskEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT show mitigation for benign messages', async () => {
    const ctx = buildCtx('My faucet is dripping');
    const result = await handleSubmitInitialMessage(ctx);

    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.risk_triggers).toHaveLength(0);

    const allContent = result.uiMessages.map((m) => m.content).join(' ');
    expect(allContent).not.toContain('Fire Safety');
  });

  it('includes emergency confirmation quick replies when requires_confirmation', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    const result = await handleSubmitInitialMessage(ctx);

    // Should have confirmation quick replies alongside normal ones
    const qrLabels = result.quickReplies?.map((qr) => qr.label) ?? [];
    expect(qrLabels.some((l) => l.toLowerCase().includes('emergency'))).toBe(true);
  });

  it('preserves risk mitigation and session triggers when splitter fails', async () => {
    const ctx = buildCtx('There is fire in my kitchen', {
      issueSplitter: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    });
    const result = await handleSubmitInitialMessage(ctx);

    // Splitter failed → llm_error_retryable
    expect(result.newState).toBe(ConversationState.LLM_ERROR_RETRYABLE);

    // Risk data still present despite splitter failure
    expect(result.session.risk_triggers).toHaveLength(1);
    expect(result.session.risk_triggers[0].trigger.trigger_id).toBe('fire-001');

    // Mitigation messages still in UI output
    const allContent = result.uiMessages.map((m) => m.content).join(' ');
    expect(allContent).toContain('Fire Safety');
    expect(allContent).toContain('911');

    // Risk event payload still included
    expect(result.eventPayload?.risk_detected).toBe(true);
  });
});
