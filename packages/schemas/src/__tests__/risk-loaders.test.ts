import { describe, it, expect } from 'vitest';
import { loadRiskProtocols, loadEscalationPlans } from '@wo-agent/schemas';

describe('loadRiskProtocols', () => {
  it('loads and returns typed risk protocols from JSON', () => {
    const protocols = loadRiskProtocols();
    expect(protocols.version).toBe('1.1.0');
    expect(protocols.triggers.length).toBeGreaterThan(0);
    expect(protocols.mitigation_templates.length).toBeGreaterThan(0);

    const fire = protocols.triggers.find((t) => t.trigger_id === 'fire-001');
    expect(fire).toBeDefined();
    expect(fire!.severity).toBe('emergency');
    expect(fire!.grammar.keyword_any).toContain('fire');
    expect(fire!.mitigation_template_id).toBe('mit-fire');
  });

  it('every trigger references an existing mitigation template', () => {
    const protocols = loadRiskProtocols();
    const templateIds = new Set(protocols.mitigation_templates.map((t) => t.template_id));
    for (const trigger of protocols.triggers) {
      expect(templateIds.has(trigger.mitigation_template_id)).toBe(true);
    }
  });
});

describe('loadEscalationPlans', () => {
  it('loads and returns typed escalation plans from JSON', () => {
    const plans = loadEscalationPlans();
    expect(plans.version).toBe('1.0.0');
    expect(plans.plans.length).toBeGreaterThan(0);

    const plan = plans.plans[0];
    expect(plan.plan_id).toBeDefined();
    expect(plan.building_id).toBeDefined();
    expect(plan.contact_chain.length).toBeGreaterThan(0);
    expect(plan.exhaustion_behavior.internal_alert).toBe(true);
  });

  it('every plan has at least one contact in the chain', () => {
    const plans = loadEscalationPlans();
    for (const plan of plans.plans) {
      expect(plan.contact_chain.length).toBeGreaterThan(0);
    }
  });
});
