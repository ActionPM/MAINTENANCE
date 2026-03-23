import { describe, it, expect } from 'vitest';
import { createSession, setRiskTriggers, setEscalationState } from '../../session/session.js';
import type { MatchedTrigger } from '@wo-agent/schemas';

describe('session risk tracking', () => {
  const baseSession = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'm',
      prompt_version: '1',
      cue_version: '1.2.0',
    },
  });

  it('initializes with no risk triggers and escalation_state=none', () => {
    expect(baseSession.risk_triggers).toHaveLength(0);
    expect(baseSession.escalation_state).toBe('none');
    expect(baseSession.escalation_plan_id).toBeNull();
  });

  it('setRiskTriggers stores matched triggers on session', () => {
    const triggers: MatchedTrigger[] = [
      {
        trigger: {
          trigger_id: 'fire-001',
          name: 'Fire',
          grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
          requires_confirmation: true,
          severity: 'emergency',
          mitigation_template_id: 'mit-fire',
        },
        matched_keywords: ['fire'],
        matched_regex: [],
        matched_taxonomy_paths: [],
      },
    ];

    const updated = setRiskTriggers(baseSession, triggers);
    expect(updated.risk_triggers).toHaveLength(1);
    expect(updated.risk_triggers[0].trigger.trigger_id).toBe('fire-001');
  });

  it('setEscalationState updates escalation state and plan', () => {
    const updated = setEscalationState(baseSession, 'routing', 'plan-001');
    expect(updated.escalation_state).toBe('routing');
    expect(updated.escalation_plan_id).toBe('plan-001');
  });
});
