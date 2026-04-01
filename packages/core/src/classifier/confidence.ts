import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { CueFieldResult } from './cue-scoring.js';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface FieldConfidenceComponents {
  readonly cueStrength: number;
  readonly completeness: number;
  readonly modelHint: number;
  readonly modelHintClamped: number;
  readonly constraintImplied: number;
  readonly disagreement: number;
  readonly ambiguityPenalty: number;
}

export interface FieldConfidenceDetail {
  readonly confidence: number;
  readonly components: FieldConfidenceComponents;
}

export interface FieldConfidenceInput {
  readonly cueStrength: number;
  readonly completeness: number;
  readonly modelHint: number;
  readonly constraintImplied: number; // 0 or 1
  readonly disagreement: number; // 0 or 1
  readonly ambiguityPenalty: number; // 0..1
  readonly config: ConfidenceConfig;
}

export interface ComputeAllInput {
  readonly classification: Record<string, string>;
  readonly modelConfidence: Record<string, number>;
  readonly cueResults: Record<string, CueFieldResult>;
  readonly config: ConfidenceConfig;
  readonly impliedFields?: Record<string, string>;
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
  const {
    cueStrength,
    completeness,
    modelHint,
    constraintImplied,
    disagreement,
    ambiguityPenalty,
    config,
  } = input;

  // Clamp model hint (spec 14.3: "Model hint clamped to [0.2, 0.95] and scaled")
  const clampedHint = Math.max(config.model_hint_min, Math.min(config.model_hint_max, modelHint));

  const raw =
    config.weights.cue_strength * cueStrength +
    config.weights.completeness * completeness +
    config.weights.model_hint * clampedHint +
    config.weights.constraint_implied * constraintImplied -
    config.weights.disagreement * disagreement -
    config.weights.ambiguity_penalty * ambiguityPenalty;

  return clamp01(raw);
}

/**
 * Classify a confidence score into high/medium/low bands (spec 14.3).
 */
export function classifyConfidenceBand(
  confidence: number,
  config: ConfidenceConfig,
): ConfidenceBand {
  if (confidence >= config.high_threshold) return 'high';
  if (confidence >= config.medium_threshold) return 'medium';
  return 'low';
}

/**
 * Compute confidence for all classified fields, using cue results and model output.
 * Returns per-field detail including the final score and raw components.
 */
export function computeAllFieldConfidences(
  input: ComputeAllInput,
): Record<string, FieldConfidenceDetail> {
  const { classification, modelConfidence, cueResults, config, impliedFields } = input;
  const result: Record<string, FieldConfidenceDetail> = {};

  for (const field of Object.keys(classification)) {
    const cueResult = cueResults[field];
    const rawModelHint = modelConfidence[field] ?? 0;
    const modelLabel = classification[field];

    // cue_strength: top score from cue dictionary for this field
    const cueStrength = cueResult?.score ?? 0;

    // completeness: 1.0 if model provided a classification, 0 otherwise
    // (enriched in follow-up rounds when answers fill gaps)
    const completeness = modelLabel ? 1.0 : 0;

    // constraint_implied: 1 if hierarchical constraints narrow to exactly one value
    // and the classifier's chosen value matches (C2: separate from cue_strength)
    const constraintImplied = impliedFields?.[field] === modelLabel ? 1 : 0;

    // disagreement: 1 if cue top label differs from model's chosen label
    const disagreement = cueResult?.topLabel != null && cueResult.topLabel !== modelLabel ? 1 : 0;

    // ambiguity_penalty: from cue scoring (how close top-2 labels are)
    const ambiguityPenalty = cueResult?.ambiguity ?? 0;

    const clampedHint = Math.max(
      config.model_hint_min,
      Math.min(config.model_hint_max, rawModelHint),
    );
    const conf = computeFieldConfidence({
      cueStrength,
      completeness,
      modelHint: rawModelHint,
      constraintImplied,
      disagreement,
      ambiguityPenalty,
      config,
    });

    result[field] = {
      confidence: conf,
      components: {
        cueStrength,
        completeness,
        modelHint: rawModelHint,
        modelHintClamped: clampedHint,
        constraintImplied,
        disagreement,
        ambiguityPenalty,
      },
    };
  }

  return result;
}

/**
 * Extract flat confidence scores from a detail map.
 * Convenience helper for callers that need Record<string, number>.
 */
export function extractFlatConfidence(
  details: Record<string, FieldConfidenceDetail>,
): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [field, detail] of Object.entries(details)) {
    flat[field] = detail.confidence;
  }
  return flat;
}

/** Fields to exclude when Category is confidently resolved */
const MAINTENANCE_EXCLUDES = ['Management_Category', 'Management_Object'];
const MANAGEMENT_EXCLUDES = ['Maintenance_Category', 'Maintenance_Object', 'Maintenance_Problem'];

export interface FieldPolicyMetadata {
  readonly requiredFields: readonly string[];
  readonly riskRelevantFields: readonly string[];
}

// Keep this aligned with DEFAULT_COMPLETENESS_POLICY: blank-field recovery relies
// on the combination of both policies to decide which follow-ups are mandatory.
/**
 * Default field policy derived from the taxonomy structure.
 * This is the single source of truth for which fields are required
 * and which are risk-relevant. Callers should use this rather than
 * constructing their own policy — the parameter exists for testability,
 * not for optional behavior.
 */
