import { describe, it, expect } from 'vitest';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { validateCueDictionary, type CueDictionary } from '@wo-agent/schemas';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cueJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../schemas/classification_cues.json'), 'utf-8'),
);
const cueDict = cueJson as CueDictionary;

describe('cue location inference from objects (v1.3 — object shortcuts removed)', () => {
  it('toilet does NOT boost Sub_Location (object-to-location cue removed)', () => {
    const result = computeCueScores('my toilet is leaking', cueDict);
    expect(result['Sub_Location']?.score ?? 0).toBe(0);
  });

  it('fridge does NOT boost Sub_Location (object-to-location cue removed)', () => {
    const result = computeCueScores('the fridge is not working', cueDict);
    expect(result['Sub_Location']?.score ?? 0).toBe(0);
  });

  it('"in my apartment" boosts Location=suite', () => {
    const result = computeCueScores('there is a leak in my apartment', cueDict);
    expect(result['Location']?.topLabel).toBe('suite');
    expect(result['Location']?.score).toBeGreaterThan(0);
  });

  it('"I have a question about the lobby" does NOT boost Location=suite', () => {
    const result = computeCueScores('I have a question about the lobby', cueDict);
    // "lobby" should boost building_interior, not suite
    if (result['Location']) {
      expect(result['Location']?.topLabel).not.toBe('suite');
    }
  });

  it('dishwasher does NOT boost Sub_Location (object-to-location cue removed)', () => {
    const result = computeCueScores('dishwasher is broken', cueDict);
    expect(result['Sub_Location']?.score ?? 0).toBe(0);
  });

  it('shower does NOT boost Sub_Location (object-to-location cue removed)', () => {
    const result = computeCueScores('shower is leaking', cueDict);
    expect(result['Sub_Location']?.score ?? 0).toBe(0);
  });

  it('explicit "bathroom" still boosts Sub_Location=bathroom', () => {
    const result = computeCueScores('the bathroom floor is wet', cueDict);
    expect(result['Sub_Location']?.topLabel).toBe('bathroom');
    expect(result['Sub_Location']?.score).toBeGreaterThan(0);
  });

  it('explicit "kitchen" still boosts Sub_Location=kitchen', () => {
    const result = computeCueScores('the kitchen sink is leaking', cueDict);
    expect(result['Sub_Location']?.topLabel).toBe('kitchen');
    expect(result['Sub_Location']?.score).toBeGreaterThan(0);
  });
});
