#!/usr/bin/env node
/**
 * Usage: pnpm eval:update-baseline --run-file <path-to-run.json>
 *
 * Reads an EvalRun JSON file (as emitted by eval:run) and promotes it
 * as the baseline for its dataset. Validates structural fields against
 * eval_run.schema.json before saving.
 *
 * The baseline file retains the metrics and slice_metrics fields so that
 * subsequent eval:run invocations can compare against it.
 */
import { validateEvalRun } from '@wo-agent/schemas';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const args = process.argv.slice(2);
  const runFileIdx = args.indexOf('--run-file');
  if (runFileIdx === -1 || !args[runFileIdx + 1]) {
    console.error('Usage: pnpm eval:update-baseline --run-file <path>');
    process.exit(1);
  }

  const runFilePath = args[runFileIdx + 1];
  if (!fs.existsSync(runFilePath)) {
    console.error(`File not found: ${runFilePath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(runFilePath, 'utf-8'));

  // Validate the full EvalRun structure (metrics/slice_metrics are now
  // declared in the schema as optional properties).
  const result = validateEvalRun(raw);
  if (!result.valid) {
    console.error('Run file failed EvalRun validation:');
    for (const err of result.errors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  // Require metrics AND slice_metrics to be present for a promotable baseline.
  // Without slice_metrics the gate cannot enforce critical-slice comparisons.
  if (!raw.metrics || typeof raw.metrics !== 'object') {
    console.error(
      'Run file is missing computed metrics. Re-run eval:run to produce a complete run file.',
    );
    process.exit(1);
  }
  if (
    !raw.slice_metrics ||
    typeof raw.slice_metrics !== 'object' ||
    Object.keys(raw.slice_metrics).length === 0
  ) {
    console.error(
      'Run file is missing slice_metrics. Re-run eval:run to produce a complete run file.',
    );
    process.exit(1);
  }

  const baselinesDir = path.resolve(import.meta.dirname ?? '.', '../../baselines');
  fs.mkdirSync(baselinesDir, { recursive: true });

  const datasetId = raw.dataset_manifest_id ?? 'unknown';
  const destPath = path.join(baselinesDir, `${datasetId}-baseline.json`);
  fs.writeFileSync(destPath, JSON.stringify(raw, null, 2));

  console.log(`Baseline promoted: ${destPath}`);
  console.log(`  run_id: ${raw.run_id}`);
  console.log(`  dataset: ${datasetId}`);
  console.log(`  field_accuracy: ${raw.metrics.field_accuracy?.toFixed(4) ?? 'N/A'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
