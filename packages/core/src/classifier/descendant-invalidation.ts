import type { TaxonomyConstraints } from '@wo-agent/schemas';
import { CONSTRAINT_EDGES } from '@wo-agent/schemas';
import { resolveValidOptions, isConstraintResolvedValue } from './constraint-resolver.js';

/**
 * Forward hierarchy for maintenance issues.
 * Each entry maps a parent field to its immediate child in the dependency chain.
 */
const MAINTENANCE_FORWARD_CHAIN: ReadonlyArray<readonly [string, string]> = [
  ['Location', 'Sub_Location'],
  ['Sub_Location', 'Maintenance_Category'],
  ['Maintenance_Category', 'Maintenance_Object'],
  ['Maintenance_Object', 'Maintenance_Problem'],
];

export interface ClearedField {
  readonly field: string;
  readonly oldValue: string;
  /** Whether this field was a tenant-confirmed pin (true) or an unpinned value
   *  from the classifier or constraint implication (false). Determined solely
   *  from `confirmed_followup_answers` — no prior-round provenance needed. */
  readonly wasPinned: boolean;
}

export interface InvalidationResult {
  /** Fields that were cleared, in hierarchy order. */
  readonly clearedFields: readonly ClearedField[];
  /** Field names of cleared pins (subset of clearedFields where wasPinned). */
  readonly clearedPinFields: readonly string[];
  /** The earliest cleared field that was a prior pin (for contradiction prompt). */
  readonly earliestClearedPin: ClearedField | null;
}

/**
 * Get all descendant fields of a given parent in the forward maintenance hierarchy.
 * Returns fields in hierarchy order (immediate child first).
 * Exported for use in follow-up generation (finding trigger parent for a cleared field).
 */
export function getForwardDescendants(parentField: string): string[] {
  const descendants: string[] = [];
  let current = parentField;
  for (const [parent, child] of MAINTENANCE_FORWARD_CHAIN) {
    if (parent === current) {
      descendants.push(child);
      current = child;
    }
  }
  return descendants;
}

/**
 * After a parent field is confirmed to a new value, cascade-validate all
 * descendant fields in the forward hierarchy. Any descendant whose current
 * value is no longer valid under the updated ancestry is marked for clearing.
 *
 * The algorithm walks descendants in order. When a field is cleared, its
 * children are also cleared unconditionally (their validity depended on the
 * now-cleared parent).
 *
 * Source attribution is 2-way (pinned vs unpinned), determined solely from
 * `confirmed_followup_answers`. The session does not persist per-field
 * provenance for constraint-implied vs classifier values, so we do not
 * attempt to distinguish them. Unpinned values that were previously
 * constraint-implied will silently re-derive in Step C' if the new ancestry
 * still narrows to one option.
 *
 * @param changedParentField - The field that was just re-confirmed
 * @param classification - The effective classification AFTER pin overlay (Step A2)
 * @param pins - The confirmed_followup_answers for this issue (BEFORE removal)
 * @param constraints - Taxonomy constraint maps
 */
export function invalidateStaleDescendants(
  changedParentField: string,
  classification: Record<string, string>,
  pins: Readonly<Record<string, string>>,
  constraints: TaxonomyConstraints,
): InvalidationResult {
  const descendants = getForwardDescendants(changedParentField);
  if (descendants.length === 0) {
    return { clearedFields: [], clearedPinFields: [], earliestClearedPin: null };
  }

  const working = { ...classification };
  const cleared: ClearedField[] = [];
  let parentJustCleared = false;

  for (const descendant of descendants) {
    const currentValue = working[descendant];

    // Nothing to invalidate if the field is empty or vague
    if (!isConstraintResolvedValue(currentValue, { treatNeedsObjectAsUnresolved: true })) {
      // If parent was cleared, even an unresolved descendant resets the cascade flag
      // so we don't blindly clear everything below a gap
      if (parentJustCleared) {
        parentJustCleared = false;
      }
      continue;
    }

    let shouldClear = false;

    if (parentJustCleared) {
      // Immediate parent was just cleared in this pass — clear unconditionally
      shouldClear = true;
    } else {
      // Check if current value is still valid under updated ancestry
      const validOptions = resolveValidOptions(descendant, working, constraints);
      if (validOptions !== null && !validOptions.includes(currentValue)) {
        shouldClear = true;
      }
    }

    if (shouldClear) {
      const wasPinned = descendant in pins;
      cleared.push({ field: descendant, oldValue: currentValue, wasPinned });
      working[descendant] = '';
      parentJustCleared = true;
    } else {
      parentJustCleared = false;
    }
  }

  // Second pass: reverse-edge consistency check.
  // The forward pass only checks edges where the descendant is the child field.
  // Reverse edges (e.g., Maintenance_Object_to_Sub_Location) can expose
  // inconsistencies not visible in the forward direction — particularly when
  // an intermediate field is blank, causing the forward check to return null
  // (unconstrained) while the reverse edge reveals the value is invalid for
  // the updated ancestry.
  const alreadyCleared = new Set(cleared.map((c) => c.field));
  for (const descendant of descendants) {
    if (alreadyCleared.has(descendant)) continue;
    const currentValue = working[descendant];
    if (!isConstraintResolvedValue(currentValue, { treatNeedsObjectAsUnresolved: true })) continue;

    // Check reverse edges: edges where this descendant is the parent field.
    // If the descendant's value maps to an allowed-child set that excludes
    // the current classification's child value, the descendant is stale.
    const reverseEdges = CONSTRAINT_EDGES.filter((e) => e.parentField === descendant);
    let reverseInvalid = false;
    for (const edge of reverseEdges) {
      const childValue = working[edge.childField];
      if (!childValue || childValue === '') continue;
      if (!isConstraintResolvedValue(childValue, { treatNeedsObjectAsUnresolved: true })) continue;

      const map = constraints[edge.mapKey] as Record<string, readonly string[]>;
      const allowed = map[currentValue];
      if (allowed && !allowed.includes(childValue)) {
        reverseInvalid = true;
        break;
      }
    }

    if (reverseInvalid) {
      const wasPinned = descendant in pins;
      cleared.push({ field: descendant, oldValue: currentValue, wasPinned });
      working[descendant] = '';
      alreadyCleared.add(descendant);

      // Cascade-clear forward descendants of this newly cleared field.
      const subDescendants = getForwardDescendants(descendant);
      for (const sub of subDescendants) {
        if (alreadyCleared.has(sub)) continue;
        const subValue = working[sub];
        if (!isConstraintResolvedValue(subValue, { treatNeedsObjectAsUnresolved: true })) continue;
        const subWasPinned = sub in pins;
        cleared.push({ field: sub, oldValue: subValue, wasPinned: subWasPinned });
        working[sub] = '';
        alreadyCleared.add(sub);
      }
    }
  }

  const clearedPinFields = cleared.filter((c) => c.wasPinned).map((c) => c.field);
  const earliestClearedPin = cleared.find((c) => c.wasPinned) ?? null;

  return { clearedFields: cleared, clearedPinFields, earliestClearedPin };
}
