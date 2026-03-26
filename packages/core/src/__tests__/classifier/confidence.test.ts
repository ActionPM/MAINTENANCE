import { describe, it, expect } from 'vitest';
import {
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
  DEFAULT_FIELD_POLICY,
} from '../../classifier/confidence.js';
import type { FieldConfidenceDetail } from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { CueFieldResult } from '../../classifier/cue-scoring.js';

/** Test helper: wrap a plain confidence number into a FieldConfidenceDetail with zeroed components. */
function simpleDetail(confidence: number): FieldConfidenceDetail {
  return {
    confidence,
    components: {
      cueStrength: 0,
      completeness: 1,
      modelHint: 0.5,
      modelHintClamped: 0.5,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
    },
  };
}

describe('computeFieldConfidence', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('computes confidence using the formula from spec 14.3', () => {
    const result = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    // 0.40*0.8 + 0.25*1.0 + 0.20*0.9 - 0.10*0 - 0.05*0
    // = 0.32 + 0.25 + 0.18 = 0.75
    expect(result).toBeCloseTo(0.75);
  });

  it('clamps model hint to [0.2, 0.95]', () => {
    // Model hint 1.0 should be clamped to 0.95
    const highHint = computeFieldConfidence({
      cueStrength: 0.5,
      completeness: 0.5,
      modelHint: 1.0,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    // 0.40*0.5 + 0.25*0.5 + 0.20*0.95 = 0.20 + 0.125 + 0.19 = 0.515
    expect(highHint).toBeCloseTo(0.515);

    // Model hint 0.0 should be clamped to 0.2
    const lowHint = computeFieldConfidence({
      cueStrength: 0.5,
      completeness: 0.5,
      modelHint: 0.0,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    // 0.40*0.5 + 0.25*0.5 + 0.20*0.2 = 0.20 + 0.125 + 0.04 = 0.365
    expect(lowHint).toBeCloseTo(0.365);
  });

  it('subtracts disagreement penalty', () => {
    const noDisagree = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    const withDisagree = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      constraintImplied: 0,
      disagreement: 1,
      ambiguityPenalty: 0,
      config,
    });
    expect(withDisagree).toBeCloseTo(noDisagree - 0.1);
  });

  it('subtracts ambiguity penalty', () => {
    const noAmbiguity = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    const withAmbiguity = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0.8,
      config,
    });
    expect(withAmbiguity).toBeCloseTo(noAmbiguity - 0.05 * 0.8);
  });

  it('clamps result to [0, 1]', () => {
    const tooLow = computeFieldConfidence({
      cueStrength: 0,
      completeness: 0,
      modelHint: 0,
      constraintImplied: 0,
      disagreement: 1,
      ambiguityPenalty: 1,
      config,
    });
    expect(tooLow).toBeGreaterThanOrEqual(0);

    const tooHigh = computeFieldConfidence({
      cueStrength: 1,
      completeness: 1,
      modelHint: 1,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    expect(tooHigh).toBeLessThanOrEqual(1);
  });
});

describe('classifyConfidenceBand', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('returns high for >= 0.85', () => {
    expect(classifyConfidenceBand(0.85, config)).toBe('high');
    expect(classifyConfidenceBand(0.95, config)).toBe('high');
  });

  it('returns medium for 0.65-0.84', () => {
    expect(classifyConfidenceBand(0.65, config)).toBe('medium');
    expect(classifyConfidenceBand(0.84, config)).toBe('medium');
  });

  it('returns low for < 0.65', () => {
    expect(classifyConfidenceBand(0.64, config)).toBe('low');
    expect(classifyConfidenceBand(0.0, config)).toBe('low');
  });
});

