import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

import orchestratorActionSchema from '../orchestrator_action.schema.json';
import issueSplitSchema from '../issue_split.schema.json';
import classificationSchema from '../classification.schema.json';
import followupRequestSchema from '../followup_request.schema.json';
import followupsSchema from '../followups.schema.json';
import workOrderSchema from '../work_order.schema.json';
import photoSchema from '../photo.schema.json';
import recordBundleSchema from '../record_bundle.schema.json';

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

const SCHEMA_ENTRIES: readonly [string, Record<string, unknown>][] = [
  [
    'orchestrator_action.schema.json',
    orchestratorActionSchema as unknown as Record<string, unknown>,
  ],
  ['issue_split.schema.json', issueSplitSchema as unknown as Record<string, unknown>],
  ['classification.schema.json', classificationSchema as unknown as Record<string, unknown>],
  ['followup_request.schema.json', followupRequestSchema as unknown as Record<string, unknown>],
  ['followups.schema.json', followupsSchema as unknown as Record<string, unknown>],
  ['work_order.schema.json', workOrderSchema as unknown as Record<string, unknown>],
  ['photo.schema.json', photoSchema as unknown as Record<string, unknown>],
  ['record_bundle.schema.json', recordBundleSchema as unknown as Record<string, unknown>],
] as const;

function createAjvInstance(): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);

  for (const [name, schema] of SCHEMA_ENTRIES) {
    ajv.addSchema(schema, name);
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
