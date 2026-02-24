import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { CueFieldResult } from './cue-scoring.js';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface FieldConfidenceInput {
  readonly cueStrength: number;
  readonly completeness: number;
  readonly modelHint: number;
  readonly disagreement: number;      // 0 or 1
  readonly ambiguityPenalty: number;   // 0..1
  readonly config: ConfidenceConfig;
}

export interface ComputeAllInput {
  readonly classification: Record<string, string>;
  readonly modelConfidence: Record<string, number>;
  readonly cueResults: Record<string, CueFieldResult>;
  readonly config: ConfidenceConfig;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Compute per-field confidence using the spec 14.3 formula.
 * conf = clamp01(0.40*cue_strength + 0.25*completeness + 0.20*model_hint
 *               - 0.10*disagreement - 0.05*ambiguity_penalty)
 * Model hint is clamped to [0.2, 0.95] before use.
 */
export function computeFieldConfidence(input: FieldConfidenceInput): number {
  const { cueStrength, completeness, modelHint, disagreement, ambiguityPenalty, config } = input;

  // Clamp model hint (spec 14.3: "Model hint clamped to [0.2, 0.95] and scaled")
  const clampedHint = Math.max(config.model_hint_min, Math.min(config.model_hint_max, modelHint));

  const raw =
    config.weights.cue_strength * cueStrength +
    config.weights.completeness * completeness +
    config.weights.model_hint * clampedHint -
    config.weights.disagreement * disagreement -
    config.weights.ambiguity_penalty * ambiguityPenalty;

  return clamp01(raw);
}

/**
 * Classify a confidence score into high/medium/low bands (spec 14.3).
 */
export function classifyConfidenceBand(confidence: number, config: ConfidenceConfig): ConfidenceBand {
  if (confidence >= config.high_threshold) return 'high';
  if (confidence >= config.medium_threshold) return 'medium';
  return 'low';
}

/**
 * Compute confidence for all classified fields, using cue results and model output.
 */
export function computeAllFieldConfidences(input: ComputeAllInput): Record<string, number> {
  const { classification, modelConfidence, cueResults, config } = input;
  const result: Record<string, number> = {};

  for (const field of Object.keys(classification)) {
    const cueResult = cueResults[field];
    const rawModelHint = modelConfidence[field] ?? 0;
    const modelLabel = classification[field];

    // cue_strength: top score from cue dictionary for this field
    const cueStrength = cueResult?.score ?? 0;

    // completeness: 1.0 if model provided a classification, 0 otherwise
    // (enriched in follow-up rounds when answers fill gaps)
    const completeness = modelLabel ? 1.0 : 0;

    // disagreement: 1 if cue top label differs from model's chosen label
    const disagreement =
      cueResult?.topLabel != null && cueResult.topLabel !== modelLabel ? 1 : 0;

    // ambiguity_penalty: from cue scoring (how close top-2 labels are)
    const ambiguityPenalty = cueResult?.ambiguity ?? 0;

    result[field] = computeFieldConfidence({
      cueStrength,
      completeness,
      modelHint: rawModelHint,
      disagreement,
      ambiguityPenalty,
      config,
    });
  }

  return result;
}

/**
 * Determine which fields need tenant input based on confidence bands.
 * Low-confidence fields always need input.
 * Medium-confidence fields need input (asked if required/risk-relevant -- MVP asks all).
 * High-confidence fields are accepted.
 */
export function determineFieldsNeedingInput(
  confidences: Record<string, number>,
  config: ConfidenceConfig,
): string[] {
  const fields: string[] = [];

  for (const [field, confidence] of Object.entries(confidences)) {
    const band = classifyConfidenceBand(confidence, config);
    if (band === 'low' || band === 'medium') {
      fields.push(field);
    }
  }

  return fields;
}
