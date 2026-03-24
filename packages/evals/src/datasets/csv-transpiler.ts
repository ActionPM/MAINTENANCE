/**
 * CSV-to-JSONL transpiler for gold-set data.
 *
 * Converts the 214-row gold-set CSV into NormalizedExample JSONL format
 * compatible with loadDataset(). Groups rows by source_message_id to
 * reconstruct multi-issue conversations.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NormalizedExample } from './load-dataset.js';

/** Column names in the gold-set CSV (row 2 = header). */
const TAXONOMY_FIELDS = [
  'Category',
  'Location',
  'Sub_Location',
  'Maintenance_Category',
  'Maintenance_Object',
  'Maintenance_Problem',
  'Management_Category',
  'Management_Object',
  'Priority',
] as const;

const EVAL_ONLY_COLUMNS = new Set([
  'gold_rationale',
  'evidence_notes',
  'ambiguity_notes',
  'reporting_risk',
  'review_status',
  'reviewer',
  'Confidence_Score',
  'Confidence_Flag',
]);

/** Named taxonomy version → semver mapping table. */
const NAMED_VERSION_MAP: Record<string, string> = {
  maintenance_taxonomy_v1: '1.0.0',
};

/** Value normalization for taxonomy fields during ingest. */
const VALUE_NORMALIZATION: Record<string, Record<string, string>> = {
  Maintenance_Category: {
    other_issue: 'other_maintenance_category',
  },
};

export interface GoldSetRow {
  readonly record_id: string;
  readonly source_message_id: string;
  readonly raw_intake: string;
  readonly atomic_issue: string;
  readonly Category: string;
  readonly Location: string;
  readonly Sub_Location: string;
  readonly Maintenance_Category: string;
  readonly Maintenance_Object: string;
  readonly Maintenance_Problem: string;
  readonly Management_Category: string;
  readonly Management_Object: string;
  readonly Priority: string;
  readonly should_ask_followup: string;
  readonly followup_type: string;
  readonly taxonomy_version: string;
  readonly emergency: string;
  readonly safety_flag: string;
  readonly [key: string]: string;
}

export interface TranspilerManifest {
  readonly manifest_id: string;
  readonly dataset_type: string;
  readonly taxonomy_version: string;
  readonly schema_version: string;
  readonly example_count: number;
  readonly slice_coverage: Record<string, number>;
  readonly created_at: string;
  readonly description: string;
  readonly policy_overrides: readonly string[];
}

/**
 * Parse CSV text into rows, handling quoted fields and multiline values.
 * Skips row 1 (title) and uses row 2 as column headers. Data starts at row 3.
 */
export function parseCsv(csvText: string): GoldSetRow[] {
  const lines = splitCsvLines(csvText);
  if (lines.length < 3) {
    throw new Error('CSV must have at least a title row, header row, and one data row');
  }

  // Row 1 = title (skip), Row 2 = headers
  const headers = parseCsvLine(lines[1]);
  const rows: GoldSetRow[] = [];

  for (let i = 2; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0].trim() === '')) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] ?? '').trim();
    }
    rows.push(row as unknown as GoldSetRow);
  }

  return rows;
}

/**
 * Split CSV text into logical lines, handling quoted fields that span
 * multiple physical lines.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuote = false;

  for (const char of text) {
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
    } else if (char === '\n' && !inQuote) {
      lines.push(current);
      current = '';
    } else if (char === '\r') {
      // skip CR
    } else {
      current += char;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/**
 * Parse a single CSV line into field values, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Build a classification object from a gold-set row.
 * Blank taxonomy cells → omitted keys (not empty strings, not null).
 * `not_applicable` → literal string "not_applicable".
 * `needs_object` → literal string "needs_object".
 */
