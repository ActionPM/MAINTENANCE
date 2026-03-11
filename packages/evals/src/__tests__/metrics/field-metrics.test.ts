import { describe, it, expect } from 'vitest';
import {
  computePerFieldAccuracy,
  computeOverallFieldAccuracy,
  computeSchemaInvalidRate,
  computeTaxonomyInvalidRate,
} from '../../metrics/field-metrics.js';

describe('field metrics', () => {
  it('computes perfect per-field accuracy', () => {
    const result = computePerFieldAccuracy([
      { predicted: { Category: 'maintenance' }, expected: { Category: 'maintenance' } },
    ]);
    expect(result.Category).toBe(1.0);
  });

  it('computes 50% accuracy on mixed results', () => {
    const result = computePerFieldAccuracy([
      { predicted: { Category: 'maintenance' }, expected: { Category: 'maintenance' } },
      { predicted: { Category: 'management' }, expected: { Category: 'maintenance' } },
    ]);
    expect(result.Category).toBe(0.5);
  });

  it('computes overall field accuracy', () => {
    const result = computeOverallFieldAccuracy([
      {
        predicted: { Category: 'maintenance', Location: 'suite' },
        expected: { Category: 'maintenance', Location: 'suite' },
      },
    ]);
    expect(result).toBe(1.0);
  });

  it('computes schema-invalid rate', () => {
    expect(computeSchemaInvalidRate(['ok', 'ok', 'schema_fail'])).toBeCloseTo(1 / 3);
  });

  it('computes taxonomy-invalid rate', () => {
    expect(computeTaxonomyInvalidRate(['ok', 'taxonomy_fail', 'ok'])).toBeCloseTo(1 / 3);
  });
});
