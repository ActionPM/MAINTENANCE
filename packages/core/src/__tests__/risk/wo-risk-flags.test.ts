import { describe, it, expect } from 'vitest';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import {
  createSession,
  setRiskTriggers,
  setClassificationResults,
  setSplitIssues,
  setSessionScope,
  setSessionUnit,
} from '../../session/session.js';
import type { MatchedTrigger } from '@wo-agent/schemas';

describe('WO creation with risk flags', () => {
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

  function makeSession(withRisk: boolean) {
    let session = setSessionUnit(baseSession, 'unit-1');
    session = setSessionScope(session, { property_id: 'prop-1', client_id: 'client-1' });
    session = setSplitIssues(session, [
      { issue_id: 'iss-1', summary: 'Fire in kitchen', raw_excerpt: 'There is fire' },
    ]);
    session = setClassificationResults(session, [
      {
        issue_id: 'iss-1',
        classifierOutput: {
          issue_id: 'iss-1',
          classification: {},
          model_confidence: {},
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: {},
        fieldsNeedingInput: [],
        shouldAskFollowup: false,
        followupTypes: {},
        constraintPassed: true,
      },
    ]);

    if (withRisk) {
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
      session = setRiskTriggers(session, triggers);
    }

    return session;
  }

  it('populates risk_flags when risk triggers present', () => {
    const session = makeSession(true);
    const wos = createWorkOrders({
      session,
      idGenerator: () => `id-${Math.random()}`,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(wos).toHaveLength(1);
    expect(wos[0].risk_flags).toBeDefined();
    expect(wos[0].risk_flags!.trigger_ids).toContain('fire-001');
    expect(wos[0].risk_flags!.highest_severity).toBe('emergency');
    expect(wos[0].risk_flags!.has_emergency).toBe(true);
  });

  it('omits risk_flags when no risk triggers', () => {
    const session = makeSession(false);
    const wos = createWorkOrders({
      session,
      idGenerator: () => `id-${Math.random()}`,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(wos[0].risk_flags).toBeUndefined();
  });
});
