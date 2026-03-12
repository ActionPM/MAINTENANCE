// @wo-agent/core — barrel export
// Phase 2: Auth/Session Scaffolding + Conversation State Machine

// --- State Machine ---
export {
  SystemEvent,
  ALL_SYSTEM_EVENTS,
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  EMERGENCY_ACTIONS,
  isEmergencyAction,
  isValidTransition,
  getPossibleTargets,
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
} from './state-machine/index.js';
export type { TransitionTrigger, TransitionContext } from './state-machine/index.js';

// --- Auth ---
export {
  toAuthContext,
  createTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  extractAuthFromHeader,
  validateUnitAccess,
} from './auth/index.js';
export type {
  JwtPayload,
  JwtConfig,
  TokenPair,
  TokenVerifyResult,
  AuthErrorCode,
  AuthError,
  AuthExtractionResult,
} from './auth/index.js';

// --- Session ---
export {
  createSession,
  updateSessionState,
  touchActivity,
  setSessionUnit,
  setSplitIssues,
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
  markAbandoned,
  markExpired,
  isExpired,
  filterResumableDrafts,
  setConfirmationTracking,
  markConfirmationPresented,
  setSessionScope,
  setRiskTriggers,
  setEscalationState,
  setBuildingId,
} from './session/index.js';
export type {
  ConversationSession,
  CreateSessionInput,
  ExpirationConfig,
  IssueClassificationResult,
  ConfirmationTrackingInput,
  ScopeInput,
} from './session/index.js';

// --- Unit Resolver (Phase 8) ---
export type { UnitInfo, UnitResolver } from './unit-resolver/index.js';

// --- Idempotency (Phase 8) ---
export { InMemoryIdempotencyStore } from './idempotency/index.js';
export type {
  IdempotencyRecord,
  IdempotencyStore,
  ReservationResult,
} from './idempotency/index.js';

// --- Work Order (Phase 8) ---
export {
  InMemoryWorkOrderStore,
  createWorkOrders,
  buildWorkOrderCreatedEvent,
  buildWorkOrderStatusChangedEvent,
} from './work-order/index.js';
export type {
  WorkOrderEvent,
  WorkOrderRepository,
  WorkOrderListFilters,
  CreateWorkOrdersInput,
  WOCreatedEventInput,
  WOStatusChangedEventInput,
} from './work-order/index.js';

// --- Events (Phase 3) ---
export { InMemoryEventStore } from './events/index.js';
export type { ConversationEvent, EventType, EventQuery, EventRepository } from './events/index.js';

// --- Splitter (Phase 4) ---
export {
  sanitizeIssueText,
  validateIssueConstraints,
  callIssueSplitter,
  SplitterError,
  SplitterErrorCode,
} from './splitter/index.js';
export type { IssueConstraintResult } from './splitter/index.js';

// --- Classifier (Phase 5) ---
export {
  computeCueScores,
  computeCueStrengthForField,
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
  callIssueClassifier,
  ClassifierError,
  ClassifierErrorCode,
  resolveConstraintImpliedFields,
  resolveValidOptions,
} from './classifier/index.js';
export type {
  CueFieldResult,
  CueScoreMap,
  ConfidenceBand,
  FieldConfidenceInput,
  ComputeAllInput,
  DetermineFieldsOptions,
  ClassifierResult,
} from './classifier/index.js';

// --- Follow-up (Phase 6) ---
export {
  checkFollowUpCaps,
  filterEligibleFields,
  truncateQuestions,
  callFollowUpGenerator,
  FollowUpGeneratorError,
  FollowUpGeneratorErrorCode,
  buildFollowUpQuestionsEvent,
  buildFollowUpAnswersEvent,
} from './followup/index.js';
export type {
  CapsCheckInput,
  CapsCheckResult,
  FollowUpGeneratorResult,
  QuestionsEventInput,
  AnswersEventInput,
} from './followup/index.js';

// --- Confirmation (Phase 7) ---
export {
  checkStaleness,
  buildConfirmationPayload,
  computeContentHash,
  buildConfirmationEvent,
  buildStalenessEvent,
} from './confirmation/index.js';
export type {
  StalenessInput,
  StalenessResult,
  StalenessReason,
  ConfirmationPayload,
  ConfirmationIssue,
  ConfirmationEventInput,
  StalenessEventInput,
  ConfirmationEvent,
  StalenessEvent,
} from './confirmation/index.js';

