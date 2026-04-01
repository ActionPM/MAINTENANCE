import { CONSTRAINT_EDGES, taxonomyConstraints, type TaxonomyConstraints } from '@wo-agent/schemas';
import {
  isConstraintResolvedValue,
  resolveConstraintImpliedFields,
} from '../classifier/constraint-resolver.js';

const FORWARD_GATING_MAPS = new Set([
  'Location_to_Sub_Location',
  'Sub_Location_to_Maintenance_Category',
  'Maintenance_Category_to_Maintenance_Object',
  'Maintenance_Object_to_Maintenance_Problem',
]);

const MAINTENANCE_HIERARCHY_FIELDS = [
  'Location',
  'Sub_Location',
  'Maintenance_Category',
  'Maintenance_Object',
  'Maintenance_Problem',
] as const;

const MANAGEMENT_HIERARCHY_FIELDS = ['Management_Category', 'Management_Object'] as const;

function isMaintenanceCategory(classification: Record<string, string>): boolean {
  return classification.Category === 'maintenance';
}

function isResolvedOrImpliedField(
  field: string,
  classification: Record<string, string>,
  impliedFields: Record<string, string>,
): boolean {
  return isConstraintResolvedValue(impliedFields[field] ?? classification[field], {
    treatNeedsObjectAsUnresolved: true,
  });
}

export function selectFollowUpFrontierFields(
  eligibleFields: readonly string[],
  classification: Record<string, string>,
  constraints: TaxonomyConstraints = taxonomyConstraints,
): string[] {
  if (!isMaintenanceCategory(classification) && classification.Category !== 'management') {
    return [...eligibleFields];
  }

  const impliedFields = resolveConstraintImpliedFields(classification, constraints);
  const activeHierarchy =
    classification.Category === 'management'
      ? MANAGEMENT_HIERARCHY_FIELDS
      : MAINTENANCE_HIERARCHY_FIELDS;
  const gatedFields = eligibleFields.filter((field) => {
    if (field === 'Priority') {
      return activeHierarchy.every((parentField) =>
        isResolvedOrImpliedField(parentField, classification, impliedFields),
      );
    }

    const forwardParents = CONSTRAINT_EDGES.filter(
      (edge) => edge.childField === field && FORWARD_GATING_MAPS.has(edge.mapKey),
    );

    if (forwardParents.length === 0) {
      return true;
    }

    return forwardParents.every((edge) =>
      isResolvedOrImpliedField(edge.parentField, classification, impliedFields),
    );
  });

  for (const field of activeHierarchy) {
    if (gatedFields.includes(field)) {
      return [field];
    }
  }

  if (gatedFields.includes('Priority')) {
    return ['Priority'];
  }

  return gatedFields;
}
