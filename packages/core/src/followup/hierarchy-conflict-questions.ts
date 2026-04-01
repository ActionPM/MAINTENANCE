import type { TaxonomyConstraints } from '@wo-agent/schemas';
import type { FollowUpQuestion } from '@wo-agent/schemas';
import { resolveValidOptions } from '../classifier/constraint-resolver.js';
import type { ClearedField } from '../classifier/descendant-invalidation.js';

/** Human-readable labels for taxonomy field names. */
const FIELD_LABELS: Record<string, string> = {
  Sub_Location: 'location in the unit',
  Maintenance_Category: 'type of maintenance issue',
  Maintenance_Object: 'specific fixture or item',
  Maintenance_Problem: 'problem',
};

function formatValue(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Build a deterministic follow-up question for a hierarchy-invalidated field
 * that was previously pinned by the tenant.
 *
 * Returns null if the cleared field was not a pin (unpinned values are handled
 * by the normal follow-up pipeline after re-entering fieldsNeedingInput).
 *
 * @param cleared - The cleared field info (from invalidation result)
 * @param parentField - The parent field that changed
 * @param parentValue - The new parent value
 * @param classification - Current effective classification (after clearing)
 * @param constraints - Taxonomy constraint maps
 * @param idGenerator - ID generator function
 */
export function buildHierarchyConflictQuestion(
  cleared: ClearedField,
  parentField: string,
  parentValue: string,
  classification: Record<string, string>,
  constraints: TaxonomyConstraints,
  idGenerator: () => string,
): FollowUpQuestion | null {
  // Only build contradiction prompts for stale pins
  if (!cleared.wasPinned) return null;

  const validOptions = resolveValidOptions(cleared.field, classification, constraints);
  if (!validOptions || validOptions.length === 0) return null;

  const fieldLabel = FIELD_LABELS[cleared.field] ?? formatValue(cleared.field);
  const oldLabel = formatValue(cleared.oldValue);
  const parentLabel = formatValue(parentValue);

  return {
    question_id: idGenerator(),
    field_target: cleared.field,
    prompt: `You previously mentioned "${oldLabel}", but that doesn't apply for "${parentLabel}". Which ${fieldLabel} applies instead?`,
    options: validOptions.slice(0, 10), // cap at 10 to match existing constraint hint behavior
    answer_type: 'enum' as const,
  };
}
