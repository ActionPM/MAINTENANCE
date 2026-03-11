import { describe, it, expect } from 'vitest';
import type {
  RiskTrigger,
  TriggerGrammar,
  RiskSeverity,
  MitigationTemplate,
  EscalationPlan,
  ContactChainEntry,
  ExhaustionBehavior,
  RiskScanResult,
  EscalationState,
  RiskProtocols,
  EscalationPlans,
} from '@wo-agent/schemas';

describe('Risk types', () => {
  it('RiskTrigger is structurally valid', () => {
    const trigger: RiskTrigger = {
      trigger_id: 'fire-001',
      name: 'Fire',
      grammar: {
        keyword_any: ['fire'],
        regex_any: ['\\bfire\\b'],
        taxonomy_path_any: [],
      },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-fire',
    };
    expect(trigger.trigger_id).toBe('fire-001');
    expect(trigger.severity).toBe('emergency');
  });

  it('EscalationPlan is structurally valid', () => {
    const plan: EscalationPlan = {
      plan_id: 'plan-001',
      building_id: 'bldg-001',
      contact_chain: [{ role: 'building_manager', contact_id: 'c-1', name: 'BM', phone: '+1234' }],
      exhaustion_behavior: {
        internal_alert: true,
        tenant_message_template: 'Unable to reach management.',
        retry_after_minutes: 15,
      },
    };
    expect(plan.contact_chain).toHaveLength(1);
  });

  it('RiskScanResult contains matched triggers', () => {
    const result: RiskScanResult = {
      triggers_matched: [],
      has_emergency: false,
      highest_severity: null,
    };
    expect(result.has_emergency).toBe(false);
  });

  it('EscalationState values are correct', () => {
    const states: EscalationState[] = [
      'none',
      'pending_confirmation',
      'routing',
      'completed',
      'exhausted',
    ];
    expect(states).toHaveLength(5);
  });
});
