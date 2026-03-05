import type { TaxonomyConstraints } from '@wo-agent/schemas';
import { CONSTRAINT_EDGES } from '@wo-agent/schemas';

/** Values considered "vague" — can be overwritten by constraint resolution. */
const VAGUE_VALUES = new Set(['general', 'other_sub_location', 'needs_object']);

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
  const relevantEdges = CONSTRAINT_EDGES.filter(e => e.childField === targetField);
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
    result = result.filter(v => set.has(v));
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
): Record<string, string> {
  const implied: Record<string, string> = {};
  const childFields = new Set(CONSTRAINT_EDGES.map(e => e.childField));

  for (const targetField of childFields) {
    const currentValue = classification[targetField];
    if (currentValue && !VAGUE_VALUES.has(currentValue)) continue;

    const options = resolveValidOptions(targetField, classification, constraints);
    if (options && options.length === 1) {
      implied[targetField] = options[0];
    }
  }

  return implied;
}
