import { validate } from '../validator.js';
import type { ValidationResult } from '../validator.js';
import type { WorkOrder } from '../types/work-order.js';

const WO_REF = 'work_order.schema.json#/definitions/WorkOrder';

export function validateWorkOrder(
  data: unknown,
): ValidationResult<WorkOrder> {
  return validate<WorkOrder>(data, WO_REF);
}
