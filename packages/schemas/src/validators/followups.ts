import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { FollowUpGeneratorInput } from '../types/followups.js';
import type { FollowUpGeneratorOutput, FollowUpEvent } from '../types/followups.js';

const INPUT_REF = 'followup_request.schema.json#/definitions/FollowUpGeneratorInput';
const OUTPUT_REF = 'followups.schema.json#/definitions/FollowUpGeneratorOutput';
const EVENT_REF = 'followups.schema.json#/definitions/FollowUpEvent';

export function validateFollowUpInput(data: unknown): ValidationResult<FollowUpGeneratorInput> {
  return validate<FollowUpGeneratorInput>(data, INPUT_REF);
}

export function validateFollowUpOutput(data: unknown): ValidationResult<FollowUpGeneratorOutput> {
  return validate<FollowUpGeneratorOutput>(data, OUTPUT_REF);
}

export function validateFollowUpEvent(data: unknown): ValidationResult<FollowUpEvent> {
  return validate<FollowUpEvent>(data, EVENT_REF);
}
