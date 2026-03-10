import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaxonomy } from '../taxonomy.js';
import { validateClassificationAgainstTaxonomy } from './taxonomy-cross-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '..', '..');

function loadSchema(filename: string): Record<string, unknown> {
  const filePath = resolve(schemasDir, filename);
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

function createEvalAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const file of [
    'eval_example.schema.json',
    'eval_dataset_manifest.schema.json',
    'eval_run.schema.json',
    'eval_report.schema.json',
  ] as const) {
    ajv.addSchema(loadSchema(file), file);
  }
  return ajv;
}

const ajv = createEvalAjv();

export interface EvalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function structuralValidate(data: unknown, schemaRef: string): EvalValidationResult {
  const validateFn = ajv.getSchema(schemaRef);
  if (!validateFn) {
    return { valid: false, errors: [`Schema not found: ${schemaRef}`] };
  }
  const ok = validateFn(data) as boolean;
  if (ok) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || '/'}: ${e.message ?? 'validation error'}`,
  );
  return { valid: false, errors };
}

/**
 * Validate an EvalExample: structural schema + domain checks.
 *
 * Domain checks:
 * 1. split_issues_expected and expected_classification_by_issue must be 1:1 aligned.
 * 2. Every expected classification must contain only valid taxonomy values.
 */
export function validateEvalExample(data: unknown): EvalValidationResult {
  const structural = structuralValidate(data, 'eval_example.schema.json');
  if (!structural.valid) return structural;

  const errors: string[] = [];
  const example = data as Record<string, unknown>;

  // 1:1 alignment check
  const splits = example.split_issues_expected as unknown[];
  const classifications = example.expected_classification_by_issue as unknown[];
  if (splits.length !== classifications.length) {
    errors.push(
      `split_issues_expected (${splits.length}) and expected_classification_by_issue (${classifications.length}) must be 1:1 aligned`,
    );
  }

  // Taxonomy domain validation for each expected classification
  const taxonomy = loadTaxonomy();
  const taxonomyVersion = example.taxonomy_version as string | undefined;
  for (let i = 0; i < classifications.length; i++) {
    const cls = classifications[i] as Record<string, string>;
    const result = validateClassificationAgainstTaxonomy(cls, taxonomy, taxonomyVersion);
    if (!result.valid) {
      for (const iv of result.invalidValues) {
        errors.push(
          `expected_classification_by_issue[${i}].${iv.field}: "${iv.value}" is not a valid taxonomy value`,
        );
      }
      for (const violation of result.crossDomainViolations) {
        errors.push(`expected_classification_by_issue[${i}]: ${violation}`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [] };
}

/** Validate an EvalDatasetManifest (structural only). */
export function validateEvalManifest(data: unknown): EvalValidationResult {
  return structuralValidate(data, 'eval_dataset_manifest.schema.json');
}

/** Validate an EvalRun (structural only). */
export function validateEvalRun(data: unknown): EvalValidationResult {
  return structuralValidate(data, 'eval_run.schema.json');
}

/** Validate an EvalReport (structural only). */
export function validateEvalReport(data: unknown): EvalValidationResult {
  return structuralValidate(data, 'eval_report.schema.json');
}