describe('determineFieldsNeedingInput', () => {
  it('includes low-confidence fields', () => {
    const confidences = { Category: simpleDetail(0.9), Maintenance_Category: simpleDetail(0.5) };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    expect(result).toContain('Maintenance_Category');
    expect(result).not.toContain('Category');
  });

  it('returns empty array when all fields are high confidence', () => {
    const confidences = { Category: simpleDetail(0.9), Maintenance_Category: simpleDetail(0.88) };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    expect(result).toEqual([]);
  });

  it('accepts medium-confidence fields that are NOT required and NOT risk-relevant', () => {
    // Management_Object is not in requiredFields or riskRelevantFields
    const confidences = { Category: simpleDetail(0.9), Management_Object: simpleDetail(0.7) };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    expect(result).not.toContain('Management_Object');
  });

  it('returns medium-confidence required fields as needing input', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: simpleDetail(0.72), // medium — required field
        Location: simpleDetail(0.9), // high
        Maintenance_Category: simpleDetail(0.7), // medium — risk-relevant field
      },
      missingFields: [],
      classificationOutput: {
        Category: 'maintenance',
        Location: 'suite',
        Maintenance_Category: 'plumbing',
      },
      fieldPolicy: {
        requiredFields: ['Category', 'Location', 'Maintenance_Category'],
        riskRelevantFields: [],
      },
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    expect(result).toContain('Category');
    expect(result).toContain('Maintenance_Category');
    expect(result).not.toContain('Location');
  });

  it('returns medium-confidence risk-relevant fields as needing input', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: simpleDetail(0.9),
        Priority: simpleDetail(0.72), // medium — risk-relevant
        Location: simpleDetail(0.88),
      },
      missingFields: [],
      classificationOutput: {
        Category: 'maintenance',
        Priority: 'emergency',
        Location: 'suite',
      },
      fieldPolicy: { requiredFields: ['Category'], riskRelevantFields: ['Priority'] },
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    expect(result).toContain('Priority');
    expect(result).not.toContain('Category');
    expect(result).not.toContain('Location');
  });

  it('includes missing_fields regardless of confidence scores', () => {
    const confidences = { Category: simpleDetail(0.9) };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
      missingFields: ['Location', 'Sub_Location'],
    });
    expect(result).toContain('Location');
    expect(result).toContain('Sub_Location');
    expect(result).not.toContain('Category');
  });

  it('deduplicates fields present in both low confidence and missing_fields', () => {
    const confidences = { Priority: simpleDetail(0.3) }; // low
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
      missingFields: ['Priority'],
    });
    expect(result).toEqual(['Priority']);
  });
});

describe('category gating', () => {
  it('excludes Management fields when Category=maintenance and Category is confident', () => {
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.9),
      Location: simpleDetail(0.9),
      Sub_Location: simpleDetail(0.3),
      Maintenance_Category: simpleDetail(0.9),
      Maintenance_Object: simpleDetail(0.3),
      Maintenance_Problem: simpleDetail(0.9),
      Management_Category: simpleDetail(0.25),
      Management_Object: simpleDetail(0.25),
      Priority: simpleDetail(0.3),
    };
    const classification = {
      Category: 'maintenance',
      Management_Category: 'other_mgmt_cat',
      Management_Object: 'other_mgmt_obj',
    };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
      missingFields: [],
      classificationOutput: classification,
    });
    expect(result).not.toContain('Management_Category');
    expect(result).not.toContain('Management_Object');
    expect(result).toContain('Sub_Location');
    expect(result).toContain('Maintenance_Object');
    expect(result).toContain('Priority');
  });

  it('excludes Maintenance fields when Category=management and Category is confident', () => {
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.9),
      Location: simpleDetail(0.9),
      Sub_Location: simpleDetail(0.3),
      Maintenance_Category: simpleDetail(0.25),
      Maintenance_Object: simpleDetail(0.25),
      Maintenance_Problem: simpleDetail(0.25),
      Management_Category: simpleDetail(0.9),
      Management_Object: simpleDetail(0.3),
      Priority: simpleDetail(0.3),
    };
    const classification = {
      Category: 'management',
      Maintenance_Category: 'other_maintenance_category',
      Maintenance_Object: 'other_maintenance_object',
      Maintenance_Problem: 'other_problem',
    };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
      missingFields: [],
      classificationOutput: classification,
    });
    expect(result).not.toContain('Maintenance_Category');
    expect(result).not.toContain('Maintenance_Object');
    expect(result).not.toContain('Maintenance_Problem');
    // Management issues: Location and Sub_Location are not required
    expect(result).not.toContain('Location');
    expect(result).not.toContain('Sub_Location');
    expect(result).toContain('Management_Object');
    expect(result).toContain('Priority');
  });

  it('does NOT gate when Category itself is low confidence', () => {
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.3),
      Management_Category: simpleDetail(0.25),
      Management_Object: simpleDetail(0.25),
    };
    const classification = { Category: 'maintenance' };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
      missingFields: [],
      classificationOutput: classification,
    });
    expect(result).toContain('Category');
    expect(result).toContain('Management_Category');
    expect(result).toContain('Management_Object');
  });

  it('does NOT gate when classification is not provided (backward compat)', () => {
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.7),
      Management_Category: simpleDetail(0.25),
    };
    const result = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    expect(result).toContain('Management_Category');
  });
});

