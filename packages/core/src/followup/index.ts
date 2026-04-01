export { checkFollowUpCaps, filterEligibleFields, truncateQuestions } from './caps.js';
export type { CapsCheckInput, CapsCheckResult } from './caps.js';

export {
  callFollowUpGenerator,
  FollowUpGeneratorError,
  FollowUpGeneratorErrorCode,
} from './followup-generator.js';
export type { FollowUpGeneratorResult } from './followup-generator.js';
export { selectFollowUpFrontierFields } from './field-ordering.js';

export { buildFollowUpQuestionsEvent, buildFollowUpAnswersEvent } from './event-builder.js';
export type { QuestionsEventInput, AnswersEventInput } from './event-builder.js';
export { buildHierarchyConflictQuestion } from './hierarchy-conflict-questions.js';
