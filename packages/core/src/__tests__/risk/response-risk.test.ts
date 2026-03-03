import { describe, it, expect } from 'vitest';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { ConversationState } from '@wo-agent/schemas';
import { createSession, setRiskTriggers, setEscalationState } from '../../session/session.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';
import type { MatchedTrigger } from '@wo-agent/schemas';

describe('response builder risk data', () => {
  const baseSession = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  });

  it('includes risk_summary in snapshot when triggers present', () => {
    const triggers: MatchedTrigger[] = [{
      trigger: {
        trigger_id: 'fire-001', name: 'Fire',
        grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
        requires_confirmation: true, severity: 'emergency', mitigation_template_id: 'mit-fire',
      },
      matched_keywords: ['fire'],
      matched_regex: [],
      matched_taxonomy_paths: [],
    }];
    let session = setRiskTriggers(baseSession, triggers);
    session = setEscalationState(session, 'pending_confirmation');

    const result: ActionHandlerResult = {
      newState: ConversationState.SPLIT_PROPOSED,
      session,
      uiMessages: [{ role: 'agent', content: 'test' }],
    };

    const response = buildResponse(result);
    expect(response.conversation_snapshot.risk_summary).toBeDefined();
    expect(response.conversation_snapshot.risk_summary!.has_emergency).toBe(true);
    expect(response.conversation_snapshot.risk_summary!.trigger_ids).toContain('fire-001');
    expect(response.conversation_snapshot.risk_summary!.escalation_state).toBe('pending_confirmation');
  });

  it('omits risk_summary when no triggers', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.SPLIT_PROPOSED,
      session: baseSession,
      uiMessages: [{ role: 'agent', content: 'test' }],
    };

    const response = buildResponse(result);
    expect(response.conversation_snapshot.risk_summary).toBeUndefined();
  });
});
