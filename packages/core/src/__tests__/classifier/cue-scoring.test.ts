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

  it('returns boosted score for keyword hits', () => {
    const result = computeCueStrengthForField('my toilet is leaking water from the pipe', 'Maintenance_Category', MINI_CUES);
    // plumbing: leak(1) + toilet(1) + pipe(1) = 3 hits * 0.6 = 1.8 → clamped to 1.0
    expect(result.score).toBe(1.0);
    expect(result.topLabel).toBe('plumbing');
  });

  it('returns top label when multiple labels match', () => {
    const result = computeCueStrengthForField('the outlet sparks when I plug in the toilet', 'Maintenance_Category', MINI_CUES);
    // plumbing: toilet(1) = 1 * 0.6 = 0.6
    // electrical: outlet(1) + sparks(1) = 2 * 0.6 = 1.0 (clamped)
    expect(result.topLabel).toBe('electrical');
    expect(result.score).toBe(1.0);
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
    // 1 regex hit → min(1, 1 * 0.6) = 0.6
    expect(result.score).toBeCloseTo(0.6);
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
    // 1 keyword hit (invalid regex skipped) → min(1, 1 * 0.6) = 0.6
    const result = computeCueStrengthForField('there is a leak', 'Maintenance_Problem', cues);
    expect(result.score).toBeCloseTo(0.6);
  });
});

describe('per-hit boost normalization', () => {
  it('produces meaningful score from a single keyword hit', () => {
    // With 5 keywords but only 1 hit, score should still be substantial
    // (not diluted to 1/5 = 0.2 as with old normalization)
    const result = computeCueStrengthForField(
      'there is a leak',
      'Maintenance_Category',
      MINI_CUES,
    );
    // 1 hit out of 5 keywords for plumbing: should be HIT_BOOST (0.6), not 0.2
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.topLabel).toBe('plumbing');
  });

  it('saturates to 1.0 with multiple hits', () => {
    const result = computeCueStrengthForField(
      'my toilet is leaking water from the pipe',
      'Maintenance_Category',
      MINI_CUES,
    );
    // 3 hits (leak, toilet, pipe) * 0.6 = 1.8 → clamped to 1.0
    expect(result.score).toBe(1.0);
    expect(result.topLabel).toBe('plumbing');
  });

  it('preserves ambiguity detection when two labels have equal hits', () => {
    // plumbing: pipe(1) = 0.6, electrical: sparks(1) = 0.6 → tied → ambiguous
    const result = computeCueStrengthForField(
      'the pipe has sparks',
      'Maintenance_Category',
      MINI_CUES,
    );
    expect(result.ambiguity).toBeGreaterThan(0.9); // nearly identical scores
  });
});

const EXTENDED_CUES: CueDictionary = {
  version: '1.1.0',
  fields: {
    ...MINI_CUES.fields,
    Category: {
      maintenance: { keywords: ['leak', 'broken', 'repair', 'not working', 'clog'], regex: [] },
      management: { keywords: ['rent', 'lease', 'move out', 'receipt', 'payment'], regex: [] },
    },
    Location: {
      suite: { keywords: ['apartment', 'unit', 'suite', 'my room'], regex: [] },
      building_interior: { keywords: ['hallway', 'lobby', 'elevator', 'stairwell'], regex: [] },
      building_exterior: { keywords: ['parking', 'roof', 'exterior', 'garage'], regex: [] },
    },
    Sub_Location: {
      kitchen: { keywords: ['kitchen', 'stove', 'oven', 'fridge'], regex: [] },
      bathroom: { keywords: ['bathroom', 'shower', 'bathtub', 'toilet'], regex: [] },
      general: { keywords: ['apartment', 'unit', 'suite'], regex: [] },
    },
    Priority: {
      emergency: { keywords: ['flood', 'fire', 'gas leak', 'burst pipe', 'sewage'], regex: [] },
      high: { keywords: ['no water', 'sparks', 'infestation', 'dangerous'], regex: [] },
      normal: { keywords: ['leak', 'broken', 'not working', 'clog'], regex: [] },
      low: { keywords: ['cosmetic', 'scratch', 'minor', 'scuff'], regex: [] },
    },
  },
};

describe('Category cue scoring', () => {
  it('scores "maintenance" for leak-related text', () => {
    const result = computeCueStrengthForField(
      'I have a leak in my apartment',
      'Category',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeCloseTo(0.6); // 1 hit * HIT_BOOST
  });

  it('scores "management" for rent-related text', () => {
    const result = computeCueStrengthForField(
      'I need a copy of my rent receipt',
      'Category',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('management');
    expect(result.score).toBe(1.0); // 2 hits: rent + receipt → min(1, 1.2)
  });
});

describe('Location cue scoring', () => {
  it('scores "suite" for apartment text', () => {
    const result = computeCueStrengthForField(
      'I have a leak in my apartment',
      'Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('suite');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('scores "building_interior" for hallway text', () => {
    const result = computeCueStrengthForField(
      'The hallway light is broken',
      'Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('building_interior');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('scores "building_exterior" for parking text', () => {
    const result = computeCueStrengthForField(
      'The parking lot has a pothole',
      'Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('building_exterior');
    expect(result.score).toBeCloseTo(0.6);
  });
});

describe('Sub_Location cue scoring', () => {
  it('scores "bathroom" for shower/toilet text', () => {
    const result = computeCueStrengthForField(
      'My shower is leaking',
      'Sub_Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('bathroom');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('scores "kitchen" for kitchen text', () => {
    const result = computeCueStrengthForField(
      'The kitchen sink is clogged',
      'Sub_Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('kitchen');
    expect(result.score).toBeCloseTo(0.6);
  });
});

describe('Priority cue scoring', () => {
  it('scores "emergency" for flood text', () => {
    const result = computeCueStrengthForField(
      'Water is flooding my apartment',
      'Priority',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('scores "normal" for routine leak text', () => {
    const result = computeCueStrengthForField(
      'There is a small leak under the sink',
      'Priority',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('normal');
    expect(result.score).toBeCloseTo(0.6);
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