function buildClassification(row: GoldSetRow): Record<string, string> {
  const classification: Record<string, string> = {};
  for (const field of TAXONOMY_FIELDS) {
    let value = row[field];
    if (value && value.trim() !== '') {
      value = value.trim();
      // Apply value normalization (e.g., other_issue → other_maintenance_category)
      const fieldMap = VALUE_NORMALIZATION[field];
      if (fieldMap && value in fieldMap) {
        value = fieldMap[value];
      }
      classification[field] = value;
    }
    // blank → omit key entirely
  }
  return classification;
}

/**
 * Derive expected_followup_fields for a row.
 * Gold-v1 policy override (Decision 2): if classification contains needs_object
 * in Maintenance_Object or Management_Object, include that field regardless of
 * the CSV's should_ask_followup column.
 */
function deriveFollowupFields(
  row: GoldSetRow,
  classification: Record<string, string>,
): string[] {
  const fields: string[] = [];

  // Policy override: needs_object always triggers follow-up
  if (classification.Maintenance_Object === 'needs_object') {
    fields.push('Maintenance_Object');
  }
  if (classification.Management_Object === 'needs_object') {
    fields.push('Management_Object');
  }

  // For other rows, derive from CSV columns
  if (row.should_ask_followup === 'true' || row.should_ask_followup === 'yes') {
    const followupType = row.followup_type?.trim();
    if (followupType === 'location') {
      if (!fields.includes('Location')) fields.push('Location');
    } else if (followupType === 'object_clarification') {
      // Already handled by needs_object override
    } else if (followupType && followupType !== '') {
      // Generic follow-up — include the type as-is if it maps to a field
      if (!fields.includes(followupType)) fields.push(followupType);
    }
  }

  return fields;
}

/**
 * Derive slice tags from a classification.
 */
function deriveSliceTags(
  classification: Record<string, string>,
  isMultiIssue: boolean,
): string[] {
  const tags: string[] = ['gold'];
  if (classification.Category) tags.push(classification.Category);
  if (classification.Maintenance_Category) tags.push(classification.Maintenance_Category);
  if (classification.Priority) tags.push(classification.Priority);
  if (isMultiIssue) tags.push('multi_issue');
  return tags;
}

/**
 * Normalize taxonomy version from CSV to semver format.
 * E.g., "1" → "1.0.0", "1.0" → "1.0.0", "1.0.0" → "1.0.0"
 */
export function normalizeTaxonomyVersion(version: string): string {
  const trimmed = version.trim();
  // Check named-version mapping first (e.g., maintenance_taxonomy_v1 → 1.0.0)
  if (trimmed in NAMED_VERSION_MAP) {
    return NAMED_VERSION_MAP[trimmed];
  }
  const parts = trimmed.split('.');
  while (parts.length < 3) parts.push('0');
  if (!/^\d+\.\d+\.\d+$/.test(parts.join('.'))) {
    throw new Error(`Cannot normalize taxonomy version to semver: "${version}"`);
  }
  return parts.join('.');
}

/**
 * Transpile parsed gold-set rows into NormalizedExample objects.
 * Groups rows by source_message_id for multi-issue conversations.
 */