describe('computeAllFieldConfidences', () => {
  it('computes confidence for all classified fields', () => {
    const classification = { Category: 'maintenance', Maintenance_Category: 'plumbing' };
    const modelConfidence = { Category: 0.95, Maintenance_Category: 0.8 };
    const cueResults: Record<string, CueFieldResult> = {
      Maintenance_Category: {
        score: 0.6,
        topLabel: 'plumbing',
        ambiguity: 0.2,
        labelScores: [{ label: 'plumbing', score: 0.6 }],
      },
    };

    const result = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    expect(result.Category.confidence).toBeGreaterThan(0);
    expect(result.Maintenance_Category.confidence).toBeGreaterThan(0);
    // Components should be populated
    expect(result.Maintenance_Category.components.cueStrength).toBe(0.6);
    expect(result.Maintenance_Category.components.disagreement).toBe(0);
  });

  it('sets disagreement=1 when cue top label differs from model label', () => {
    const classification = { Maintenance_Category: 'electrical' };
    const modelConfidence = { Maintenance_Category: 0.8 };
    const cueResults: Record<string, CueFieldResult> = {
      Maintenance_Category: {
        score: 0.6,
        topLabel: 'plumbing', // disagrees with model's "electrical"
        ambiguity: 0,
        labelScores: [{ label: 'plumbing', score: 0.6 }],
      },
    };

    const agreeResult = computeAllFieldConfidences({
      classification: { Maintenance_Category: 'plumbing' },
      modelConfidence: { Maintenance_Category: 0.8 },
      cueResults,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    const disagreeResult = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    // Disagreement should lower confidence
    expect(disagreeResult.Maintenance_Category.confidence).toBeLessThan(
      agreeResult.Maintenance_Category.confidence,
    );
    expect(disagreeResult.Maintenance_Category.components.disagreement).toBe(1);
    expect(agreeResult.Maintenance_Category.components.disagreement).toBe(0);
  });
});

/** Helper: builds a detail with specific component overrides for testing resolved-medium logic. */
function detailWith(
  confidence: number,
  overrides: Partial<{ disagreement: number; ambiguityPenalty: number }> = {},
): FieldConfidenceDetail {
  return {
    confidence,
    components: {
      cueStrength: 0,
      completeness: 1,
      modelHint: 0.5,
      modelHintClamped: 0.5,
      constraintImplied: 0,
      disagreement: overrides.disagreement ?? 0,
      ambiguityPenalty: overrides.ambiguityPenalty ?? 0,
    },
  };
}

describe('resolved medium acceptance', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('field at 0.84, disagreement=0, ambiguity=0, required → NOT in fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.84) },
      config,
    });
    expect(result).not.toContain('Category');
  });

  it('field at 0.84, disagreement=1, ambiguity=0, required → IN fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.84, { disagreement: 1 }) },
      config,
    });
    expect(result).toContain('Category');
  });

  it('field at 0.84, disagreement=0, ambiguity=0.21, required → IN fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.84, { ambiguityPenalty: 0.21 }) },
      config,
    });
    expect(result).toContain('Category');
  });

  it('field at 0.84, disagreement=0, ambiguity=0.20, required → NOT in fieldsNeedingInput (boundary)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.84, { ambiguityPenalty: 0.2 }) },
      config,
    });
    expect(result).not.toContain('Category');
  });

  it('field at 0.77, disagreement=0, ambiguity=0, required → IN fieldsNeedingInput (below threshold)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.77) },
      config,
    });
    expect(result).toContain('Category');
  });

  it('field at 0.78, disagreement=0, ambiguity=0, required → NOT in fieldsNeedingInput (boundary)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.78) },
      config,
    });
    expect(result).not.toContain('Category');
  });

  it('Priority=emergency at 0.84, disagreement=0, ambiguity=0 → IN fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Priority: detailWith(0.84) },
      config,
      classificationOutput: { Priority: 'emergency' },
    });
    expect(result).toContain('Priority');
  });

  it('Priority=normal at 0.84, disagreement=0, ambiguity=0 → NOT in fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Priority: detailWith(0.84) },
      config,
      classificationOutput: { Priority: 'normal' },
    });
    expect(result).not.toContain('Priority');
  });

  it('Priority=high at 0.84, disagreement=0, ambiguity=0 → NOT in fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Priority: detailWith(0.84) },
      config,
      classificationOutput: { Priority: 'high' },
    });
    expect(result).not.toContain('Priority');
  });

  it('field at 0.84, disagreement=0, ambiguity=0, in missingFields → IN fieldsNeedingInput', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.84) },
      config,
      missingFields: ['Category'],
    });
    expect(result).toContain('Category');
  });

  it('medium non-required non-risk-relevant at 0.70 → NOT in fieldsNeedingInput (unchanged)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Management_Object: detailWith(0.7) },
      config,
    });
    expect(result).not.toContain('Management_Object');
  });

  it('low-confidence field at 0.60 → IN fieldsNeedingInput (unchanged)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: { Category: detailWith(0.6) },
      config,
    });
    expect(result).toContain('Category');
  });
});

