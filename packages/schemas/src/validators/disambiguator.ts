import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { DisambiguatorOutput } from '../types/disambiguator.js';

const OUTPUT_REF = 'disambiguator.schema.json#/definitions/DisambiguatorOutput';

export function validateDisambiguatorOutput(data: unknown): ValidationResult<DisambiguatorOutput> {
  return validate<DisambiguatorOutput>(data, OUTPUT_REF);
}
