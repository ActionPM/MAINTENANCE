#!/usr/bin/env node
/**
 * Usage: pnpm eval:update-baseline --run-file <path-to-run.json>
 *
 * Reads an EvalRun JSON file and copies it to packages/evals/baselines/.
 * Validates the run against eval_run.schema.json before saving.
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
  const raw = JSON.parse(fs.readFileSync(runFilePath, 'utf-8'));

  const result = validateEvalRun(raw);
  if (!result.valid) {
    console.error('Run file failed validation:', result.errors);
    process.exit(1);
  }

  const baselinesDir = path.resolve(import.meta.dirname ?? '.', '../../baselines');
  fs.mkdirSync(baselinesDir, { recursive: true });

  const datasetId = (raw as Record<string, unknown>).dataset_manifest_id as string ?? 'unknown';
  const destPath = path.join(baselinesDir, `${datasetId}-baseline.json`);
  fs.writeFileSync(destPath, JSON.stringify(raw, null, 2));

  console.log(`Baseline saved to ${destPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
