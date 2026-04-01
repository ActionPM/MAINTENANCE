import type { ConstraintMapName, TaxonomyConstraints } from '@wo-agent/schemas';
import { CONSTRAINT_EDGES } from '@wo-agent/schemas';

/**
 * Values considered "vague" — can be overwritten by constraint resolution.
 *
 * `needs_object` is intentionally excluded: it is a deliberate placeholder that
 * triggers follow-up for object clarification. It should only be resolved when
 * the tenant provides specific information, not by constraint narrowing alone.
 */
const VAGUE_VALUES = new Set(['general', 'other_sub_location']);

const FORWARD_HIERARCHY_MAPS = new Set<ConstraintMapName>([
  'Location_to_Sub_Location',
  'Sub_Location_to_Maintenance_Category',
  'Maintenance_Category_to_Maintenance_Object',
  'Maintenance_Object_to_Maintenance_Problem',
]);

export interface ConstraintResolvedValueOptions {
  readonly treatNeedsObjectAsUnresolved?: boolean;
}

export interface ConstraintResolutionOptions {
  readonly mode?: 'forward_hierarchy' | 'all';
}

export function isConstraintResolvedValue(
  value: string | null | undefined,
  options: ConstraintResolvedValueOptions = {},
): value is string {
  if (value == null || value === '') return false;
  if (VAGUE_VALUES.has(value)) return false;
  if (options.treatNeedsObjectAsUnresolved && value === 'needs_object') return false;
  return true;
}

/**
 * Given a target field and current classification, return the valid options
 * for that field based on hierarchical constraints.
 *
 * Returns null if no parent is classified (unconstrained).
 * Returns the intersection of all applicable parent constraints.
 */
export function resolveValidOptions(
  targetField: string,
  classification: Record<string, string>,
  constraints: TaxonomyConstraints,
): string[] | null {
  const relevantEdges = CONSTRAINT_EDGES.filter((e) => e.childField === targetField);
  return resolveValidOptionsForEdges(classification, constraints, relevantEdges);
}

function resolveValidOptionsForEdges(
  classification: Record<string, string>,
  constraints: TaxonomyConstraints,
  relevantEdges: readonly (typeof CONSTRAINT_EDGES)[number][],
): string[] | null {
  if (relevantEdges.length === 0) return null;

  const constraintSets: string[][] = [];

  for (const edge of relevantEdges) {
    const parentValue = classification[edge.parentField];
    if (!parentValue) continue;

    const map = constraints[edge.mapKey] as Record<string, readonly string[]>;
    const allowed = map[parentValue];
    if (allowed) {
      constraintSets.push([...allowed]);
    }
  }

  if (constraintSets.length === 0) return null;

  let result = constraintSets[0];
  for (let i = 1; i < constraintSets.length; i++) {
    const set = new Set(constraintSets[i]);
    result = result.filter((v) => set.has(v));
  }

  return result;
}

/**
 * Given current classification, find fields that constraints narrow to
 * exactly one option. Only resolves fields that are empty or vague.
 *
 * IMPORTANT: Does NOT overwrite classifier values that are specific
 * and non-vague. For already-set specific values, use
 * validateHierarchicalConstraints to detect violations instead.
 */
export function resolveConstraintImpliedFields(
  classification: Record<string, string>,
  constraints: TaxonomyConstraints,
  _taxonomyVersion?: string,
  options: ConstraintResolutionOptions = {},
): Record<string, string> {
  const mode = options.mode ?? 'forward_hierarchy';
  const implied: Record<string, string> = {};
  const eligibleEdges = CONSTRAINT_EDGES.filter(
    (edge) => mode === 'all' || FORWARD_HIERARCHY_MAPS.has(edge.mapKey),
  );
  const childFields = new Set(eligibleEdges.map((e) => e.childField));

  for (const targetField of childFields) {
    const currentValue = classification[targetField];
    if (isConstraintResolvedValue(currentValue)) continue;

    const supportingEdges = eligibleEdges.filter((edge) => edge.childField === targetField);
    const validOptions = resolveValidOptionsForEdges(classification, constraints, supportingEdges);
    if (validOptions && validOptions.length === 1) {
      const supportedByEligibleEdge = supportingEdges.some((edge) => {
        const parentValue = classification[edge.parentField];
        if (!parentValue) return false;

        const map = constraints[edge.mapKey] as Record<string, readonly string[]>;
        const allowed = map[parentValue];
        return allowed?.includes(validOptions[0]) ?? false;
      });

      if (supportedByEligibleEdge) {
        implied[targetField] = validOptions[0];
      }
    }
  }

  return implied;
}
