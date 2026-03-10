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

/** Must match CRITICAL_SLICES names in metrics/slices.ts and governance doc §6. */
const CRITICAL_SLICES = ['emergency', 'building_access', 'pest_control', 'ood'] as const;
const REGRESSION_THRESHOLD = 0.02; // 2% drop triggers regression

/**
 * Rate metrics where ANY increase (above threshold) blocks merge,
 * regardless of which slice they appear on (governance doc §6).
 * These have inverted polarity: higher value = worse.
 */
const INVERTED_METRICS = new Set([
  'schema_invalid_rate',
  'taxonomy_invalid_rate',
  'contradiction_after_retry_rate',
  'needs_human_triage_rate',
]);

/**
 * Subset of INVERTED_METRICS that block the gate on any increase.
 */
const BLOCKING_RATE_METRICS = new Set([
  'schema_invalid_rate',
  'taxonomy_invalid_rate',
  'contradiction_after_retry_rate',
]);

/**
 * Classify a delta as regression, improvement, or neutral.
 * For inverted metrics (rates where higher = worse), a positive delta is a regression.
 * For normal metrics (accuracy where higher = better), a negative delta is a regression.
 */
function classifyDelta(
  metric: string,
  delta: number,
  threshold: number,
): 'regression' | 'improvement' | 'neutral' {
  const inverted = INVERTED_METRICS.has(metric);

  // Blocking rate metrics use zero tolerance: any increase is a regression
  // per governance doc §6 ("any increase blocks merge").
  const effectiveThreshold = BLOCKING_RATE_METRICS.has(metric) ? 0 : threshold;
  const absDelta = Math.abs(delta);
  if (absDelta <= effectiveThreshold) return 'neutral';

  if (inverted) {
    // Higher = worse: positive delta = regression, negative delta = improvement
    return delta > 0 ? 'regression' : 'improvement';
  }
  // Higher = better: negative delta = regression, positive delta = improvement
  return delta < 0 ? 'regression' : 'improvement';
}

const CRITICAL_SLICE_SET = new Set<string>(CRITICAL_SLICES);

function compareMetricSet(
  baseMetrics: Record<string, number>,
  candMetrics: Record<string, number>,
  slice: string,
  regressions: RegressionItem[],
  improvements: ImprovementItem[],
): void {
  // Critical slices use zero threshold: any regression blocks merge
  // per governance doc §6 ("any regression on critical slices blocks merge").
  const threshold = CRITICAL_SLICE_SET.has(slice) ? 0 : REGRESSION_THRESHOLD;

  const allMetrics = new Set([
    ...Object.keys(baseMetrics),
    ...Object.keys(candMetrics),
  ]);

  for (const metric of allMetrics) {
    const baseValue = baseMetrics[metric] ?? 0;
    const candValue = candMetrics[metric] ?? 0;
    const delta = candValue - baseValue;
    const kind = classifyDelta(metric, delta, threshold);

    if (kind === 'regression') {
      regressions.push({ metric, slice, baseline_value: baseValue, candidate_value: candValue, delta });
    } else if (kind === 'improvement') {
      improvements.push({ metric, slice, baseline_value: baseValue, candidate_value: candValue, delta });
    }
  }
}

export function compareRuns(baseline: RunMetrics, candidate: RunMetrics): ComparisonReport {
  const regressions: RegressionItem[] = [];
  const improvements: ImprovementItem[] = [];

  // Compare slice metrics
  const allSlices = new Set([
    ...Object.keys(baseline.slice_metrics),
    ...Object.keys(candidate.slice_metrics),
  ]);

  for (const slice of allSlices) {
    compareMetricSet(
      baseline.slice_metrics[slice] ?? {},
      candidate.slice_metrics[slice] ?? {},
      slice,
      regressions,
      improvements,
    );
  }

  // Compare top-level metrics
  compareMetricSet(baseline.metrics, candidate.metrics, '_overall', regressions, improvements);

  // Gate rule 1: no regressions on critical slices
  const criticalSet = new Set<string>(CRITICAL_SLICES);
  const hasCriticalSliceRegression = regressions.some((r) => criticalSet.has(r.slice));

  // Gate rule 2: no increases in blocking rate metrics (any slice or _overall)
  const hasBlockingRateIncrease = regressions.some((r) => BLOCKING_RATE_METRICS.has(r.metric));

  const gate_passed = !hasCriticalSliceRegression && !hasBlockingRateIncrease;

  return { regressions, improvements, gate_passed };
}
