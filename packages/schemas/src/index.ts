// @wo-agent/schemas — barrel export
// Phase 1: Schemas + Validators + Config Objects

// --- Taxonomy ---
export {
  loadTaxonomy,
  isTaxonomyValue,
  taxonomy,
  TAXONOMY_FIELD_NAMES,
  MAINTENANCE_FIELDS,
  MANAGEMENT_FIELDS,
} from './taxonomy.js';
export type { Taxonomy, TaxonomyFieldName } from './taxonomy.js';

// --- Taxonomy Labels ---
export { getTaxonomyLabel, getFieldLabel } from './taxonomy-labels.js';

// --- Taxonomy Constraints ---
export {
  loadTaxonomyConstraints,
  taxonomyConstraints,
  deriveConstraintEdges,
  CONSTRAINT_EDGES,
} from './taxonomy-constraints.js';
export type {
  TaxonomyConstraints,
  ConstraintMapName,
  ConstraintEdge,
} from './taxonomy-constraints.js';

// --- Enums ---
export {
  ConversationState,
  ALL_CONVERSATION_STATES,
  RESUMABLE_STATES,
} from './conversation-states.js';
export { WorkOrderStatus, ALL_WORK_ORDER_STATUSES } from './work-order-status.js';
export { ActionType, ALL_ACTION_TYPES, ActorType, ALL_ACTOR_TYPES } from './action-types.js';

// --- Config ---
export { DEFAULT_RATE_LIMITS } from './rate-limits.js';
export type { RateLimitConfig } from './rate-limits.js';
export { DEFAULT_CONFIDENCE_CONFIG, DEFAULT_FOLLOWUP_CAPS } from './confidence-config.js';
export type { ConfidenceConfig, FollowUpCaps } from './confidence-config.js';
export type { PinnedVersions } from './version-pinning.js';
export {
  resolveCurrentVersions,
  assertPinnedVersionsIntact,
  normalizePinnedVersions,
  compareSemver,
  TAXONOMY_VERSION,
  SCHEMA_VERSION,
  PROMPT_VERSION,
  DEFAULT_MODEL_ID,
  CUE_VERSION,
  DEFAULT_CUE_VERSION,
} from './version-pinning.js';

// --- Types ---
export type {
  AuthContext,
  OrchestratorActionRequest,
  OrchestratorActionResponse,
  TenantInput,
  TenantInputCreateConversation,
  TenantInputSelectUnit,
  TenantInputSubmitInitialMessage,
  TenantInputSubmitAdditionalMessage,
  TenantInputConfirmSplit,
  TenantInputMergeIssues,
  TenantInputEditIssue,
  TenantInputAddIssue,
  TenantInputRejectSplit,
  TenantInputAnswerFollowups,
  TenantInputConfirmSubmission,
  TenantInputUploadPhotoInit,
  TenantInputUploadPhotoComplete,
  TenantInputConfirmEmergency,
  TenantInputDeclineEmergency,
  TenantInputResume,
  TenantInputAbandon,
  UIMessage,
  QuickReply,
  UIDirective,
  ConversationSnapshot,
  Artifact,
  SideEffect,
  ActionError,
} from './types/orchestrator-action.js';

export type { IssueSplitterInput, IssueSplitterOutput, SplitIssue } from './types/issue-split.js';

export type { DisambiguatorInput, DisambiguatorOutput } from './types/disambiguator.js';

export type {
  IssueClassifierInput,
  IssueClassifierOutput,
  FollowupAnswer,
} from './types/classification.js';

export type {
  FollowUpGeneratorInput,
  FollowUpGeneratorOutput,
  FollowUpQuestion,
  FollowUpAnswerType,
  FollowUpEvent,
  AnswerReceived,
  PreviousQuestion,
} from './types/followups.js';

export type {
  WorkOrder,
  StatusHistoryEntry,
  PhotoReference,
  PetsPresent,
} from './types/work-order.js';

export type { Photo, PhotoContentType, ScannedStatus } from './types/photo.js';

export type {
  RecordBundle,
  SlaMetadata,
  CommunicationEntry,
  ResolutionInfo,
} from './types/record-bundle.js';

export { EscalationIncidentStatus, EscalationAttemptOutcome } from './types/risk.js';
export type {
  RiskSeverity,
  TriggerGrammar,
  RiskTrigger,
  MitigationTemplate,
  RiskProtocols,
  MatchedTrigger,
  RiskScanResult,
  ContactChainEntry,
  ExhaustionBehavior,
  EscalationPlan,
  EscalationPlans,
  EscalationState,
  EscalationAttempt,
  EscalationResult,
  EscalationContactAttempt,
  EscalationIncident,
} from './types/risk.js';

export type {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationEvent,
  NotificationPreference,
  SmsConsent,
} from './types/notification.js';

export { loadRiskProtocols } from './risk-protocols.js';
export { loadEscalationPlans } from './escalation-plans.js';

// --- Validator infrastructure ---
export { validate } from './validator.js';
export type { ValidationResult, ValidationError } from './validator.js';

// --- Per-schema validators ---
export {
  validateOrchestratorActionRequest,
  validateOrchestratorActionResponse,
} from './validators/orchestrator-action.js';
export {
  validateIssueSplitterInput,
  validateIssueSplitterOutput,
} from './validators/issue-split.js';
export { validateClassifierInput, validateClassifierOutput } from './validators/classification.js';
export {
  validateFollowUpInput,
  validateFollowUpOutput,
  validateFollowUpEvent,
} from './validators/followups.js';
export { validateWorkOrder } from './validators/work-order.js';
export { validateRecordBundle } from './validators/record-bundle.js';
export { validateDisambiguatorOutput } from './validators/disambiguator.js';
export { validatePhoto } from './validators/photo.js';

// --- Domain validators ---
export {
  validateClassificationAgainstTaxonomy,
  validateHierarchicalConstraints,
  semverLt,
} from './validators/taxonomy-cross-validator.js';
export type {
  DomainValidationResult,
  HierarchicalValidationResult,
} from './validators/taxonomy-cross-validator.js';
export { validateCueDictionary } from './validators/cue-dictionary-validator.js';
export type { CueDictionary } from './validators/cue-dictionary-validator.js';
export {
  validateOrchestratorActionDomain,
  SIDE_EFFECT_ACTIONS,
} from './validators/orchestrator-action-domain.js';
export type { ActionDomainValidationResult } from './validators/orchestrator-action-domain.js';
export { validateIssueSplitDomain } from './validators/issue-split-domain.js';
export type { IssueSplitDomainValidationResult } from './validators/issue-split-domain.js';

// --- Eval validators ---
export {
  validateEvalExample,
  validateEvalManifest,
  validateEvalRun,
  validateEvalReport,
} from './validators/eval-validators.js';
export type { EvalValidationResult } from './validators/eval-validators.js';