describe('category gating threshold', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('Category=management at 0.70, disagreement=0, ambiguity=0 → maintenance + location pruned', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.7),
        Maintenance_Category: simpleDetail(0.3),
        Maintenance_Object: simpleDetail(0.3),
        Maintenance_Problem: simpleDetail(0.3),
        Location: simpleDetail(0.3),
        Sub_Location: simpleDetail(0.3),
        Management_Category: simpleDetail(0.9),
        Management_Object: simpleDetail(0.3),
        Priority: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).not.toContain('Maintenance_Category');
    expect(result).not.toContain('Maintenance_Object');
    expect(result).not.toContain('Maintenance_Problem');
    expect(result).not.toContain('Location');
    expect(result).not.toContain('Sub_Location');
  });

  it('Category=management at 0.70, disagreement=1, ambiguity=0 → no pruning', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.7, { disagreement: 1 }),
        Maintenance_Category: simpleDetail(0.3),
        Location: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).toContain('Maintenance_Category');
    expect(result).toContain('Location');
  });

  it('Category=management at 0.70, disagreement=0, ambiguity=0.25 → no pruning', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.7, { ambiguityPenalty: 0.25 }),
        Maintenance_Category: simpleDetail(0.3),
        Location: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).toContain('Maintenance_Category');
    expect(result).toContain('Location');
  });

  it('Category=management at 0.70, disagreement=0, ambiguity=0.20 → pruning fires (boundary)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.7, { ambiguityPenalty: 0.2 }),
        Maintenance_Category: simpleDetail(0.3),
        Location: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).not.toContain('Maintenance_Category');
    expect(result).not.toContain('Location');
  });

  it('Category=management at 0.69, disagreement=0, ambiguity=0 → no pruning (below threshold)', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.69),
        Maintenance_Category: simpleDetail(0.3),
        Location: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).toContain('Maintenance_Category');
    expect(result).toContain('Location');
  });

  it('Category=management at 0.70, disagreement=0, ambiguity=0 — exactly at threshold → pruning fires', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.7),
        Maintenance_Category: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).not.toContain('Maintenance_Category');
  });

  it('Category=maintenance at 0.72, disagreement=0, ambiguity=0 → management fields pruned', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.72),
        Management_Category: simpleDetail(0.3),
        Management_Object: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'maintenance' },
    });
    expect(result).not.toContain('Management_Category');
    expect(result).not.toContain('Management_Object');
  });

  it('Category=maintenance at 0.72, disagreement=0, ambiguity=0 → Location and Sub_Location NOT pruned', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.72),
        Location: simpleDetail(0.3),
        Sub_Location: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'maintenance' },
    });
    expect(result).toContain('Location');
    expect(result).toContain('Sub_Location');
  });

  it('backwards compat: Category at 0.90 (high), ambiguity=0 → still prunes as before', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.9),
        Management_Category: simpleDetail(0.3),
        Management_Object: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'maintenance' },
    });
    expect(result).not.toContain('Management_Category');
    expect(result).not.toContain('Management_Object');
  });

  it('mixed-domain: Category=management at 0.72, disagreement=0, ambiguity=0.50 → no pruning', () => {
    const result = determineFieldsNeedingInput({
      confidenceByField: {
        Category: detailWith(0.72, { ambiguityPenalty: 0.5 }),
        Maintenance_Category: simpleDetail(0.3),
        Location: simpleDetail(0.3),
      },
      config,
      classificationOutput: { Category: 'management' },
    });
    expect(result).toContain('Maintenance_Category');
    expect(result).toContain('Location');
  });
});
