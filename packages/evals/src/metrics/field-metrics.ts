export interface FieldComparisonInput {
  readonly predicted: Record<string, string>;
  readonly expected: Record<string, string>;
}

/**
 * Per-field exact match accuracy across all examples.
 * Returns a map of field name to accuracy (0..1).
 */
export function computePerFieldAccuracy(
  pairs: readonly FieldComparisonInput[],
): Record<string, number> {
  if (pairs.length === 0) return {};

  const fieldCounts: Record<string, { correct: number; total: number }> = {};

  for (const { predicted, expected } of pairs) {
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (!fieldCounts[field]) fieldCounts[field] = { correct: 0, total: 0 };
      fieldCounts[field].total++;
      if (predicted[field] === expectedValue) {
        fieldCounts[field].correct++;
      }
    }
  }

  const result: Record<string, number> = {};
  for (const [field, counts] of Object.entries(fieldCounts)) {
    result[field] = counts.total > 0 ? counts.correct / counts.total : 0;
  }
  return result;
}

/**
 * Overall field accuracy — average of per-field accuracies.
 */
export function computeOverallFieldAccuracy(
  pairs: readonly FieldComparisonInput[],
): number {
  const perField = computePerFieldAccuracy(pairs);
  const values = Object.values(perField);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Schema-invalid rate: proportion of results with status !== 'ok'.
 */
export function computeSchemaInvalidRate(
  statuses: readonly string[],
): number {
  if (statuses.length === 0) return 0;
  const invalid = statuses.filter(s => s === 'schema_fail').length;
  return invalid / statuses.length;
}

/**
 * Taxonomy-invalid rate: proportion of results with taxonomy_fail status.
 */
export function computeTaxonomyInvalidRate(
  statuses: readonly string[],
): number {
  if (statuses.length === 0) return 0;
  const invalid = statuses.filter(s => s === 'taxonomy_fail').length;
  return invalid / statuses.length;
}