export function transpileRows(rows: readonly GoldSetRow[]): NormalizedExample[] {
  // Group by source_message_id
  const groups = new Map<string, GoldSetRow[]>();
  for (const row of rows) {
    const key = row.source_message_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const examples: NormalizedExample[] = [];
  let exampleIndex = 1;

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    const taxonomyVersion = normalizeTaxonomyVersion(first.taxonomy_version);
    const isMultiIssue = groupRows.length > 1;

    const splitIssues = groupRows.map((r) => ({
      issue_text: r.atomic_issue,
    }));

    const classifications = groupRows.map((r) => buildClassification(r));

    // Collect all follow-up fields across issues in this conversation
    const allFollowupFields: string[] = [];
    for (let i = 0; i < groupRows.length; i++) {
      const fields = deriveFollowupFields(groupRows[i], classifications[i]);
      for (const f of fields) {
        if (!allFollowupFields.includes(f)) allFollowupFields.push(f);
      }
    }

    // Collect missing fields — fields omitted from classification
    const allMissingFields: string[] = [];
    for (const cls of classifications) {
      for (const field of TAXONOMY_FIELDS) {
        if (!(field in cls) && !allMissingFields.includes(field)) {
          allMissingFields.push(field);
        }
      }
    }

    // Derive risk flags from emergency and safety_flag columns (union across group)
    const riskFlags: string[] = [];
    for (const r of groupRows) {
      if (r.emergency?.trim().toLowerCase() === 'yes' && !riskFlags.includes('emergency')) {
        riskFlags.push('emergency');
      }
      if (r.safety_flag?.trim().toLowerCase() === 'yes' && !riskFlags.includes('safety')) {
        riskFlags.push('safety');
      }
    }

    // Derive slice tags from first issue's classification
    const sliceTags = deriveSliceTags(classifications[0], isMultiIssue);

    const example: NormalizedExample = {
      example_id: `gold-v1-${first.source_message_id}`,
      dataset_type: 'gold',
      source_type: 'production_reviewed',
      conversation_text: first.raw_intake,
      split_issues_expected: splitIssues,
      expected_classification_by_issue: classifications,
      expected_missing_fields: allMissingFields,
      expected_followup_fields: allFollowupFields,
      expected_needs_human_triage: false,
      expected_risk_flags: riskFlags,
      slice_tags: sliceTags,
      taxonomy_version: taxonomyVersion,
      schema_version: '1.0.0',
      review_status: 'approved_for_gate',
      reviewed_by: 'gold-set-transpiler',
      created_at: new Date().toISOString(),
    };

    examples.push(example);
    exampleIndex++;
  }

  return examples;
}

/**
 * Build the manifest for a transpiled gold-v1 dataset.
 */
export function buildManifest(examples: readonly NormalizedExample[]): TranspilerManifest {
  const sliceCoverage: Record<string, number> = {};

  for (const ex of examples) {
    for (const tag of ex.slice_tags) {
      if (tag === 'gold' || tag === 'multi_issue') continue;
      sliceCoverage[tag] = (sliceCoverage[tag] ?? 0) + 1;
    }
  }

  // Count total atomic issues
  let totalIssues = 0;
  for (const ex of examples) {
    totalIssues += ex.split_issues_expected.length;
  }

  return {
    manifest_id: 'gold-v1',
    dataset_type: 'gold',
    taxonomy_version: examples[0]?.taxonomy_version ?? '1.0.0',
    schema_version: '1.0.0',
    example_count: examples.length,
    slice_coverage: sliceCoverage,
    created_at: new Date().toISOString(),
    description: `Gold-v1 dataset — ${totalIssues} atomic issues across ${examples.length} conversations. Evidence-based labeling: blank fields = omitted keys, needs_object triggers follow-up.`,
    policy_overrides: [
      'needs_object in Maintenance_Object or Management_Object always triggers expected_followup_fields, regardless of CSV should_ask_followup value (Decision 2)',
      'expected_needs_human_triage is false for all rows — gold set contains only classifiable issues',
    ],
  };
}

/**
 * Write transpiled examples and manifest to disk.
 */
export function writeDataset(
  outputDir: string,
  examples: readonly NormalizedExample[],
  manifest: TranspilerManifest,
): void {
  mkdirSync(outputDir, { recursive: true });

  const jsonlLines = examples.map((ex) => JSON.stringify(ex)).join('\n');
  writeFileSync(resolve(outputDir, 'examples.jsonl'), jsonlLines + '\n', 'utf-8');
  writeFileSync(resolve(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/**
 * Full transpile pipeline: CSV text → files on disk.
 */
export function transpileCsv(csvText: string, outputDir: string): {
  examples: NormalizedExample[];
  manifest: TranspilerManifest;
} {
  const rows = parseCsv(csvText);
  const examples = transpileRows(rows);
  const manifest = buildManifest(examples);
  writeDataset(outputDir, examples, manifest);
  return { examples, manifest };
}
