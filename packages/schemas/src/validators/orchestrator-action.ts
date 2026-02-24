import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { OrchestratorActionRequest, OrchestratorActionResponse } from '../types/orchestrator-action.js';

const REQUEST_REF = 'orchestrator_action.schema.json#/definitions/OrchestratorActionRequest';
const RESPONSE_REF = 'orchestrator_action.schema.json#/definitions/OrchestratorActionResponse';

export function validateOrchestratorActionRequest(
  data: unknown,
): ValidationResult<OrchestratorActionRequest> {
  return validate<OrchestratorActionRequest>(data, REQUEST_REF);
}

export function validateOrchestratorActionResponse(
  data: unknown,
): ValidationResult<OrchestratorActionResponse> {
  return validate<OrchestratorActionResponse>(data, RESPONSE_REF);
}
