export interface RunMetrics {
  readonly metrics: Record<string, number>;
  readonly slice_metrics: Record<string, Record<string, number>>;
}

export interface RegressionItem {
  readonly metric: string;
  readonly slice: string;
  readonly baseline_value: number;
  readonly candidate_value: number;
  readonly delta: number;
}

export interface ImprovementItem {
  readonly metric: string;
  readonly slice: string;
  readonly baseline_value: number;
  readonly candidate_value: number;
  readonly delta: number;
}

export interface ComparisonReport {
  readonly regressions: readonly RegressionItem[];
  readonly improvements: readonly ImprovementItem[];
  readonly gate_passed: boolean;
}

const CRITICAL_SLICES = ['emergency', 'access', 'pest', 'ood'] as const;
const REGRESSION_THRESHOLD = 0.02; // 2% drop triggers regression

export function compareRuns(baseline: RunMetrics, candidate: RunMetrics): ComparisonReport {
  const regressions: RegressionItem[] = [];
  const improvements: ImprovementItem[] = [];

  // Compare slice metrics
  const allSlices = new Set([
    ...Object.keys(baseline.slice_metrics),
    ...Object.keys(candidate.slice_metrics),
  ]);

  for (const slice of allSlices) {
    const baseSlice = baseline.slice_metrics[slice] ?? {};
    const candSlice = candidate.slice_metrics[slice] ?? {};

    const allMetrics = new Set([
      ...Object.keys(baseSlice),
      ...Object.keys(candSlice),
    ]);

    for (const metric of allMetrics) {
      const baseValue = baseSlice[metric] ?? 0;
      const candValue = candSlice[metric] ?? 0;
      const delta = candValue - baseValue;

      if (delta < -REGRESSION_THRESHOLD) {
        regressions.push({
          metric,
          slice,
          baseline_value: baseValue,
          candidate_value: candValue,
          delta,
        });
      } else if (delta > REGRESSION_THRESHOLD) {
        improvements.push({
          metric,
          slice,
          baseline_value: baseValue,
          candidate_value: candValue,
          delta,
        });
      }
    }
  }

  // Compare top-level metrics
  const allTopMetrics = new Set([
    ...Object.keys(baseline.metrics),
    ...Object.keys(candidate.metrics),
  ]);

  for (const metric of allTopMetrics) {
    const baseValue = baseline.metrics[metric] ?? 0;
    const candValue = candidate.metrics[metric] ?? 0;
    const delta = candValue - baseValue;

    if (delta < -REGRESSION_THRESHOLD) {
      regressions.push({
        metric,
        slice: '_overall',
        baseline_value: baseValue,
        candidate_value: candValue,
        delta,
      });
    } else if (delta > REGRESSION_THRESHOLD) {
      improvements.push({
        metric,
        slice: '_overall',
        baseline_value: baseValue,
        candidate_value: candValue,
        delta,
      });
    }
  }

  // Gate: no regressions on critical slices
  const criticalSet = new Set<string>(CRITICAL_SLICES);
  const hasCriticalRegression = regressions.some((r) => criticalSet.has(r.slice));
  const gate_passed = !hasCriticalRegression;

  return { regressions, improvements, gate_passed };
}
