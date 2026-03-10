import { describe, it, expect } from 'vitest';
import { loadDataset, DatasetLoadError } from '../../datasets/load-dataset.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('loadDataset', () => {
  it('throws DatasetLoadError for nonexistent directory', async () => {
    await expect(loadDataset('/nonexistent/path')).rejects.toThrow(DatasetLoadError);
  });

  it('throws DatasetLoadError for missing manifest.json', async () => {
    await expect(loadDataset(__dirname)).rejects.toThrow(DatasetLoadError);
  });
});
