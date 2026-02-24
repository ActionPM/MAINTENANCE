import type { Taxonomy, TaxonomyFieldName } from '../taxonomy.js';
import { TAXONOMY_FIELD_NAMES } from '../taxonomy.js';
import type { ValidationResult, ValidationError } from '../validator.js';

export interface CueDictionary {
  readonly version: string;
  readonly fields: Record<string, Record<string, { keywords: string[]; regex: string[] }>>;
}

/**
 * Validate that classification_cues.json labels match taxonomy.json exactly.
 * Every field name must be a taxonomy field, and every label must be a valid value.
 */
export function validateCueDictionary(
  cues: CueDictionary,
  taxonomy: Taxonomy,
): ValidationResult<CueDictionary> {
  const errors: ValidationError[] = [];

  if (!cues.version) {
    errors.push({ path: '/version', message: 'version is required', keyword: 'required' });
  }

  if (!cues.fields || typeof cues.fields !== 'object') {
    errors.push({ path: '/fields', message: 'fields is required and must be an object', keyword: 'required' });
    return { valid: false, errors };
  }

  for (const [fieldName, labels] of Object.entries(cues.fields)) {
    // Check field name exists in taxonomy
    if (!TAXONOMY_FIELD_NAMES.includes(fieldName as TaxonomyFieldName)) {
      errors.push({
        path: `/fields/${fieldName}`,
        message: `Field "${fieldName}" does not exist in taxonomy`,
        keyword: 'enum',
      });
      continue;
    }

    const allowedValues = taxonomy[fieldName as TaxonomyFieldName];

    // Check each label exists in the taxonomy for this field
    for (const label of Object.keys(labels)) {
      if (!allowedValues.includes(label)) {
        errors.push({
          path: `/fields/${fieldName}/${label}`,
          message: `Label "${label}" does not exist in taxonomy field "${fieldName}". Allowed: [${allowedValues.join(', ')}]`,
          keyword: 'enum',
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: cues };
}
