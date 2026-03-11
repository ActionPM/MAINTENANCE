import { describe, it, expect } from 'vitest';
import { computeFieldConfidence, computeAllFieldConfidences } from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';

describe('constraint_implied confidence term', () => {
  it('boosts confidence when constraintImplied=1', () => {
    const base = computeFieldConfidence({
      cueStrength: 0.2,
      completeness: 1.0,
      modelHint: 0.5,
      disagreement: 0,
      ambiguityPenalty: 0,
      constraintImplied: 0,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    const boosted = computeFieldConfidence({
      cueStrength: 0.2,
      completeness: 1.0,
      modelHint: 0.5,
      disagreement: 0,
      ambiguityPenalty: 0,
      constraintImplied: 1.0,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeGreaterThanOrEqual(DEFAULT_CONFIDENCE_CONFIG.medium_threshold);
  });

  it('constraintImplied=0 does not change the original formula result', () => {
    const result = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 0,
      ambiguityPenalty: 0,
      constraintImplied: 0,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    // 0.40*0.8 + 0.25*1.0 + 0.20*0.9 = 0.32 + 0.25 + 0.18 = 0.75
    // model_hint clamped to max 0.95, so 0.9 is fine
    expect(result).toBeCloseTo(0.75, 2);
  });

  it('computeAllFieldConfidences uses impliedFields map', () => {
    const withImplied = computeAllFieldConfidences({
      classification: { Sub_Location: 'bathroom' },
      modelConfidence: { Sub_Location: 0.4 },
      cueResults: {
        Sub_Location: {
          score: 0.1,
          topLabel: 'general',
          ambiguity: 0.5,
          labelScores: [{ label: 'general', score: 0.1 }],
        },
      },
      config: DEFAULT_CONFIDENCE_CONFIG,
      impliedFields: { Sub_Location: 'bathroom' },
    });
    const without = computeAllFieldConfidences({
      classification: { Sub_Location: 'bathroom' },
      modelConfidence: { Sub_Location: 0.4 },
      cueResults: {
        Sub_Location: {
          score: 0.1,
          topLabel: 'general',
          ambiguity: 0.5,
          labelScores: [{ label: 'general', score: 0.1 }],
        },
      },
      config: DEFAULT_CONFIDENCE_CONFIG,
    });
    expect(withImplied['Sub_Location']).toBeGreaterThan(without['Sub_Location']);
  });
});
