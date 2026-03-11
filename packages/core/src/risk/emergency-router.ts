import type {
  EscalationPlans,
  ContactChainEntry,
  EscalationAttempt,
  EscalationResult,
} from '@wo-agent/schemas';

/**
 * Contact executor port — dependency-injected function that attempts
 * to reach a contact. Returns true if answered, false if not.
 * In MVP, this is a mock. Production would make actual calls.
 */
export type ContactExecutor = (contact: ContactChainEntry) => Promise<boolean>;

export interface RouteEmergencyInput {
  readonly buildingId: string;
  readonly escalationPlans: EscalationPlans;
  readonly contactExecutor: ContactExecutor;
  readonly clock: () => string;
}

/**
 * Emergency router — call-until-answered through per-building chain (spec §1.6, §17).
 *
 * Deterministic behavior:
 * 1. Look up plan by building_id
 * 2. Iterate contact_chain in order
 * 3. Call contactExecutor for each; stop on first answer
 * 4. If chain exhausted: return exhaustion behavior
 * 5. Log every attempt (caller records events)
 */
export async function routeEmergency(input: RouteEmergencyInput): Promise<EscalationResult> {
  const { buildingId, escalationPlans, contactExecutor, clock } = input;

  const plan = escalationPlans.plans.find((p) => p.building_id === buildingId);
  if (!plan) {
    throw new Error(`No escalation plan found for building: ${buildingId}`);
  }

  const attempts: EscalationAttempt[] = [];

  for (const contact of plan.contact_chain) {
    let answered: boolean;
    try {
      answered = await contactExecutor(contact);
    } catch {
      // Provider/network error — treat as unanswered and continue chain
      answered = false;
    }
    attempts.push({
      contact_id: contact.contact_id,
      role: contact.role,
      name: contact.name,
      attempted_at: clock(),
      answered,
    });

    if (answered) {
      return {
        plan_id: plan.plan_id,
        state: 'completed',
        attempts,
        answered_by: contact,
        exhaustion_message: null,
      };
    }
  }

  // All contacts exhausted
  return {
    plan_id: plan.plan_id,
    state: 'exhausted',
    attempts,
    answered_by: null,
    exhaustion_message: plan.exhaustion_behavior.tenant_message_template,
  };
}
