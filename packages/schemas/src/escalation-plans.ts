import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EscalationPlans } from './types/risk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load emergency_escalation_plans.json as a typed EscalationPlans object.
 * Validates that every plan has at least one contact.
 */
export function loadEscalationPlans(): EscalationPlans {
  const filePath = resolve(__dirname, '..', 'emergency_escalation_plans.json');
  const raw = readFileSync(filePath, 'utf-8');
  const plans = JSON.parse(raw) as EscalationPlans;

  for (const plan of plans.plans) {
    if (plan.contact_chain.length === 0) {
      throw new Error(`Escalation plan ${plan.plan_id} has an empty contact chain`);
    }
  }

  return plans;
}
