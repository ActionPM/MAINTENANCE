export {
  computeCueScores,
  computeCueStrengthForField,
  buildEnrichedCueText,
} from './cue-scoring.js';
export type { CueFieldResult, CueScoreMap } from './cue-scoring.js';

export {
  computeFieldConfidence,
  computeAllFieldConfidences,
  extractFlatConfidence,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
} from './confidence.js';
export type {
  ConfidenceBand,
  FieldConfidenceInput,
  FieldConfidenceComponents,
  FieldConfidenceDetail,
  ComputeAllInput,
  DetermineFieldsOptions,
  FieldPolicyMetadata,
} from './confidence.js';
export { DEFAULT_FIELD_POLICY } from './confidence.js';

export { callIssueClassifier, ClassifierError, ClassifierErrorCode } from './issue-classifier.js';
export type { ClassifierResult } from './issue-classifier.js';
export {
  ClassifierTriageReason,
  RoutingReason,
  computeRecoverableViaFollowup,
  normalizeCrossDomainClassification,
} from './triage-routing.js';

export {
  resolveValidOptions,
  resolveConstraintImpliedFields,
  isConstraintResolvedValue,
} from './constraint-resolver.js';

export {
  checkCompleteness,
  DEFAULT_COMPLETENESS_POLICY,
  FollowUpType,
} from './completeness-gate.js';
export type { CompletenessResult, CompletenessPolicy } from './completeness-gate.js';

export type { ClassificationEvent } from './classification-event.js';

export {
  invalidateStaleDescendants,
  getForwardDescendants,
  type InvalidationResult,
  type ClearedField,
} from './descendant-invalidation.js';
