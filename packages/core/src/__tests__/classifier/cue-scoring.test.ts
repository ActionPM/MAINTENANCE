import { describe, it, expect } from 'vitest';
import { computeCueScores, computeCueStrengthForField } from '../../classifier/cue-scoring.js';
import type { CueDictionary } from '@wo-agent/schemas';

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet', 'sink', 'drain', 'pipe'], regex: [] },
      electrical: { keywords: ['breaker', 'outlet', 'switch', 'sparks', 'power'], regex: [] },
      hvac: { keywords: ['heat', 'ac', 'furnace', 'thermostat'], regex: [] },
    },
    Maintenance_Object: {
      toilet: { keywords: ['toilet', 'wc', 'commode'], regex: [] },
      sink: { keywords: ['sink', 'basin'], regex: [] },
    },
  },
};

describe('computeCueStrengthForField', () => {
  it('returns 0 when no cues match', () => {
    const result = computeCueStrengthForField('my cat is cute', 'Maintenance_Category', MINI_CUES);
    expect(result.score).toBe(0);
    expect(result.topLabel).toBeNull();
  });

  it('returns normalized score for keyword hits', () => {
    const result = computeCueStrengthForField('my toilet is leaking water from the pipe', 'Maintenance_Category', MINI_CUES);
    // plumbing: leak(1) + toilet(1) + pipe(1) = 3/5 = 0.6
    expect(result.score).toBeCloseTo(0.6);
    expect(result.topLabel).toBe('plumbing');
  });

  it('returns top label when multiple labels match', () => {
    const result = computeCueStrengthForField('the outlet sparks when I plug in the toilet', 'Maintenance_Category', MINI_CUES);
    // plumbing: toilet(1) = 1/5 = 0.2
    // electrical: outlet(1) + sparks(1) = 2/5 = 0.4
    expect(result.topLabel).toBe('electrical');
    expect(result.score).toBeCloseTo(0.4);
  });

  it('returns 0 for a field not in cue dictionary', () => {
    const result = computeCueStrengthForField('toilet leak', 'Location', MINI_CUES);
    expect(result.score).toBe(0);
    expect(result.topLabel).toBeNull();
  });

  it('is case-insensitive for keyword matching', () => {
    const result = computeCueStrengthForField('TOILET LEAK', 'Maintenance_Category', MINI_CUES);
    expect(result.score).toBeGreaterThan(0);
    expect(result.topLabel).toBe('plumbing');
  });

  it('supports regex patterns', () => {
    const cues: CueDictionary = {
      version: '1.0.0',
      fields: {
        Maintenance_Problem: {
          leak: { keywords: [], regex: ['\\bleak(s|ing|ed)?\\b'] },
        },
      },
    };
    const result = computeCueStrengthForField('the faucet is leaking badly', 'Maintenance_Problem', cues);
    expect(result.score).toBe(1.0);
    expect(result.topLabel).toBe('leak');
  });

  it('handles regex errors gracefully', () => {
    const cues: CueDictionary = {
      version: '1.0.0',
      fields: {
        Maintenance_Problem: {
          leak: { keywords: ['leak'], regex: ['[invalid('] },
        },
      },
    };
    // Should not throw, regex error is skipped
    const result = computeCueStrengthForField('there is a leak', 'Maintenance_Problem', cues);
    expect(result.score).toBeCloseTo(0.5); // 1 keyword hit / 2 total cues
  });
});

describe('computeCueScores', () => {
  it('returns cue_strength and topLabel for all cue dictionary fields', () => {
    const result = computeCueScores('my toilet is leaking', MINI_CUES);
    expect(result.Maintenance_Category.score).toBeGreaterThan(0);
    expect(result.Maintenance_Category.topLabel).toBe('plumbing');
    expect(result.Maintenance_Object.score).toBeGreaterThan(0);
    expect(result.Maintenance_Object.topLabel).toBe('toilet');
  });

  it('returns empty object when text matches nothing', () => {
    const result = computeCueScores('hello world', MINI_CUES);
    expect(result.Maintenance_Category.score).toBe(0);
    expect(result.Maintenance_Object.score).toBe(0);
  });

  it('computes ambiguity when top-2 scores are close', () => {
    // Both plumbing and electrical get similar hits
    const result = computeCueScores('the pipe outlet is leaking sparks', MINI_CUES);
    // plumbing: leak(1) + pipe(1) = 2/5 = 0.4
    // electrical: outlet(1) + sparks(1) = 2/5 = 0.4
    expect(result.Maintenance_Category.ambiguity).toBeGreaterThan(0);
  });
});
