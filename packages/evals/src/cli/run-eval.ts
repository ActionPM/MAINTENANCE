#!/usr/bin/env node
/**
 * Usage: pnpm eval:run --dataset gold [--adapter fixture] [--baseline <path>]
 *
 * Loads dataset, runs issue-level replay, computes metrics per-slice,
 * compares against baseline (if provided or auto-discovered), and writes
 * both an EvalRun JSON and a comparison report.
 *
 * Exit code 1 = gate failed (critical-slice regression or blocking-rate increase).
 */
import { CUE_VERSION, PROMPT_VERSION } from '@wo-agent/schemas';
import { DEFAULT_MODEL_ID } from '@wo-agent/schemas';
import { loadDataset } from '../datasets/load-dataset.js';
import type { NormalizedExample } from '../datasets/load-dataset.js';
import { runIssueReplay } from '../runners/issue-replay.js';
import type { IssueReplayResult } from '../runners/issue-replay.js';
import {
  AnthropicClassifierAdapter,
  FixtureClassifierAdapter,
} from '../runners/classifier-adapters.js';
import type { ClassifierAdapterOutput } from '../runners/classifier-adapters.js';
import {
  computeOverallFieldAccuracy,
  computeSchemaInvalidRate,
  computeTaxonomyInvalidRate,
  computeContradictionAfterRetryRate,
} from '../metrics/field-metrics.js';
import { computeFollowupPrecision, computeFollowupRecall } from '../metrics/followup-metrics.js';
import {
  CRITICAL_SLICES,
  TAXONOMY_SLICES,
  INPUT_QUALITY_SLICES,
  filterBySlice,
} from '../metrics/slices.js';
import type { SliceDefinition } from '../metrics/slices.js';
import { compareRuns } from '../reporters/compare-runs.js';
import type { RunMetrics } from '../reporters/compare-runs.js';
import { generateMarkdownReport } from '../reporters/markdown-report.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function parseArgs(argv: string[]): {
  dataset: string;
  adapter: string;
  baseline: string | undefined;
} {
  const datasetIdx = argv.indexOf('--dataset');
  const adapterIdx = argv.indexOf('--adapter');
  const baselineIdx = argv.indexOf('--baseline');

  const dataset = datasetIdx !== -1 ? argv[datasetIdx + 1] : undefined;
  const adapter = adapterIdx !== -1 ? argv[adapterIdx + 1] : 'fixture';
  const baseline = baselineIdx !== -1 ? argv[baselineIdx + 1] : undefined;

  if (!dataset) {
    console.error(
      'Usage: pnpm eval:run --dataset <name> [--adapter fixture|anthropic] [--baseline <path>]',
    );
    process.exit(1);
  }

  return { dataset, adapter, baseline };
}

