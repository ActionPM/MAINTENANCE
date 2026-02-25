import type { FollowUpCaps, FollowUpQuestion, PreviousQuestion } from '@wo-agent/schemas';

export interface CapsCheckInput {
  readonly turnNumber: number;
  readonly totalQuestionsAsked: number;
  readonly previousQuestions: readonly PreviousQuestion[];
  readonly fieldsNeedingInput: readonly string[];
  readonly caps: FollowUpCaps;
}

export interface CapsCheckResult {
  /** Whether we can generate more follow-up questions */
  readonly canContinue: boolean;
  /** Whether the escape hatch should trigger (caps exhausted, fields still incomplete) */
  readonly escapeHatch: boolean;
  /** Fields that are eligible for follow-up (not maxed on re-asks) */
  readonly eligibleFields: readonly string[];
  /** Max questions we can ask this turn */
  readonly remainingQuestionBudget: number;
  /** Human-readable reason if canContinue is false */
  readonly reason?: string;
}

/**
 * Check follow-up termination caps (spec §15).
 * Called BEFORE invoking FollowUpGenerator to determine if we should continue
 * or trigger the escape hatch.
 */
export function checkFollowUpCaps(input: CapsCheckInput): CapsCheckResult {
  const { turnNumber, totalQuestionsAsked, previousQuestions, fieldsNeedingInput, caps } = input;

  // Cap 1: max turns
  if (turnNumber > caps.max_turns) {
    return {
      canContinue: false,
      escapeHatch: true,
      eligibleFields: [],
      remainingQuestionBudget: 0,
      reason: `max_turns exceeded (${turnNumber} > ${caps.max_turns})`,
    };
  }

  // Cap 2: max total questions
  if (totalQuestionsAsked >= caps.max_total_questions) {
    return {
      canContinue: false,
      escapeHatch: true,
      eligibleFields: [],
      remainingQuestionBudget: 0,
      reason: `max_total_questions reached (${totalQuestionsAsked} >= ${caps.max_total_questions})`,
    };
  }

  // Cap 4: filter out fields at max re-ask limit
  const eligibleFields = filterEligibleFields(fieldsNeedingInput, previousQuestions, caps);

  if (eligibleFields.length === 0) {
    return {
      canContinue: false,
      escapeHatch: true,
      eligibleFields: [],
      remainingQuestionBudget: 0,
      reason: 'no eligible fields remain (all at max re-ask limit)',
    };
  }

  // Cap 3: remaining question budget = min(per-turn cap, total remaining)
  const totalRemaining = caps.max_total_questions - totalQuestionsAsked;
  const remainingQuestionBudget = Math.min(caps.max_questions_per_turn, totalRemaining);

  return {
    canContinue: true,
    escapeHatch: false,
    eligibleFields,
    remainingQuestionBudget,
  };
}

/**
 * Filter fields to only those eligible for follow-up (not at max re-ask limit).
 * Spec §15: "max 2 re-asks per field"
 */
export function filterEligibleFields(
  fieldsNeedingInput: readonly string[],
  previousQuestions: readonly PreviousQuestion[],
  caps: FollowUpCaps,
): string[] {
  const askCounts = new Map<string, number>();
  for (const pq of previousQuestions) {
    askCounts.set(pq.field_target, pq.times_asked);
  }

  return fieldsNeedingInput.filter(
    (field) => (askCounts.get(field) ?? 0) < caps.max_reasks_per_field,
  );
}

/**
 * Truncate follow-up questions to the remaining budget (spec §15).
 * Called AFTER receiving FollowUpGenerator output to enforce per-turn cap.
 */
export function truncateQuestions(
  questions: readonly FollowUpQuestion[],
  budget: number,
): readonly FollowUpQuestion[] {
  return questions.slice(0, budget);
}
