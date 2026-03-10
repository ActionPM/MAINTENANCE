import { describe, it, expect } from 'vitest';
import { loadDataset } from '../../datasets/load-dataset.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetsRoot = resolve(__dirname, '..', '..', '..', 'datasets');

describe('seeded datasets', () => {
  for (const ds of ['gold', 'hard', 'ood', 'regression']) {
    it(`loads ${ds} dataset without errors`, async () => {
      const result = await loadDataset(resolve(datasetsRoot, ds));
      expect(result.examples.length).toBeGreaterThan(0);
    });
  }
});
