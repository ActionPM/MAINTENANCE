import type { EscalationPlans } from './types/risk.js';
import escalationData from '../emergency_escalation_plans.json';

/**
 * Load emergency_escalation_plans.json as a typed EscalationPlans object.
 * Validates that every plan has at least one contact.
 *
 * NOTE: When USE_DEMO_UNIT_RESOLVER=true, the stub UnitResolver in
 * orchestrator-factory.ts returns a building_id controlled by the
 * DEMO_BUILDING_ID env var (default: 'example-building-001'). For emergency
 * escalation to work, this value must match a building_id here.
 */
export function loadEscalationPlans(): EscalationPlans {
  const plans = escalationData as unknown as EscalationPlans;

  for (const plan of plans.plans) {
    if (plan.contact_chain.length === 0) {
      throw new Error(`Escalation plan ${plan.plan_id} has an empty contact chain`);
    }
  }

  return plans;
}
