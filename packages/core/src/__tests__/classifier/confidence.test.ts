import { describe, it, expect } from 'vitest';
import {
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
} from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { CueFieldResult } from '../../classifier/cue-scoring.js';

describe('computeFieldConfidence', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('computes confidence using the formula from spec 14.3', () => {
    const result = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
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
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    const withDisagree = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 1,
      ambiguityPenalty: 0,
      config,
    });
    expect(withDisagree).toBeCloseTo(noDisagree - 0.10);
  });

  it('subtracts ambiguity penalty', () => {
    const noAmbiguity = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    const withAmbiguity = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
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
      disagreement: 1,
      ambiguityPenalty: 1,
      config,
    });
    expect(tooLow).toBeGreaterThanOrEqual(0);

    const tooHigh = computeFieldConfidence({
      cueStrength: 1,
      completeness: 1,
      modelHint: 1,
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
    const confidences = { Category: 0.9, Maintenance_Category: 0.5 };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toContain('Maintenance_Category');
    expect(result).not.toContain('Category');
  });

  it('returns empty array when all fields are high confidence', () => {
    const confidences = { Category: 0.9, Maintenance_Category: 0.88 };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toEqual([]);
  });

  it('includes medium-confidence fields', () => {
    // Medium fields are asked if required or risk-relevant (always ask in MVP)
    const confidences = { Category: 0.9, Maintenance_Category: 0.7 };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toContain('Maintenance_Category');
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

    expect(result.Category).toBeGreaterThan(0);
    expect(result.Maintenance_Category).toBeGreaterThan(0);
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
    expect(disagreeResult.Maintenance_Category).toBeLessThan(agreeResult.Maintenance_Category);
  });
});
