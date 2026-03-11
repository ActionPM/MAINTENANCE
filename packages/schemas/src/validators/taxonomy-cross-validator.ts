import type { Taxonomy, TaxonomyFieldName } from '../taxonomy.js';
import { TAXONOMY_FIELD_NAMES, MAINTENANCE_FIELDS, MANAGEMENT_FIELDS } from '../taxonomy.js';
import type { TaxonomyConstraints } from '../taxonomy-constraints.js';
import { CONSTRAINT_EDGES } from '../taxonomy-constraints.js';

export interface DomainValidationResult {
  readonly valid: boolean;
  readonly contradictory: boolean;
  readonly invalidValues: readonly { field: string; value: string; allowed: readonly string[] }[];
  readonly crossDomainViolations: readonly string[];
}

// N/A values accepted under taxonomy < 1.1.0 (legacy behavior)
const LEGACY_MAINTENANCE_NA = [
  'other_issue',
  'other_maintenance_category',
  'other_object',
  'other_maintenance_object',
  'no_object',
  'other_problem',
] as const;

const LEGACY_MANAGEMENT_NA = [
  'other_mgmt_cat',
  'other_management_category',
  'other_mgmt_obj',
  'other_management_object',
  'no_object',
] as const;

// N/A value for taxonomy >= 1.1.0
const CURRENT_NA = 'not_applicable';

/** Returns true if semver string a < b. Compares numeric segments only. */
export function semverLt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const sa = pa[i] ?? 0;
    const sb = pb[i] ?? 0;
    if (sa < sb) return true;
    if (sa > sb) return false;
  }
  return false;
}

function isAcceptableNA(val: string, taxonomyVersion?: string): boolean {
  if (!taxonomyVersion || semverLt(taxonomyVersion, '1.1.0')) {
    // Legacy: accept old other_* values
    return (
      (LEGACY_MAINTENANCE_NA as readonly string[]).includes(val) ||
      (LEGACY_MANAGEMENT_NA as readonly string[]).includes(val)
    );
  }
  return val === CURRENT_NA;
}

/**
 * Validate that classification outputs reference only values that exist in taxonomy.json.
 * Also detects category gating contradictions (spec §5.3).
 */
export function validateClassificationAgainstTaxonomy(
  classification: Record<string, string>,
  taxonomy: Taxonomy,
  taxonomyVersion?: string,
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
        if (val && !isAcceptableNA(val, taxonomyVersion)) {
          crossDomainViolations.push(`Management category with populated ${mField}: "${val}"`);
        }
      }
    } else if (category === 'maintenance') {
      // Maintenance category should not have populated management fields
      for (const mField of MANAGEMENT_FIELDS) {
        const val = classification[mField as string];
        if (val && !isAcceptableNA(val, taxonomyVersion)) {
          crossDomainViolations.push(`Maintenance category with populated ${mField}: "${val}"`);
        }
      }
    }
  }

  const contradictory = crossDomainViolations.length > 0;
  const valid = invalidValues.length === 0 && !contradictory;

  return { valid, contradictory, invalidValues, crossDomainViolations };
}

// --- Hierarchical constraint validation ---

export interface HierarchicalValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

const SKIP_VALUES = new Set([
  'other_object',
  'no_object',
  'needs_object',
  'other_maintenance_object',
  'other_problem',
  'other_maintenance_category',
  'other_issue',
  'other_mgmt_cat',
  'other_management_category',
  'other_mgmt_obj',
  'other_management_object',
  'other_sub_location',
  'other_category',
  'other_priority',
  'general',
]);

export function validateHierarchicalConstraints(
  classification: Record<string, string>,
  constraints: TaxonomyConstraints,
  _taxonomyVersion?: string,
): HierarchicalValidationResult {
  const category = classification['Category'];
  const edgesToCheck =
    category === 'management'
      ? CONSTRAINT_EDGES.filter((e) => e.mapKey === 'Location_to_Sub_Location')
      : CONSTRAINT_EDGES;

  const violations: string[] = [];

  for (const edge of edgesToCheck) {
    const parentValue = classification[edge.parentField];
    const childValue = classification[edge.childField];
    if (!parentValue || !childValue) continue;
    if (SKIP_VALUES.has(parentValue) || SKIP_VALUES.has(childValue)) continue;

    const map = constraints[edge.mapKey] as Record<string, readonly string[]>;
    const allowed = map[parentValue];
    if (allowed && !allowed.includes(childValue)) {
      violations.push(
        `${edge.childField} "${childValue}" is not valid for ${edge.parentField} "${parentValue}"`,
      );
    }
  }

  return { valid: violations.length === 0, violations };
}
