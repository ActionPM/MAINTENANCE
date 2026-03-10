/**
 * Full taxonomy path accuracy — the entire classification path must match exactly.
 */
export function computeFullPathAccuracy(
  pairs: readonly { predicted: Record<string, string>; expected: Record<string, string> }[],
): number {
  if (pairs.length === 0) return 0;
  let correct = 0;
  for (const { predicted, expected } of pairs) {
    const allMatch = Object.entries(expected).every(
      ([field, value]) => predicted[field] === value,
    );
    if (allMatch) correct++;
  }
  return correct / pairs.length;
}
