import { describe, it, expect } from 'vitest';
import {
  detectDirectAnchor,
  applyDirectAnchorBoost,
  DIRECT_ANCHOR_RULES,
} from './direct-anchors.js';
import type { CueScoreMap } from './cue-scoring.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '../../../schemas');

const config = DEFAULT_CONFIDENCE_CONFIG;
const catAmbMax = config.resolved_medium_max_ambiguity; // 0.2

function makeCueResult(topLabel: string | null, score: number, ambiguity = 0) {
  return {
    score,
    topLabel,
    ambiguity,
    labelScores: topLabel ? [{ label: topLabel, score }] : [],
  };
}

describe('anchor rule taxonomy validation', () => {
  const taxonomy = JSON.parse(
    readFileSync(resolve(schemasDir, 'taxonomy.json'), 'utf-8'),
  );

  it('all anchor rule labels exist in taxonomy.json', () => {
    for (const rule of DIRECT_ANCHOR_RULES) {
      expect(
        taxonomy.Maintenance_Category,
        `Maintenance_Category missing "${rule.categoryLabel}"`,
      ).toContain(rule.categoryLabel);
      expect(
        taxonomy.Maintenance_Problem,
        `Maintenance_Problem missing "${rule.problemLabel}"`,
      ).toContain(rule.problemLabel);
      if (rule.objectLabel) {
        expect(
          taxonomy.Maintenance_Object,
          `Maintenance_Object missing "${rule.objectLabel}"`,
        ).toContain(rule.objectLabel);
      }
    }
  });
});

describe('detectDirectAnchor', () => {
  it('detects faucet+leak as a direct anchor', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    const match = detectDirectAnchor(cueScores, catAmbMax);
    expect(match).not.toBeNull();
    expect(match!.categoryLabel).toBe('plumbing');
    expect(match!.objectLabel).toBe('faucet');
    expect(match!.problemLabel).toBe('leak');
  });

  it('returns null when no object cue matches', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult(null, 0),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).toBeNull();
  });

  it('returns null when category cue is management', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('management', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).toBeNull();
  });

  it('returns null when Category cue has high ambiguity (mixed-domain guard)', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6, 0.5), // ambiguity 0.5 > 0.2
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).toBeNull();
  });

  it('returns null when Category cue ambiguity is at boundary (0.21 > 0.2)', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6, 0.21),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).toBeNull();
  });

  it('fires when Category cue ambiguity is exactly at threshold (0.2)', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6, 0.2),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).not.toBeNull();
  });

  it('returns null when Maintenance_Category has high ambiguity', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6, 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).toBeNull();
  });

  it('detects hvac+no_heat without object (category+problem anchor)', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('hvac', 0.6),
      Maintenance_Object: makeCueResult(null, 0),
      Maintenance_Problem: makeCueResult('no_heat', 0.6),
    };
    const match = detectDirectAnchor(cueScores, catAmbMax);
    expect(match).not.toBeNull();
    expect(match!.categoryLabel).toBe('hvac');
    expect(match!.objectLabel).toBeUndefined();
    expect(match!.problemLabel).toBe('no_heat');
  });

  it('detects toilet+clog anchor', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('toilet', 0.6),
      Maintenance_Problem: makeCueResult('clog', 0.6),
    };
    const match = detectDirectAnchor(cueScores, catAmbMax);
    expect(match).not.toBeNull();
    expect(match!.objectLabel).toBe('toilet');
    expect(match!.problemLabel).toBe('clog');
  });

  it('returns null for unrecognized object+problem pair', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('no_heat', 0.6), // faucet+no_heat is not a rule
    };
    expect(detectDirectAnchor(cueScores, catAmbMax)).toBeNull();
  });
});

describe('applyDirectAnchorBoost', () => {
  it('boosts faucet+leak fields to 1.0', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
      Location: makeCueResult('suite', 0.6),
      Priority: makeCueResult('normal', 0.6),
    };
    const boosted = applyDirectAnchorBoost(cueScores, config);

    expect(boosted.Category.score).toBe(1.0);
    expect(boosted.Category.ambiguity).toBe(0);
    expect(boosted.Maintenance_Category.score).toBe(1.0);
    expect(boosted.Maintenance_Object.score).toBe(1.0);
    expect(boosted.Maintenance_Problem.score).toBe(1.0);
    // Location and Priority are NOT boosted
    expect(boosted.Location.score).toBe(0.6);
    expect(boosted.Priority.score).toBe(0.6);
  });

  it('returns unchanged map when no anchor matches', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult(null, 0),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    const result = applyDirectAnchorBoost(cueScores, config);
    expect(result).toBe(cueScores); // same reference — no copy
  });

  it('boosts hvac+no_heat without object — object field unchanged', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('hvac', 0.6),
      Maintenance_Object: makeCueResult(null, 0),
      Maintenance_Problem: makeCueResult('no_heat', 0.6),
    };
    const boosted = applyDirectAnchorBoost(cueScores, config);

    expect(boosted.Category.score).toBe(1.0);
    expect(boosted.Maintenance_Category.score).toBe(1.0);
    expect(boosted.Maintenance_Problem.score).toBe(1.0);
    expect(boosted.Maintenance_Object.score).toBe(0); // not boosted
  });

  it('does not mutate the original CueScoreMap', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6),
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    applyDirectAnchorBoost(cueScores, config);
    expect(cueScores.Maintenance_Object.score).toBe(0.6);
  });

  it('does not boost when Category cue is ambiguous (mixed-domain safety)', () => {
    const cueScores: CueScoreMap = {
      Category: makeCueResult('maintenance', 0.6, 0.5), // ambiguous
      Maintenance_Category: makeCueResult('plumbing', 0.6),
      Maintenance_Object: makeCueResult('faucet', 0.6),
      Maintenance_Problem: makeCueResult('leak', 0.6),
    };
    const result = applyDirectAnchorBoost(cueScores, config);
    expect(result).toBe(cueScores); // unchanged — anchor blocked
  });
});
