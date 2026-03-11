export {
  scanTextForTriggers,
  scanClassificationForTriggers,
  mergeRiskScanResults,
} from './trigger-scanner.js';

export { resolveMitigationTemplate, renderMitigationMessages } from './mitigation.js';

export {
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
} from './event-builder.js';
export type {
  RiskEvent,
  RiskDetectedInput,
  EscalationAttemptInput,
  EscalationResultInput,
} from './event-builder.js';

export { routeEmergency } from './emergency-router.js';
export type { ContactExecutor, RouteEmergencyInput } from './emergency-router.js';
