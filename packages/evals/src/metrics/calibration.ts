/**
 * Brier score: mean squared error between confidence and correctness.
 * Lower is better (0 = perfect calibration).
 */
export function computeBrierScore(
  pairs: readonly { confidence: number; correct: boolean }[],
): number {
  if (pairs.length === 0) return 0;
  let sum = 0;
  for (const { confidence, correct } of pairs) {
    const outcome = correct ? 1 : 0;
    sum += (confidence - outcome) ** 2;
  }
  return sum / pairs.length;
}

/**
 * Expected calibration error: divide confidences into bins,
 * compute |accuracy - confidence| per bin, weighted by bin size.
 */
export function computeExpectedCalibrationError(
  pairs: readonly { confidence: number; correct: boolean }[],
  numBins = 10,
): number {
  if (pairs.length === 0) return 0;

  const bins: { correct: number; total: number; confSum: number }[] = Array.from(
    { length: numBins },
    () => ({ correct: 0, total: 0, confSum: 0 }),
  );

  for (const { confidence, correct } of pairs) {
    const binIdx = Math.min(Math.floor(confidence * numBins), numBins - 1);
    bins[binIdx].total++;
    bins[binIdx].confSum += confidence;
    if (correct) bins[binIdx].correct++;
  }

  let ece = 0;
  for (const bin of bins) {
    if (bin.total === 0) continue;
    const accuracy = bin.correct / bin.total;
    const avgConf = bin.confSum / bin.total;
    ece += (bin.total / pairs.length) * Math.abs(accuracy - avgConf);
  }

  return ece;
}