function loadLocalEnvFiles(repoRoot: string): void {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(repoRoot, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = /^([\w.-]+)\s*=\s*(.*)$/.exec(trimmed);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (process.env[key] != null) {
        continue;
      }

      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

/**
 * Compute all metrics for a subset of results matched to examples.
 */
function _computeMetricsForResults(results: readonly IssueReplayResult[]): Record<string, number> {
  const fieldPairs = results
    .filter((r) => r.status === 'ok' && r.classification)
    .map((r) => ({ predicted: r.classification!, expected: {} as Record<string, string> }));

  const statuses = results.map((r) => r.status);

  return {
    field_accuracy: fieldPairs.length > 0 ? computeOverallFieldAccuracy(fieldPairs) : 0,
    schema_invalid_rate: computeSchemaInvalidRate(statuses),
    taxonomy_invalid_rate: computeTaxonomyInvalidRate(statuses),
    needs_human_triage_rate:
      statuses.filter((s) => s === 'needs_human_triage').length / Math.max(statuses.length, 1),
    example_count: results.length,
  };
}

/**
 * Group replay results by example, then compute per-slice metrics.
 */
function computeSliceMetrics(
  examples: readonly NormalizedExample[],
  resultsByExampleId: Map<string, IssueReplayResult[]>,
): Record<string, Record<string, number>> {
  const allSlices: readonly SliceDefinition[] = [
    ...CRITICAL_SLICES,
    ...TAXONOMY_SLICES,
    ...INPUT_QUALITY_SLICES,
  ];

  const sliceMetrics: Record<string, Record<string, number>> = {};

  for (const slice of allSlices) {
    const matchedExamples = filterBySlice(
      examples as (NormalizedExample & { slice_tags: readonly string[] })[],
      slice,
    );
    if (matchedExamples.length === 0) continue;

    const sliceResults: IssueReplayResult[] = [];
    for (const ex of matchedExamples) {
      const results = resultsByExampleId.get(ex.example_id);
      if (results) sliceResults.push(...results);
    }

    if (sliceResults.length === 0) continue;

    // Compute field accuracy using expected classifications from the matched examples
    const fieldPairs: { predicted: Record<string, string>; expected: Record<string, string> }[] =
      [];
    for (const ex of matchedExamples) {
      const results = resultsByExampleId.get(ex.example_id);
      if (!results) continue;
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'ok' && results[i].classification) {
          fieldPairs.push({
            predicted: results[i].classification!,
            expected: ex.expected_classification_by_issue[i] ?? {},
          });
        }
      }
    }

    // Build follow-up comparison pairs
    const followupPairs: {
      predicted_followup_fields: string[];
      expected_followup_fields: string[];
    }[] = [];
    for (const ex of matchedExamples) {
      const exResults = resultsByExampleId.get(ex.example_id);
      if (!exResults) continue;
      // Predicted: fields needing input (from confidence + completeness gate)
      const predictedFields = exResults
        .filter((r) => r.status === 'ok' && r.fieldsNeedingInput)
        .flatMap((r) => r.fieldsNeedingInput ?? []);
      followupPairs.push({
        predicted_followup_fields: predictedFields,
        expected_followup_fields: [...(ex.expected_followup_fields ?? [])],
      });
    }

    const statuses = sliceResults.map((r) => r.status);
    sliceMetrics[slice.name] = {
      field_accuracy: fieldPairs.length > 0 ? computeOverallFieldAccuracy(fieldPairs) : 0,
      schema_invalid_rate: computeSchemaInvalidRate(statuses),
      taxonomy_invalid_rate: computeTaxonomyInvalidRate(statuses),
      contradiction_after_retry_rate: computeContradictionAfterRetryRate(sliceResults),
      followup_precision: computeFollowupPrecision(followupPairs),
      followup_recall: computeFollowupRecall(followupPairs),
      example_count: sliceResults.length,
    };
  }

  return sliceMetrics;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evalsRoot = path.resolve(import.meta.dirname ?? '.', '../..');
  const repoRoot = path.resolve(evalsRoot, '../..');
  loadLocalEnvFiles(repoRoot);
  const datasetDir = path.resolve(evalsRoot, 'datasets', args.dataset);

  console.log(`Loading dataset from ${datasetDir}...`);
  const { manifest, examples } = await loadDataset(datasetDir);

  const taxonomyVersion =
    ((manifest as Record<string, unknown>).taxonomy_version as string) ?? '2.0.0';
  const manifestId = ((manifest as Record<string, unknown>).manifest_id as string) ?? args.dataset;

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

  let classifierAdapter;
  if (args.adapter === 'fixture') {
    classifierAdapter = new FixtureClassifierAdapter(fixtureMap);
  } else if (args.adapter === 'anthropic') {
    classifierAdapter = new AnthropicClassifierAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
      taxonomyVersion,
      modelId: process.env.LLM_DEFAULT_MODEL ?? DEFAULT_MODEL_ID,
      promptVersion: PROMPT_VERSION,
      cueVersion: CUE_VERSION,
    });
  } else {
    throw new Error(`Unknown adapter "${args.adapter}". Expected "fixture" or "anthropic".`);
  }

  console.log(`Running replay for ${examples.length} examples...`);
  const resultsByExampleId = new Map<string, IssueReplayResult[]>();
  const allResults: IssueReplayResult[] = [];
  const fieldPairs: { predicted: Record<string, string>; expected: Record<string, string> }[] = [];

  for (const ex of examples) {
    const exResults: IssueReplayResult[] = [];
    for (let i = 0; i < ex.split_issues_expected.length; i++) {
      const result = await runIssueReplay({
        example_id: ex.example_id,
        issue_index: i,
        issue_text: ex.split_issues_expected[i].issue_text,
        expected_classification: ex.expected_classification_by_issue[i] ?? {},
        classifierAdapter,
        taxonomyVersion,
      });
      exResults.push(result);
      allResults.push(result);

      if (result.classification) {
        fieldPairs.push({
          predicted: result.classification,
          expected: ex.expected_classification_by_issue[i] ?? {},
        });
      }
    }
    resultsByExampleId.set(ex.example_id, exResults);
  }

  // Compute top-level metrics
  const statuses = allResults.map((r) => r.status);
  const topMetrics: Record<string, number> = {
    field_accuracy: computeOverallFieldAccuracy(fieldPairs),
    schema_invalid_rate: computeSchemaInvalidRate(statuses),
    taxonomy_invalid_rate: computeTaxonomyInvalidRate(statuses),
    contradiction_after_retry_rate: computeContradictionAfterRetryRate(allResults),
    needs_human_triage_rate:
      statuses.filter((s) => s === 'needs_human_triage').length / Math.max(statuses.length, 1),
    total_examples: examples.length,
    total_results: allResults.length,
  };

  // Compute per-slice metrics
  const sliceMetrics = computeSliceMetrics(examples, resultsByExampleId);

  // Build EvalRun
  const runId = `run-${Date.now()}`;
  const now = new Date().toISOString();
  const evalRun = {
    run_id: runId,
    runner_type: 'issue_level',
    dataset_manifest_id: manifestId,
    taxonomy_version: taxonomyVersion,
    schema_version: '1.0.0',
    cue_dict_version: CUE_VERSION,
    prompt_version:
      args.adapter === 'fixture' ? `fixture-replay (${PROMPT_VERSION})` : PROMPT_VERSION,
    model_id:
      args.adapter === 'fixture' ? 'fixture' : (process.env.LLM_DEFAULT_MODEL ?? DEFAULT_MODEL_ID),
    started_at: now,
    completed_at: now,
    results: allResults.map((r) => ({
      example_id: r.example_id,
      status: r.status,
      classification: r.classification,
      confidenceByField: r.confidenceByField,
      confidenceComponents: r.confidenceComponents,
      fieldsNeedingInput: r.fieldsNeedingInput,
      hierarchyValid: r.hierarchyValid,
      errors: r.errors,
    })),
    // Extended fields for comparison (not in eval_run schema but useful for baseline)
    metrics: topMetrics,
    slice_metrics: sliceMetrics,
  };

  // Write EvalRun
  const outputDir = path.resolve(evalsRoot, 'baselines');
  fs.mkdirSync(outputDir, { recursive: true });
  const runPath = path.join(outputDir, `${args.dataset}-run-${Date.now()}.json`);
  fs.writeFileSync(runPath, JSON.stringify(evalRun, null, 2));
  console.log(`EvalRun written to ${runPath}`);

  // Baseline comparison — adapter-aware baseline selection.
  // Provider (anthropic) runs compare against provider baselines, not fixture baselines.
  // This prevents conflating LLM variance with pipeline regression.
  const baselinePath =
    args.baseline ??
    (args.adapter !== 'fixture'
      ? // Prefer adapter-specific baseline, fall back to manifest default
        fs.existsSync(path.join(outputDir, `${args.dataset}-${args.adapter}-baseline.json`))
        ? path.join(outputDir, `${args.dataset}-${args.adapter}-baseline.json`)
        : path.join(outputDir, `${manifestId}-baseline.json`)
      : path.join(outputDir, `${manifestId}-baseline.json`));
  let gatePassed = true;

  if (fs.existsSync(baselinePath)) {
    console.log(`Comparing against baseline: ${baselinePath}`);
    const baselineRaw = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    const baselineMetrics: RunMetrics = {
      metrics: baselineRaw.metrics ?? {},
      slice_metrics: baselineRaw.slice_metrics ?? {},
    };
    const candidateMetrics: RunMetrics = {
      metrics: topMetrics,
      slice_metrics: sliceMetrics,
    };

    const comparison = compareRuns(baselineMetrics, candidateMetrics);
    gatePassed = comparison.gate_passed;

    const markdown = generateMarkdownReport(comparison, {
      baseline_id: baselineRaw.run_id ?? 'unknown',
      candidate_id: runId,
    });
    console.log('\n' + markdown);

    // Write comparison report
    const reportPath = path.join(outputDir, `${args.dataset}-comparison-${Date.now()}.md`);
    fs.writeFileSync(reportPath, markdown);
    console.log(`Comparison report written to ${reportPath}`);
  } else {
    console.log(
      'No baseline found — skipping comparison. Run eval:update-baseline to promote this run.',
    );
  }

  // Summary
  console.log('\n--- Metrics Summary ---');
  for (const [k, v] of Object.entries(topMetrics)) {
    console.log(`  ${k}: ${typeof v === 'number' ? v.toFixed(4) : v}`);
  }
  if (Object.keys(sliceMetrics).length > 0) {
    console.log('\n--- Slice Metrics ---');
    for (const [slice, metrics] of Object.entries(sliceMetrics)) {
      const fa = metrics.field_accuracy?.toFixed(4) ?? 'N/A';
      console.log(`  ${slice}: field_accuracy=${fa}, count=${metrics.example_count}`);
    }
  }

  console.log(`\nEval run complete. Gate: ${gatePassed ? 'PASSED' : 'FAILED'}`);
  if (!gatePassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
