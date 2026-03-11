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
    errors.push({
      path: '/fields',
      message: 'fields is required and must be an object',
      keyword: 'required',
    });
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

    // Guard: labels must be a non-null object before iterating
    if (labels == null || typeof labels !== 'object' || Array.isArray(labels)) {
      errors.push({
        path: `/fields/${fieldName}`,
        message: `Field "${fieldName}" labels must be a non-null object, got ${labels === null ? 'null' : typeof labels}`,
        keyword: 'type',
      });
      continue;
    }

    const allowedValues = taxonomy[fieldName as TaxonomyFieldName];

    // Check each label and its cue entry shape
    for (const [label, entry] of Object.entries(labels)) {
      // Check label is in taxonomy
      if (!allowedValues.includes(label)) {
        errors.push({
          path: `/fields/${fieldName}/${label}`,
          message: `Label "${label}" does not exist in taxonomy field "${fieldName}". Allowed: [${allowedValues.join(', ')}]`,
          keyword: 'enum',
        });
      }

      // Validate cue entry shape
      const entryPath = `/fields/${fieldName}/${label}`;

      if (entry == null || typeof entry !== 'object') {
        errors.push({
          path: entryPath,
          message: `Cue entry for "${label}" must be an object with { keywords, regex }`,
          keyword: 'type',
        });
        continue;
      }

      const cueEntry = entry as Record<string, unknown>;

      // keywords: must be array of strings
      if (!Array.isArray(cueEntry.keywords)) {
        errors.push({
          path: `${entryPath}/keywords`,
          message: `"keywords" must be an array`,
          keyword: 'type',
        });
      } else {
        for (let i = 0; i < cueEntry.keywords.length; i++) {
          if (typeof cueEntry.keywords[i] !== 'string') {
            errors.push({
              path: `${entryPath}/keywords/${i}`,
              message: `keywords[${i}] must be a string`,
              keyword: 'type',
            });
          }
        }
      }

      // regex: must be array of strings, each a valid RegExp
      if (!Array.isArray(cueEntry.regex)) {
        errors.push({
          path: `${entryPath}/regex`,
          message: `"regex" must be an array`,
          keyword: 'type',
        });
      } else {
        for (let i = 0; i < cueEntry.regex.length; i++) {
          if (typeof cueEntry.regex[i] !== 'string') {
            errors.push({
              path: `${entryPath}/regex/${i}`,
              message: `regex[${i}] must be a string`,
              keyword: 'type',
            });
          } else {
            try {
              new RegExp(cueEntry.regex[i] as string, 'i');
            } catch {
              errors.push({
                path: `${entryPath}/regex/${i}`,
                message: `regex[${i}] is not a valid RegExp: "${cueEntry.regex[i]}"`,
                keyword: 'pattern',
              });
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: cues };
}
