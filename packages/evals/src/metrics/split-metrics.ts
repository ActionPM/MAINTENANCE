export function computeSplitCountAccuracy(
  pairs: readonly { predicted: number; expected: number }[],
): number {
  if (pairs.length === 0) return 0;
  const correct = pairs.filter((p) => p.predicted === p.expected).length;
  return correct / pairs.length;
}

/**
 * Compute token-overlap F1 between predicted and expected issue text sets.
 * Uses greedy best-match pairing for multi-issue cases.
 */
export function computeIssueBoundaryF1(pair: {
  predicted: readonly string[];
  expected: readonly string[];
}): number {
  if (pair.expected.length === 0 && pair.predicted.length === 0) return 1.0;
  if (pair.expected.length === 0 || pair.predicted.length === 0) return 0;

  // Tokenize by splitting on whitespace and lowercasing
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\s+/).filter(Boolean));

  // Compute F1 between two token sets
  const tokenF1 = (a: Set<string>, b: Set<string>): number => {
    const overlap = [...a].filter((t) => b.has(t)).length;
    if (overlap === 0) return 0;
    const precision = overlap / a.size;
    const recall = overlap / b.size;
    return (2 * precision * recall) / (precision + recall);
  };

  // Greedy best-match pairing
  const predTokens = pair.predicted.map(tokenize);
  const expTokens = pair.expected.map(tokenize);
  const used = new Set<number>();
  let totalF1 = 0;

  for (const pt of predTokens) {
    let bestF1 = 0;
    let bestIdx = -1;
    for (let i = 0; i < expTokens.length; i++) {
      if (used.has(i)) continue;
      const f1 = tokenF1(pt, expTokens[i]);
      if (f1 > bestF1) {
        bestF1 = f1;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      totalF1 += bestF1;
    }
  }

  // Average over max(predicted, expected) to penalize both missed and extra splits
  return totalF1 / Math.max(pair.predicted.length, pair.expected.length);
}
