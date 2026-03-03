// @wo-agent/core — barrel export
// Phase 2: Auth/Session Scaffolding + Conversation State Machine

// --- State Machine ---
export {
  SystemEvent,
  ALL_SYSTEM_EVENTS,
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
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

// --- Events (Phase 3) ---
export { InMemoryEventStore } from './events/index.js';
export type {
  ConversationEvent,
  EventType,
  EventQuery,
  EventRepository,
} from './events/index.js';

// --- Splitter (Phase 4) ---
export { sanitizeIssueText, validateIssueConstraints, callIssueSplitter, SplitterError, SplitterErrorCode } from './splitter/index.js';
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
} from './classifier/index.js';
export type {
  CueFieldResult,
  CueScoreMap,
  ConfidenceBand,
  FieldConfidenceInput,
  ComputeAllInput,
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
