import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { IssueClassifierInput, IssueClassifierOutput } from '../types/classification.js';

const INPUT_REF = 'classification.schema.json#/definitions/IssueClassifierInput';
const OUTPUT_REF = 'classification.schema.json#/definitions/IssueClassifierOutput';

export function validateClassifierInput(data: unknown): ValidationResult<IssueClassifierInput> {
  return validate<IssueClassifierInput>(data, INPUT_REF);
}

export function validateClassifierOutput(data: unknown): ValidationResult<IssueClassifierOutput> {
  return validate<IssueClassifierOutput>(data, OUTPUT_REF);
}
