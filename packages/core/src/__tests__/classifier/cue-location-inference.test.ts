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

describe('cue location inference from objects', () => {
  it('toilet boosts Sub_Location=bathroom', () => {
    const result = computeCueScores('my toilet is leaking', cueDict);
    expect(result['Sub_Location']?.topLabel).toBe('bathroom');
    expect(result['Sub_Location']?.score).toBeGreaterThan(0);
  });

  it('fridge boosts Sub_Location=kitchen', () => {
    const result = computeCueScores('the fridge is not working', cueDict);
    expect(result['Sub_Location']?.topLabel).toBe('kitchen');
    expect(result['Sub_Location']?.score).toBeGreaterThan(0);
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

  it('dishwasher boosts Sub_Location=kitchen', () => {
    const result = computeCueScores('dishwasher is broken', cueDict);
    expect(result['Sub_Location']?.topLabel).toBe('kitchen');
  });

  it('shower boosts Sub_Location=bathroom', () => {
    const result = computeCueScores('shower is leaking', cueDict);
    expect(result['Sub_Location']?.topLabel).toBe('bathroom');
  });
});