// --- Risk (Phase 9) ---
export {
  scanTextForTriggers,
  scanClassificationForTriggers,
  mergeRiskScanResults,
  resolveMitigationTemplate,
  renderMitigationMessages,
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
  routeEmergency,
  InMemoryEscalationIncidentStore,
  MockVoiceProvider,
  MockSmsProvider,
  startIncident,
  processCallOutcome,
  processReplyForIncident,
  processDue,
  incidentRef,
  DEFAULT_COORDINATOR_CONFIG,
} from './risk/index.js';
export type {
  RiskEvent,
  RiskEventType,
  RiskDetectedInput,
  EscalationAttemptInput,
  EscalationResultInput,
  ContactExecutor,
  RouteEmergencyInput,
  EscalationIncidentStore,
  VoiceCallProvider,
  SmsProvider,
  RecordedCall,
  RecordedSms,
  EscalationCoordinatorConfig,
  EscalationCoordinatorDeps,
  StartIncidentInput,
  CallOutcomeInput,
  ProcessReplyForIncidentInput,
} from './risk/index.js';

// --- Notifications (Phase 10) ---
export {
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
  MockSmsSender,
  NotificationService,
} from './notifications/index.js';
export type {
  NotificationRepository,
  NotificationPreferenceStore,
  SmsSender,
  NotificationListFilters,
  NotificationServiceDeps,
  NotifyWoCreatedInput,
  NotifyResult,
} from './notifications/index.js';

// --- Record Bundle (Phase 11) ---
export { assembleRecordBundle, computeSlaMetadata } from './record-bundle/index.js';
export type {
  RecordBundleDeps,
  SlaPolicies,
  SlaPolicyEntry,
  SlaOverride,
  ComputeSlaInput,
} from './record-bundle/index.js';

// --- ERP Adapter (Phase 12) ---
export type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
  ERPSyncEvent,
} from './erp/index.js';
export { buildERPCreateEvent, buildERPStatusPollEvent, buildERPSyncEvent } from './erp/index.js';
export type {
  ERPCreateEventInput,
  ERPStatusPollEventInput,
  ERPSyncEventInput,
} from './erp/index.js';
export { ERPSyncService } from './erp/index.js';
export type { ERPSyncServiceDeps, SyncResult, SyncError } from './erp/index.js';

// --- Analytics (Phase 13) ---
export { AnalyticsService } from './analytics/index.js';
export type {
  AnalyticsServiceDeps,
  AnalyticsQuery,
  AnalyticsResult,
  OverviewMetrics,
  TaxonomyBreakdown,
  SlaMetrics,
  NotificationMetrics,
} from './analytics/index.js';

// --- LLM Adapters (Phase 16) ---
export {
  createAnthropicClient,
  createLlmDependencies,
  extractJsonFromResponse,
  createSplitterAdapter,
  createClassifierAdapter,
  createFollowUpAdapter,
} from './llm/index.js';
export type {
  LlmClient,
  LlmClientConfig,
  CompletionRequest,
  CreateLlmDepsConfig,
  LlmDependencies,
} from './llm/index.js';

// --- Observability (Spec §25) ---
export {
  StdoutJsonLogger,
  NoopLogger,
  InMemoryLogger,
  NoopMetricsRecorder,
  InMemoryMetricsRecorder,
  NoopAlertSink,
  InMemoryAlertSink,
  MisconfiguredAlertSink,
  SmsAlertSink,
  AlertDeliveryError,
  InMemoryAlertCooldownStore,
  evaluateAlerts,
  DEFAULT_ALERT_EVALUATOR_CONFIG,
} from './observability/index.js';
export type {
  ObservabilityContext,
  LogEntry,
  Logger,
  MetricObservation,
  MetricsRecorder,
  MetricsQueryStore,
  AlertPayload,
  AlertSink,
  AlertCooldownStore,
  SmsAlertSinkConfig,
  AlertEvaluatorConfig,
  AlertEvaluatorDeps,
  AlertEvaluationResult,
} from './observability/index.js';

// --- Orchestrator (Phase 3) ---
export { createDispatcher, buildResponse, getActionHandler } from './orchestrator/index.js';
export type {
  OrchestratorDependencies,
  SessionStore,
  DispatchResult,
  ActionHandlerContext,
  ActionHandlerResult,
  UIMessageInput,
  QuickReplyInput,
  SideEffectInput,
  ErrorInput,
} from './orchestrator/index.js';
