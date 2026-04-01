import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaxonomy } from '../taxonomy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedPath = resolve(
  __dirname,
  '..',
  '..',
  'taxonomy-classification.generated.schema.json',
);

describe('taxonomy-enum staleness guard', () => {
  it('generated schema matches current taxonomy.json', () => {
    const taxonomy = loadTaxonomy();
    const onDisk = JSON.parse(readFileSync(generatedPath, 'utf-8'));

    // Regenerate expected schema in-memory
    const expected = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'taxonomy-classification.generated.schema.json',
      definitions: {
        TaxonomyClassification: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(taxonomy).map(([field, values]) => [
              field,
              { type: 'string', enum: [...values] },
            ]),
          ),
          additionalProperties: false,
        },
      },
    };

    expect(
      onDisk,
      'Expected generated schema to match taxonomy-classification.generated.schema.json.\n' +
        'Run: pnpm --filter @wo-agent/schemas generate',
    ).toEqual(expected);
  });
});
