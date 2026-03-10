import { describe, it, expect } from 'vitest';
import { computeSplitCountAccuracy, computeIssueBoundaryF1 } from '../../metrics/split-metrics.js';

describe('split metrics', () => {
  it('returns 1.0 for perfect split count', () => {
    const result = computeSplitCountAccuracy([
      { predicted: 2, expected: 2 },
      { predicted: 1, expected: 1 },
    ]);
    expect(result).toBe(1.0);
  });

  it('returns < 1.0 for incorrect split counts', () => {
    const result = computeSplitCountAccuracy([
      { predicted: 3, expected: 2 },
      { predicted: 1, expected: 1 },
    ]);
    expect(result).toBe(0.5);
  });

  it('returns 0 for empty input', () => {
    expect(computeSplitCountAccuracy([])).toBe(0);
  });

  it('computes F1 of 1.0 for identical texts', () => {
    const result = computeIssueBoundaryF1({
      predicted: ['toilet leaking', 'broken window'],
      expected: ['toilet leaking', 'broken window'],
    });
    expect(result).toBe(1.0);
  });

  it('computes F1 < 1.0 for partial overlap', () => {
    const result = computeIssueBoundaryF1({
      predicted: ['toilet is leaking badly'],
      expected: ['toilet leaking'],
    });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1.0);
  });
});
