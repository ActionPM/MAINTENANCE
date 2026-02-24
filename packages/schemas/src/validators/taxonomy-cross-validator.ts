import type { Taxonomy, TaxonomyFieldName } from '../taxonomy.js';
import { TAXONOMY_FIELD_NAMES, MAINTENANCE_FIELDS, MANAGEMENT_FIELDS } from '../taxonomy.js';

export interface DomainValidationResult {
  readonly valid: boolean;
  readonly contradictory: boolean;
  readonly invalidValues: readonly { field: string; value: string; allowed: readonly string[] }[];
  readonly crossDomainViolations: readonly string[];
}

/**
 * Validate that classification outputs reference only values that exist in taxonomy.json.
 * Also detects category gating contradictions (spec §5.3).
 */
export function validateClassificationAgainstTaxonomy(
  classification: Record<string, string>,
  taxonomy: Taxonomy,
): DomainValidationResult {
  const invalidValues: { field: string; value: string; allowed: readonly string[] }[] = [];
  const crossDomainViolations: string[] = [];

  // Check each classified field against taxonomy
  for (const [field, value] of Object.entries(classification)) {
    if (!TAXONOMY_FIELD_NAMES.includes(field as TaxonomyFieldName)) {
      invalidValues.push({
        field,
        value,
        allowed: [],
      });
      continue;
    }

    const allowed = taxonomy[field as TaxonomyFieldName];
    if (!allowed.includes(value)) {
      invalidValues.push({ field, value, allowed });
    }
  }

  // Category gating: check for cross-domain contradictions
  const category = classification['Category'];
  if (category) {
    if (category === 'management') {
      // Management category should not have populated maintenance fields
      for (const mField of MAINTENANCE_FIELDS) {
        const val = classification[mField as string];
        if (val && val !== 'other_issue' && val !== 'other_maintenance_category' && val !== 'other_object' && val !== 'other_maintenance_object' && val !== 'no_object' && val !== 'other_problem') {
          crossDomainViolations.push(
            `Management category with populated ${mField}: "${val}"`,
          );
        }
      }
    } else if (category === 'maintenance') {
      // Maintenance category should not have populated management fields
      for (const mField of MANAGEMENT_FIELDS) {
        const val = classification[mField as string];
        if (val && val !== 'other_mgmt_cat' && val !== 'other_management_category' && val !== 'other_mgmt_obj' && val !== 'other_management_object' && val !== 'no_object') {
          crossDomainViolations.push(
            `Maintenance category with populated ${mField}: "${val}"`,
          );
        }
      }
    }
  }

  const contradictory = crossDomainViolations.length > 0;
  const valid = invalidValues.length === 0 && !contradictory;

  return { valid, contradictory, invalidValues, crossDomainViolations };
}
