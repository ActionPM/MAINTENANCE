// packages/schemas/scripts/generate-taxonomy-enums.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taxonomyPath = resolve(__dirname, '..', 'taxonomy.json');
const outputPath = resolve(__dirname, '..', 'taxonomy-classification.generated.schema.json');

const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf-8'));

const schema = {
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

writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n');
// eslint-disable-next-line no-undef
console.log('Generated taxonomy-classification.generated.schema.json');
