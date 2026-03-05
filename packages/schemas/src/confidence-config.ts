/**
 * Confidence heuristic configuration (spec §14.3).
 * Formula per field:
 *   conf = clamp01(
 *     weights.cue_strength * cue_strength
 *     + weights.completeness * completeness
 *     + weights.model_hint * model_hint
 *     + weights.constraint_implied * constraint_implied
 *     - weights.disagreement * disagreement
 *     - weights.ambiguity_penalty * ambiguity_penalty
 *   )
 *
 * Note: Positive weights intentionally sum to >1.0 (1.10) so that
 * constraint-implied fields with model agreement can reach high_threshold.
 * The clamp01 ensures the final score stays in [0, 1].
 */
export interface ConfidenceConfig {
  readonly high_threshold: number;
  readonly medium_threshold: number;
  readonly model_hint_min: number;
  readonly model_hint_max: number;
  readonly weights: {
    readonly cue_strength: number;
    readonly completeness: number;
    readonly model_hint: number;
    readonly constraint_implied: number;
    readonly disagreement: number;
    readonly ambiguity_penalty: number;
  };
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  high_threshold: 0.85,
  medium_threshold: 0.65,
  model_hint_min: 0.2,
  model_hint_max: 0.95,
  weights: {
    cue_strength: 0.40,
    completeness: 0.25,
    model_hint: 0.20,
    constraint_implied: 0.25,
    disagreement: 0.10,
    ambiguity_penalty: 0.05,
  },
} as const;

/**
 * Follow-up question caps (spec §15).
 * Enforced in code, not prompts.
 */
export interface FollowUpCaps {
  readonly max_questions_per_turn: number;
  readonly max_turns: number;
  readonly max_total_questions: number;
  readonly max_reasks_per_field: number;
}

export const DEFAULT_FOLLOWUP_CAPS: FollowUpCaps = {
  max_questions_per_turn: 3,
  max_turns: 8,
  max_total_questions: 9,
  max_reasks_per_field: 2,
} as const;
