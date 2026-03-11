import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { IssueSplitterInput, IssueSplitterOutput } from '../types/issue-split.js';

const INPUT_REF = 'issue_split.schema.json#/definitions/IssueSplitterInput';
const OUTPUT_REF = 'issue_split.schema.json#/definitions/IssueSplitterOutput';

export function validateIssueSplitterInput(data: unknown): ValidationResult<IssueSplitterInput> {
  return validate<IssueSplitterInput>(data, INPUT_REF);
}

export function validateIssueSplitterOutput(data: unknown): ValidationResult<IssueSplitterOutput> {
  return validate<IssueSplitterOutput>(data, OUTPUT_REF);
}
