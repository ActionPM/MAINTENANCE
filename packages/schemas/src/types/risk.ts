/** Severity levels for risk triggers (spec §17). */
export type RiskSeverity = 'emergency' | 'high' | 'medium';

/** Deterministic trigger grammar (spec §17). */
export interface TriggerGrammar {
  readonly keyword_any: readonly string[];
  readonly regex_any: readonly string[];
  readonly taxonomy_path_any: readonly string[];
}

/** A single risk trigger definition from risk_protocols.json. */
export interface RiskTrigger {
  readonly trigger_id: string;
  readonly name: string;
  readonly grammar: TriggerGrammar;
  readonly requires_confirmation: boolean;
  readonly severity: RiskSeverity;
  readonly mitigation_template_id: string;
}

/** Mitigation template definition from risk_protocols.json. */
export interface MitigationTemplate {
  readonly template_id: string;
  readonly name: string;
  readonly message_template: string;
  readonly safety_instructions: readonly string[];
}

/** Typed container for risk_protocols.json. */
export interface RiskProtocols {
  readonly version: string;
  readonly triggers: readonly RiskTrigger[];
  readonly mitigation_templates: readonly MitigationTemplate[];
}

/** A matched trigger with its match details. */
export interface MatchedTrigger {
  readonly trigger: RiskTrigger;
  readonly matched_keywords: readonly string[];
  readonly matched_regex: readonly string[];
  readonly matched_taxonomy_paths: readonly string[];
}

/** Result of a deterministic risk scan. */
export interface RiskScanResult {
  readonly triggers_matched: readonly MatchedTrigger[];
  readonly has_emergency: boolean;
  readonly highest_severity: RiskSeverity | null;
}

/** Contact in an escalation chain (spec §1.6). */
export interface ContactChainEntry {
  readonly role: string;
  readonly contact_id: string;
  readonly name: string;
  readonly phone: string;
}

/** Exhaustion behavior when all contacts in chain are unreachable (spec §1.6). */
export interface ExhaustionBehavior {
  readonly internal_alert: boolean;
  readonly tenant_message_template: string;
  readonly retry_after_minutes: number;
}

/** Per-building escalation plan from emergency_escalation_plans.json. */
export interface EscalationPlan {
  readonly plan_id: string;
  readonly building_id: string;
  readonly contact_chain: readonly ContactChainEntry[];
  readonly exhaustion_behavior: ExhaustionBehavior;
}

/** Typed container for emergency_escalation_plans.json. */
export interface EscalationPlans {
  readonly version: string;
  readonly plans: readonly EscalationPlan[];
}

/** Escalation state tracked on the session. */
export type EscalationState =
  | 'none'
  | 'pending_confirmation'
  | 'routing'
  | 'completed'
  | 'exhausted';

/** Result of an escalation attempt on one contact. */
export interface EscalationAttempt {
  readonly contact_id: string;
  readonly role: string;
  readonly name: string;
  readonly attempted_at: string;
  readonly answered: boolean;
}

/** Final result of the emergency router. */
export interface EscalationResult {
  readonly plan_id: string;
  readonly state: 'completed' | 'exhausted';
  readonly attempts: readonly EscalationAttempt[];
  readonly answered_by: ContactChainEntry | null;
  readonly exhaustion_message: string | null;
}
