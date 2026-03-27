import { describe, it, expect } from 'vitest';
import { computeCueScores, computeCueStrengthForField } from '../../classifier/cue-scoring.js';
import type { CueDictionary } from '@wo-agent/schemas';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '../../../../schemas');

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
    const result = computeCueStrengthForField(
      'my toilet is leaking water from the pipe',
      'Maintenance_Category',
      MINI_CUES,
    );
    // plumbing: leak(1) + toilet(1) + pipe(1) = 3 hits * 0.6 = 1.8 → clamped to 1.0
    expect(result.score).toBe(1.0);
    expect(result.topLabel).toBe('plumbing');
  });

  it('returns top label when multiple labels match', () => {
    const result = computeCueStrengthForField(
      'the outlet sparks when I plug in the toilet',
      'Maintenance_Category',
      MINI_CUES,
    );
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
    const result = computeCueStrengthForField(
      'the faucet is leaking badly',
      'Maintenance_Problem',
      cues,
    );
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
    const result = computeCueStrengthForField('there is a leak', 'Maintenance_Category', MINI_CUES);
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
      kitchen: { keywords: ['kitchen'], regex: [] },
      bathroom: { keywords: ['bathroom', 'washroom'], regex: [] },
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
  it('does NOT score "bathroom" from object mentions like shower (v1.3 audit)', () => {
    const result = computeCueStrengthForField(
      'My shower is leaking',
      'Sub_Location',
      EXTENDED_CUES,
    );
    // Object mentions removed from Sub_Location cues
    expect(result.score).toBe(0);
  });

  it('scores "bathroom" only from explicit "bathroom" keyword', () => {
    const result = computeCueStrengthForField(
      'The bathroom floor is wet',
      'Sub_Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('bathroom');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('scores "kitchen" for explicit kitchen text', () => {
    const result = computeCueStrengthForField(
      'The kitchen sink is clogged',
      'Sub_Location',
      EXTENDED_CUES,
    );
    expect(result.topLabel).toBe('kitchen');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('"my sink is leaking" does NOT produce high Location or Sub_Location scores', () => {
    const realCues: CueDictionary = JSON.parse(
      readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
    );
    const locResult = computeCueStrengthForField('my sink is leaking', 'Location', realCues);
    const subLocResult = computeCueStrengthForField('my sink is leaking', 'Sub_Location', realCues);
    expect(locResult.score).toBe(0);
    expect(subLocResult.score).toBe(0);
  });

  it('"toilet is clogged" scores Maintenance_Object but not Location', () => {
    const realCues: CueDictionary = JSON.parse(
      readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
    );
    const objResult = computeCueStrengthForField(
      'toilet is clogged',
      'Maintenance_Object',
      realCues,
    );
    const locResult = computeCueStrengthForField('toilet is clogged', 'Location', realCues);
    expect(objResult.score).toBeGreaterThan(0);
    expect(objResult.topLabel).toBe('toilet');
    expect(locResult.score).toBe(0);
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
    // plumbing: leak(1) + pipe(1) = 2 * 0.6 = 1.0 (clamped)
    // electrical: outlet(1) + sparks(1) = 2 * 0.6 = 1.0 (clamped)
    expect(result.Maintenance_Category.ambiguity).toBeGreaterThan(0);
  });
});

describe('BUG-001/003 regression — maintenance category cue coverage', () => {
  const realCues: CueDictionary = JSON.parse(
    readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
  );

  // Positive: new maintenance keywords produce correct cues
  it('"I haven\'t had heat in over a week" → Category=maintenance', () => {
    const result = computeCueStrengthForField(
      "I haven't had heat in over a week",
      'Category',
      realCues,
    );
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeGreaterThan(0);
  });

  it('"My toilet is overflowing" → Category=maintenance', () => {
    const result = computeCueStrengthForField('My toilet is overflowing', 'Category', realCues);
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeGreaterThan(0);
  });

  it('"My toilet is overflowing" → Location score 0 (object mention no longer cues location)', () => {
    const result = computeCueStrengthForField('My toilet is overflowing', 'Location', realCues);
    // Object mentions removed from Location cues — only explicit location words score
    expect(result.score).toBe(0);
  });

  it('"It\'s freezing in my unit" → Category=maintenance', () => {
    const result = computeCueStrengthForField("It's freezing in my unit", 'Category', realCues);
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeGreaterThan(0);
  });

  it('"The heater is not working" → Category=maintenance', () => {
    const result = computeCueStrengthForField('The heater is not working', 'Category', realCues);
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeGreaterThan(0);
  });

  it('"no heat in my apartment" → Sub_Location=general', () => {
    const result = computeCueStrengthForField('no heat in my apartment', 'Sub_Location', realCues);
    expect(result.topLabel).toBe('general');
    expect(result.score).toBeGreaterThan(0);
  });

  // Regression: existing positive still works
  it('"kitchen faucet is leaking" → Category=maintenance (existing)', () => {
    const result = computeCueStrengthForField('kitchen faucet is leaking', 'Category', realCues);
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeGreaterThan(0);
  });

  // Negative: management text must NOT false-positive as maintenance
  it('"rent increase" → Category=management, NOT maintenance', () => {
    const result = computeCueStrengthForField('rent increase', 'Category', realCues);
    expect(result.topLabel).toBe('management');
  });

  it('"I need to book the party room" → Category should not be maintenance', () => {
    const result = computeCueScores('I need to book the party room', realCues);
    const maintScore =
      result.Category.labelScores.find((l) => l.label === 'maintenance')?.score ?? 0;
    const mgmtScore = result.Category.labelScores.find((l) => l.label === 'management')?.score ?? 0;
    // Management-specific cues ("booking") should outscore maintenance noise
    expect(mgmtScore).toBeGreaterThanOrEqual(maintScore);
  });

  it('"parking pass renewal" → Category should not be maintenance', () => {
    const result = computeCueScores('parking pass renewal', realCues);
    const maintScore =
      result.Category.labelScores.find((l) => l.label === 'maintenance')?.score ?? 0;
    const mgmtScore = result.Category.labelScores.find((l) => l.label === 'management')?.score ?? 0;
    expect(mgmtScore).toBeGreaterThanOrEqual(maintScore);
  });

  // Word-boundary regex \bac\b restores "AC" shorthand without substring false positives
  it('"The AC is broken" → Category=maintenance (regex \\bac\\b)', () => {
    const result = computeCueStrengthForField('The AC is broken', 'Category', realCues);
    expect(result.topLabel).toBe('maintenance');
    expect(result.score).toBeGreaterThan(0);
  });

  it('"The AC is broken" → Maintenance_Category=hvac (regex \\bac\\b)', () => {
    const result = computeCueStrengthForField('The AC is broken', 'Maintenance_Category', realCues);
    expect(result.topLabel).toBe('hvac');
    expect(result.score).toBeGreaterThan(0);
  });

  // Substring false-positive guard: bare "ac" keyword was removed; \bac\b regex
  // should NOT match inside "access", "package", "accounting".
  it('"I need access to the gym" → Category.maintenance score must be 0', () => {
    const result = computeCueStrengthForField('I need access to the gym', 'Category', realCues);
    const maintScore = result.labelScores.find((l) => l.label === 'maintenance')?.score ?? 0;
    expect(maintScore).toBe(0);
  });

  it('"I need a package locker code" → Category.maintenance score must be 0', () => {
    const result = computeCueStrengthForField('I need a package locker code', 'Category', realCues);
    const maintScore = result.labelScores.find((l) => l.label === 'maintenance')?.score ?? 0;
    expect(maintScore).toBe(0);
  });
});

describe('HVAC cue coverage', () => {
  const realCues: CueDictionary = JSON.parse(
    readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
  );

  it('"heater not working" → Maintenance_Category=hvac, score >= 0.6', () => {
    const result = computeCueStrengthForField(
      'heater not working',
      'Maintenance_Category',
      realCues,
    );
    expect(result.topLabel).toBe('hvac');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"baseboard is cold" → Maintenance_Category=hvac AND Maintenance_Object=radiator', () => {
    const catResult = computeCueStrengthForField(
      'baseboard is cold',
      'Maintenance_Category',
      realCues,
    );
    expect(catResult.topLabel).toBe('hvac');
    const objResult = computeCueStrengthForField(
      'baseboard is cold',
      'Maintenance_Object',
      realCues,
    );
    expect(objResult.topLabel).toBe('radiator');
  });

  it('"boiler making noise" → Maintenance_Category=hvac, score >= 0.6', () => {
    const result = computeCueStrengthForField(
      'boiler making noise',
      'Maintenance_Category',
      realCues,
    );
    expect(result.topLabel).toBe('hvac');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"air conditioner leaking" → Maintenance_Category=hvac, score >= 0.6', () => {
    const result = computeCueStrengthForField(
      'air conditioner leaking',
      'Maintenance_Category',
      realCues,
    );
    expect(result.topLabel).toBe('hvac');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"no cooling in apartment" → Maintenance_Category=hvac, score >= 0.6', () => {
    const result = computeCueStrengthForField(
      'no cooling in apartment',
      'Maintenance_Category',
      realCues,
    );
    expect(result.topLabel).toBe('hvac');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"temperature control broken" → Maintenance_Object=thermostat, score >= 0.6', () => {
    const result = computeCueStrengthForField(
      'temperature control broken',
      'Maintenance_Object',
      realCues,
    );
    expect(result.topLabel).toBe('thermostat');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"ventilation not working" → Maintenance_Category=hvac', () => {
    const result = computeCueStrengthForField(
      'ventilation not working',
      'Maintenance_Category',
      realCues,
    );
    expect(result.topLabel).toBe('hvac');
  });
});

describe('Priority cue coverage', () => {
  const realCues: CueDictionary = JSON.parse(
    readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
  );

  it('"flood in apartment" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('flood in apartment', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"burning smell from outlet" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('burning smell from outlet', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"gas leak in kitchen" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('gas leak in kitchen', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"falling off the wall" → Priority=emergency', () => {
    const result = computeCueStrengthForField('falling off the wall', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
  });

  it('"no heat in apartment" → Priority=high (not emergency — operational policy)', () => {
    const result = computeCueStrengthForField('no heat in apartment', 'Priority', realCues);
    expect(result.topLabel).toBe('high');
  });

  it('"sparking outlet" → Priority=emergency (live electrical hazard)', () => {
    const result = computeCueStrengthForField('sparking outlet', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
  });

  it('"safety issue with electrical" → Priority=high', () => {
    const result = computeCueStrengthForField('safety issue with electrical', 'Priority', realCues);
    expect(result.topLabel).toBe('high');
  });

  it('"no hot water" → Priority=high', () => {
    const result = computeCueStrengthForField('no hot water', 'Priority', realCues);
    expect(result.topLabel).toBe('high');
  });

  it('"locked out of apartment" → Priority=high', () => {
    const result = computeCueStrengthForField('locked out of apartment', 'Priority', realCues);
    expect(result.topLabel).toBe('high');
  });

  it('"leak" → Priority=normal (unchanged)', () => {
    const result = computeCueStrengthForField('leak', 'Priority', realCues);
    expect(result.topLabel).toBe('normal');
  });

  it('"cosmetic scratch" → Priority=low (unchanged)', () => {
    const result = computeCueStrengthForField('cosmetic scratch', 'Priority', realCues);
    expect(result.topLabel).toBe('low');
  });

  // Regression: smoke alarm/detector must NOT promote to emergency
  it('"smoke alarm beeping" → Priority=normal, NOT emergency', () => {
    const result = computeCueStrengthForField('smoke alarm beeping', 'Priority', realCues);
    expect(result.topLabel).toBe('normal');
  });

  it('"smoke detector not working" → Priority=normal, NOT emergency', () => {
    const result = computeCueStrengthForField('smoke detector not working', 'Priority', realCues);
    expect(result.topLabel).toBe('normal');
  });

  // Positive: actual smoke (not alarm/detector) SHOULD still be emergency
  it('"I see smoke coming from the kitchen" → Priority=emergency', () => {
    const result = computeCueStrengthForField(
      'I see smoke coming from the kitchen',
      'Priority',
      realCues,
    );
    expect(result.topLabel).toBe('emergency');
  });

  // CO alarm alerting = emergency (CO is odorless — if the alarm is going off, trust it)
  it('"carbon monoxide detector beeping" → Priority=emergency', () => {
    const result = computeCueStrengthForField(
      'carbon monoxide detector beeping',
      'Priority',
      realCues,
    );
    expect(result.topLabel).toBe('emergency');
  });

  it('"carbon monoxide alarm going off" → Priority=emergency', () => {
    const result = computeCueStrengthForField(
      'carbon monoxide alarm going off',
      'Priority',
      realCues,
    );
    expect(result.topLabel).toBe('emergency');
  });

  it('"co alarm going off" → Priority=emergency', () => {
    const result = computeCueStrengthForField('co alarm going off', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
  });

  // CO detector broken/missing = normal maintenance (no active danger)
  it('"co detector not working" → Priority=normal (maintenance, not active alert)', () => {
    const result = computeCueStrengthForField('co detector not working', 'Priority', realCues);
    expect(result.topLabel).toBe('normal');
  });

  it('"need a new carbon monoxide detector" → Priority=normal, NOT emergency', () => {
    const result = computeCueStrengthForField(
      'need a new carbon monoxide detector',
      'Priority',
      realCues,
    );
    // "carbon monoxide detector" matches the normal counter-cue regex (no alerting verb).
    // The emergency regex has a negative lookahead excluding "carbon monoxide alarm|detector".
    // So only normal fires, not emergency.
    expect(result.topLabel).toBe('normal');
  });
});

describe('bathtub vs shower cue disambiguation (v1.2)', () => {
  const realCues: CueDictionary = JSON.parse(
    readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
  );

  it('scores bathtub higher than shower for tub-specific text', () => {
    const text = "bathtub drain is clogged and water won't drain";
    const result = computeCueStrengthForField(text, 'Maintenance_Object', realCues);
    expect(result.topLabel).toBe('bathtub');
  });

  it('scores shower higher than bathtub for shower-specific text', () => {
    const text = 'shower head is leaking water all over the floor';
    const result = computeCueStrengthForField(text, 'Maintenance_Object', realCues);
    expect(result.topLabel).toBe('shower');
  });
});

describe('electrical safety emergency cue coverage', () => {
  const realCues: CueDictionary = JSON.parse(
    readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8'),
  );

  // Emergency assertions: topLabel === 'emergency', score >= 0.6
  it('"sparking outlet" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('sparking outlet', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"exposed wires in the bedroom" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('exposed wires in the bedroom', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"exposed live wires in bedroom" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('exposed live wires in bedroom', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"electrical shock from the switch" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('electrical shock from the switch', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"electrical fire in panel" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('electrical fire in panel', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"burning smell from outlet" → Priority=emergency (no regression)', () => {
    const result = computeCueStrengthForField('burning smell from outlet', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"outlet is too hot to touch" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('outlet is too hot to touch', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"switch plate is burning hot" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('switch plate is burning hot', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"breaker panel is hot and smells like burning" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField(
      'breaker panel is hot and smells like burning',
      'Priority',
      realCues,
    );
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('"arcing from the outlet" → Priority=emergency, score >= 0.6', () => {
    const result = computeCueStrengthForField('arcing from the outlet', 'Priority', realCues);
    expect(result.topLabel).toBe('emergency');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  // Non-emergency assertions: topLabel !== 'emergency'
  it('"outlet not working" → NOT emergency', () => {
    const result = computeCueStrengthForField('outlet not working', 'Priority', realCues);
    expect(result.topLabel).not.toBe('emergency');
  });

  it('"breaker keeps tripping" → NOT emergency', () => {
    const result = computeCueStrengthForField('breaker keeps tripping', 'Priority', realCues);
    expect(result.topLabel).not.toBe('emergency');
  });

  it('"lights flickering" → NOT emergency', () => {
    const result = computeCueStrengthForField('lights flickering', 'Priority', realCues);
    expect(result.topLabel).not.toBe('emergency');
  });

  it('"unsafe electrical issue" → NOT emergency', () => {
    const result = computeCueStrengthForField('unsafe electrical issue', 'Priority', realCues);
    expect(result.topLabel).not.toBe('emergency');
  });

  it('"no power in whole apartment" → NOT emergency', () => {
    const result = computeCueStrengthForField('no power in whole apartment', 'Priority', realCues);
    expect(result.topLabel).not.toBe('emergency');
  });
});