export const DEFAULT_FIELD_POLICY: FieldPolicyMetadata = {
  requiredFields: ['Category', 'Location', 'Sub_Location', 'Priority'],
  riskRelevantFields: [
    'Priority',
    'Maintenance_Category',
    'Maintenance_Object',
    'Maintenance_Problem',
  ],
} as const;

export interface DetermineFieldsOptions {
  readonly confidenceByField: Record<string, FieldConfidenceDetail>;
  readonly config: ConfidenceConfig;
  readonly missingFields?: readonly string[];
  readonly classificationOutput?: Record<string, string>;
  readonly fieldPolicy?: FieldPolicyMetadata;
  readonly confirmedFields?: ReadonlySet<string>;
}

// Blank/unresolved fallback in determineFieldsNeedingInput depends on this policy
// together with DEFAULT_COMPLETENESS_POLICY. Keep both aligned when required-field
// expectations change.

/**
 * Determine which fields need tenant input based on confidence bands,
 * field policy (required/risk-relevant), and any missing fields.
 *
 * - Low-confidence fields always need input.
 * - Medium-confidence fields need input when required OR risk-relevant (spec §14.3).
 * - High-confidence fields are accepted.
 * - Fields in missingFields are always included regardless of confidence.
 * - Category gating: when Category is confident, cross-category fields are excluded.
 */
export function determineFieldsNeedingInput(opts: DetermineFieldsOptions): string[] {
  const fieldPolicy = opts.fieldPolicy ?? DEFAULT_FIELD_POLICY;
  const config = opts.config;
  const needed = new Set<string>();
  if (opts.classificationOutput) {
    const unconditionalFields = new Set([
      ...fieldPolicy.requiredFields,
      ...fieldPolicy.riskRelevantFields,
    ]);

    for (const field of unconditionalFields) {
      const value = opts.classificationOutput[field];
      if (value == null || value === '' || value === 'needs_object') {
        needed.add(field);
      }
    }
  }

  for (const [field, detail] of Object.entries(opts.confidenceByField)) {
    const band = classifyConfidenceBand(detail.confidence, config);

    if (band === 'low') {
      needed.add(field);
    } else if (band === 'medium') {
      // Resolved medium: accept if field has strong, unambiguous signals (§14.3.1)
      const isResolvedMedium =
        detail.confidence >= config.resolved_medium_threshold &&
        detail.components.disagreement === 0 &&
        detail.components.ambiguityPenalty <= config.resolved_medium_max_ambiguity &&
        !isMissingField(field, opts.missingFields);

      // Priority=emergency is never auto-accepted from resolved medium
      const isEmergencyPriority =
        field === 'Priority' && opts.classificationOutput?.['Priority'] === 'emergency';

      // BUG-011 Fix C: Sub_Location always requires tenant confirmation in medium band,
      // unless the tenant has already confirmed it (via a prior follow-up answer pin).
      const alwaysConfirmFields = new Set(['Sub_Location']);
      const requiresConfirmation =
        alwaysConfirmFields.has(field) && !opts.confirmedFields?.has(field);

      if (isResolvedMedium && !isEmergencyPriority && !requiresConfirmation) {
        // Accepted — do not add to needed
      } else {
        // Original medium-band logic: ask if required OR risk-relevant
        const isRequired = fieldPolicy.requiredFields.includes(field);
        const isRiskRelevant = fieldPolicy.riskRelevantFields.includes(field);
        if (isRequired || isRiskRelevant) {
          needed.add(field);
        }
      }
    }
    // high band: accepted as-is (no change)
  }

  // Merge in any fields the classifier reported as missing (not classified at all).
  if (opts.missingFields) {
    for (const field of opts.missingFields) {
      needed.add(field);
    }
  }

  const fields = [...needed];

  // Category gating (§14.3.2): when Category is confidently resolved, prune cross-domain fields.
  // Uses category_gating_threshold (lower than resolved_medium_threshold) with
  // disagreement and ambiguity guards to prevent over-pruning on mixed-domain texts.
  if (opts.classificationOutput) {
    const categoryDetail = opts.confidenceByField['Category'];
    const category = opts.classificationOutput['Category'];

    const categoryGatable =
      categoryDetail &&
      categoryDetail.confidence >= config.category_gating_threshold &&
      categoryDetail.components.disagreement === 0 &&
      categoryDetail.components.ambiguityPenalty <= config.resolved_medium_max_ambiguity;

    if (categoryGatable && category) {
      const excludes =
        category === 'maintenance'
          ? MAINTENANCE_EXCLUDES
          : category === 'management'
            ? MANAGEMENT_EXCLUDES
            : [];
      const filtered = fields.filter((f) => !excludes.includes(f));

      if (category === 'management') {
        return filtered.filter((f) => f !== 'Location' && f !== 'Sub_Location');
      }

      return filtered;
    }
  }

  return fields;
}

function isMissingField(field: string, missingFields?: readonly string[]): boolean {
  return missingFields?.includes(field) ?? false;
}
