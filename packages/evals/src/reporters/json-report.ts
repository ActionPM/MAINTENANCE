export interface JsonReportOptions {
  readonly report_id: string;
  readonly baseline_run_id: string;
  readonly candidate_run_id: string;
  readonly metrics: Record<string, unknown>;
  readonly slice_metrics: Record<string, unknown>;
  readonly regressions: readonly unknown[];
  readonly improvements: readonly unknown[];
}

export function generateJsonReport(opts: JsonReportOptions): string {
  const report = {
    report_id: opts.report_id,
    baseline_run_id: opts.baseline_run_id,
    candidate_run_id: opts.candidate_run_id,
    metrics: opts.metrics,
    slice_metrics: opts.slice_metrics,
    regressions: opts.regressions,
    improvements: opts.improvements,
    created_at: new Date().toISOString(),
  };
  return JSON.stringify(report, null, 2);
}
