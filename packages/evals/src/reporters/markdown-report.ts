import type { ComparisonReport } from './compare-runs.js';

export function generateMarkdownReport(
  report: ComparisonReport,
  metadata: { baseline_id: string; candidate_id: string },
): string {
  const lines: string[] = [];

  lines.push('# Eval Comparison Report');
  lines.push('');
  lines.push(`**Baseline:** \`${metadata.baseline_id}\``);
  lines.push(`**Candidate:** \`${metadata.candidate_id}\``);
  lines.push('');
  lines.push(`**Gate:** ${report.gate_passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');

  if (report.regressions.length > 0) {
    lines.push('## Regressions');
    lines.push('');
    lines.push('| Metric | Slice | Baseline | Candidate | Delta |');
    lines.push('|--------|-------|----------|-----------|-------|');
    for (const r of report.regressions) {
      lines.push(
        `| ${r.metric} | ${r.slice} | ${r.baseline_value.toFixed(4)} | ${r.candidate_value.toFixed(4)} | ${r.delta.toFixed(4)} |`,
      );
    }
    lines.push('');
  }

  if (report.improvements.length > 0) {
    lines.push('## Improvements');
    lines.push('');
    lines.push('| Metric | Slice | Baseline | Candidate | Delta |');
    lines.push('|--------|-------|----------|-----------|-------|');
    for (const imp of report.improvements) {
      lines.push(
        `| ${imp.metric} | ${imp.slice} | ${imp.baseline_value.toFixed(4)} | ${imp.candidate_value.toFixed(4)} | ${imp.delta.toFixed(4)} |`,
      );
    }
    lines.push('');
  }

  if (report.regressions.length === 0 && report.improvements.length === 0) {
    lines.push('No significant changes detected.');
    lines.push('');
  }

  return lines.join('\n');
}
