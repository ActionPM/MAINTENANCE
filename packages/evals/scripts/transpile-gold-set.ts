/**
 * One-shot script: transpile the gold-set CSV into gold-v1 dataset.
 *
 * Usage: pnpm --filter @wo-agent/evals exec tsx scripts/transpile-gold-set.ts <csv-path>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transpileCsv } from '../src/datasets/csv-transpiler.js';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: tsx scripts/transpile-gold-set.ts <path-to-csv>');
  process.exit(1);
}

const csvText = readFileSync(resolve(csvPath), 'utf-8');
const outputDir = resolve(import.meta.dirname, '..', 'datasets', 'gold-v1');

const { examples, manifest } = transpileCsv(csvText, outputDir);

console.log(`Transpiled ${examples.length} examples to ${outputDir}`);
console.log(`Manifest: ${manifest.example_count} conversations, ${manifest.description}`);
console.log(`Slice coverage:`, manifest.slice_coverage);

// Quick sanity checks
const multiIssue = examples.filter((e) => e.split_issues_expected.length > 1);
const withRiskFlags = examples.filter((e) => e.expected_risk_flags.length > 0);
console.log(`Multi-issue conversations: ${multiIssue.length}`);
console.log(`Examples with risk flags: ${withRiskFlags.length}`);
