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

  // Validate the core EvalRun structure (metrics/slice_metrics are extra
  // fields that the schema allows via additionalProperties, or we strip
  // them for validation and re-attach after).
  const { metrics, slice_metrics, ...coreRun } = raw;
  const result = validateEvalRun(coreRun);
  if (!result.valid) {
    console.error('Run file failed EvalRun validation:');
    for (const err of result.errors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  // Require metrics to be present for a promotable baseline
  if (!metrics || typeof metrics !== 'object') {
    console.error('Run file is missing computed metrics. Re-run eval:run to produce a complete run file.');
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
  console.log(`  field_accuracy: ${metrics.field_accuracy?.toFixed(4) ?? 'N/A'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
