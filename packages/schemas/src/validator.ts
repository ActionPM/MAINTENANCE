import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '..');

export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
}

export interface ValidationResult<T> {
  readonly valid: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationError[];
}

function loadJsonFile(filename: string): unknown {
  const filePath = resolve(schemasDir, filename);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

const SCHEMA_FILES = [
  'orchestrator_action.schema.json',
  'issue_split.schema.json',
  'classification.schema.json',
  'followup_request.schema.json',
  'followups.schema.json',
  'work_order.schema.json',
  'photo.schema.json',
  'record_bundle.schema.json',
] as const;

function createAjvInstance(): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);

  for (const file of SCHEMA_FILES) {
    const schema = loadJsonFile(file) as Record<string, unknown>;
    ajv.addSchema(schema, file);
  }

  return ajv;
}

const ajvInstance = createAjvInstance();

function formatErrors(ajvErrors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!ajvErrors) return [];
  return ajvErrors.map((err) => ({
    path: err.instancePath || '/',
    message: err.message ?? 'Validation error',
    keyword: err.keyword,
  }));
}

export function validate<T>(data: unknown, schemaRef: string): ValidationResult<T> {
  const validateFn = ajvInstance.getSchema(schemaRef);
  if (!validateFn) {
    return {
      valid: false,
      errors: [{ path: '/', message: `Schema not found: ${schemaRef}`, keyword: 'schema' }],
    };
  }

  const valid = validateFn(data) as boolean;
  if (valid) {
    return { valid: true, data: data as T };
  }

  return {
    valid: false,
    errors: formatErrors(validateFn.errors as ErrorObject[] | null),
  };
}

export function getAjvInstance(): Ajv {
  return ajvInstance;
}
