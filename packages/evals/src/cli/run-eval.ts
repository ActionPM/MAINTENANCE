#!/usr/bin/env node
/**
 * Usage: pnpm eval:run --dataset gold --adapter fixture
 *
 * Loads dataset, runs issue-level replay, computes metrics,
 * compares against baseline (if exists), writes report.
 */
import { loadDataset } from '../datasets/load-dataset.js';
import { runIssueReplay } from '../runners/issue-replay.js';
import { FixtureClassifierAdapter } from '../runners/classifier-adapters.js';
import type { ClassifierAdapterOutput } from '../runners/classifier-adapters.js';
import {
  computeOverallFieldAccuracy,
  computeSchemaInvalidRate,
  computeTaxonomyInvalidRate,
} from '../metrics/field-metrics.js';
import { generateJsonReport } from '../reporters/json-report.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function parseArgs(argv: string[]): { dataset: string; adapter: string } {
  const datasetIdx = argv.indexOf('--dataset');
  const adapterIdx = argv.indexOf('--adapter');

  const dataset = datasetIdx !== -1 ? argv[datasetIdx + 1] : undefined;
  const adapter = adapterIdx !== -1 ? argv[adapterIdx + 1] : 'fixture';

  if (!dataset) {
    console.error('Usage: pnpm eval:run --dataset <name> [--adapter fixture]');
    process.exit(1);
  }

  return { dataset, adapter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evalsRoot = path.resolve(import.meta.dirname ?? '.', '../..');
  const datasetDir = path.resolve(evalsRoot, 'datasets', args.dataset);

  console.log(`Loading dataset from ${datasetDir}...`);
  const { manifest, examples } = await loadDataset(datasetDir);

  const taxonomyVersion = (manifest as Record<string, unknown>).taxonomy_version as string ?? '2.0';
  const datasetId = (manifest as Record<string, unknown>).dataset_id as string ?? args.dataset;

  // Build fixture map if using fixture adapter
  const fixtureMap: Record<string, ClassifierAdapterOutput> = {};
  if (args.adapter === 'fixture') {
    for (const ex of examples) {
      for (let i = 0; i < ex.split_issues_expected.length; i++) {
        const issueId = `${ex.example_id}-issue-${i}`;
        fixtureMap[issueId] = {
          classification: ex.expected_classification_by_issue[i] ?? {},
          model_confidence: {},
          missing_fields: [...ex.expected_missing_fields],
          needs_human_triage: ex.expected_needs_human_triage,
        };
      }
    }
  }

  const classifierAdapter = new FixtureClassifierAdapter(fixtureMap);

  console.log(`Running replay for ${examples.length} examples...`);
  const results = [];
  const fieldPairs = [];
  const statuses: string[] = [];

  for (const ex of examples) {
    for (let i = 0; i < ex.split_issues_expected.length; i++) {
      const result = await runIssueReplay({
        example_id: ex.example_id,
        issue_index: i,
        issue_text: ex.split_issues_expected[i].issue_text,
        expected_classification: ex.expected_classification_by_issue[i] ?? {},
        classifierAdapter,
        taxonomyVersion,
      });
      results.push(result);
      statuses.push(result.status);

      if (result.classification) {
        fieldPairs.push({
          predicted: result.classification,
          expected: ex.expected_classification_by_issue[i] ?? {},
        });
      }
    }
  }

  // Compute metrics
  const fieldAccuracy = computeOverallFieldAccuracy(fieldPairs);
  const schemaInvalidRate = computeSchemaInvalidRate(statuses);
  const taxonomyInvalidRate = computeTaxonomyInvalidRate(statuses);

  const runId = `run-${Date.now()}`;
  const reportJson = generateJsonReport({
    report_id: `report-${Date.now()}`,
    baseline_run_id: 'none',
    candidate_run_id: runId,
    metrics: {
      field_accuracy: fieldAccuracy,
      schema_invalid_rate: schemaInvalidRate,
      taxonomy_invalid_rate: taxonomyInvalidRate,
      total_examples: examples.length,
      total_results: results.length,
    },
    slice_metrics: {},
    regressions: [],
    improvements: [],
  });

  // Write report
  const outputDir = path.resolve(evalsRoot, 'baselines');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${datasetId}-run-${Date.now()}.json`);
  fs.writeFileSync(outputPath, reportJson);

  console.log(`Report written to ${outputPath}`);
  console.log(`  field_accuracy: ${fieldAccuracy.toFixed(4)}`);
  console.log(`  schema_invalid_rate: ${schemaInvalidRate.toFixed(4)}`);
  console.log(`  taxonomy_invalid_rate: ${taxonomyInvalidRate.toFixed(4)}`);
  console.log('Eval run complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
