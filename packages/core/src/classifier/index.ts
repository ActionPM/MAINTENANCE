export { computeCueScores, computeCueStrengthForField } from './cue-scoring.js';
export type { CueFieldResult, CueScoreMap } from './cue-scoring.js';

export {
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
} from './confidence.js';
export type {
  ConfidenceBand,
  FieldConfidenceInput,
  ComputeAllInput,
  DetermineFieldsOptions,
  FieldPolicyMetadata,
} from './confidence.js';
export { DEFAULT_FIELD_POLICY } from './confidence.js';

export { callIssueClassifier, ClassifierError, ClassifierErrorCode } from './issue-classifier.js';
export type { ClassifierResult } from './issue-classifier.js';

export { resolveValidOptions, resolveConstraintImpliedFields } from './constraint-resolver.js';

export {
  checkCompleteness,
  DEFAULT_COMPLETENESS_POLICY,
  FollowUpType,
} from './completeness-gate.js';
export type { CompletenessResult, CompletenessPolicy } from './completeness-gate.js';

export type { ClassificationEvent } from './classification-event.js';
