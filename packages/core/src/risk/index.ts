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
  buildEmergencyConfirmationRequestedEvent,
  buildEmergencyConfirmedEvent,
  buildEmergencyDeclinedEvent,
  buildIncidentStartedEvent,
  buildVoiceCallInitiatedEvent,
  buildVoiceCallCompletedEvent,
  buildSmsPromptSentEvent,
  buildSmsReplyReceivedEvent,
  buildStandDownSentEvent,
  buildCycleExhaustedEvent,
  buildInternalAlertSentEvent,
  buildIncidentClosedEvent,
} from './event-builder.js';
export type {
  RiskEvent,
  RiskEventType,
  RiskDetectedInput,
  EscalationAttemptInput,
  EscalationResultInput,
  EmergencyConfirmationRequestedInput,
  EmergencyConfirmedInput,
  EmergencyDeclinedInput,
  IncidentStartedInput,
  VoiceCallInitiatedInput,
  VoiceCallCompletedInput,
  SmsPromptSentInput,
  SmsReplyReceivedInput,
  StandDownSentInput,
  CycleExhaustedInput,
  InternalAlertSentInput,
  IncidentClosedInput,
} from './event-builder.js';

export { routeEmergency } from './emergency-router.js';
export type { ContactExecutor, RouteEmergencyInput } from './emergency-router.js';

export type { EscalationIncidentStore } from './escalation-incident-store.js';
export { InMemoryEscalationIncidentStore } from './in-memory-incident-store.js';

export type { VoiceCallProvider, SmsProvider } from './provider-types.js';
export { MockVoiceProvider, MockSmsProvider } from './mock-providers.js';
export type { RecordedCall, RecordedSms } from './mock-providers.js';

export {
  startIncident,
  processCallOutcome,
  processReplyForIncident,
  processDue,
  incidentRef,
  DEFAULT_COORDINATOR_CONFIG,
} from './escalation-coordinator.js';
export type {
  EscalationCoordinatorConfig,
  EscalationCoordinatorDeps,
  StartIncidentInput,
  CallOutcomeInput,
  ProcessReplyForIncidentInput,
} from './escalation-coordinator.js';
