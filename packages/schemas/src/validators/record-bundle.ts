import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { RecordBundle } from '../types/record-bundle.js';

const BUNDLE_REF = 'record_bundle.schema.json#/definitions/RecordBundle';

export function validateRecordBundle(data: unknown): ValidationResult<RecordBundle> {
  return validate<RecordBundle>(data, BUNDLE_REF);
}
