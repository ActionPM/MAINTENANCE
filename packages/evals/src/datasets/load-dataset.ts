import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateEvalExample, validateEvalManifest } from '@wo-agent/schemas';

export class DatasetLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetLoadError';
  }
}

export interface NormalizedExample {
  readonly example_id: string;
  readonly dataset_type: string;
  readonly source_type: string;
  readonly conversation_text: string;
  readonly split_issues_expected: readonly { issue_text: string }[];
  readonly expected_classification_by_issue: readonly Record<string, string>[];
  readonly expected_missing_fields: readonly string[];
  readonly expected_followup_fields: readonly string[];
  readonly expected_needs_human_triage: boolean;
  readonly expected_risk_flags: readonly string[];
  readonly slice_tags: readonly string[];
  readonly taxonomy_version: string;
  readonly schema_version: string;
  readonly review_status: string;
  readonly reviewed_by: string;
  readonly created_at: string;
}

export interface LoadedDataset {
  readonly manifest: Record<string, unknown>;
  readonly examples: readonly NormalizedExample[];
}

export async function loadDataset(datasetDir: string): Promise<LoadedDataset> {
  if (!existsSync(datasetDir)) {
    throw new DatasetLoadError(`Dataset directory does not exist: ${datasetDir}`);
  }

  const manifestPath = resolve(datasetDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new DatasetLoadError(`Missing manifest.json in ${datasetDir}`);
  }

  const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const manifestResult = validateEvalManifest(manifestRaw);
  if (!manifestResult.valid) {
    throw new DatasetLoadError(`Invalid manifest: ${manifestResult.errors.join(', ')}`);
  }

  const jsonlFiles = readdirSync(datasetDir).filter((f) => f.endsWith('.jsonl'));
  const examples: NormalizedExample[] = [];

  for (const file of jsonlFiles) {
    const content = readFileSync(resolve(datasetDir, file), 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      const result = validateEvalExample(parsed);
      if (!result.valid) {
        throw new DatasetLoadError(
          `Invalid example ${parsed.example_id ?? 'unknown'} in ${file}: ${result.errors.join(', ')}`,
        );
      }
      examples.push(parsed as NormalizedExample);
    }
  }

  return { manifest: manifestRaw, examples };
}
