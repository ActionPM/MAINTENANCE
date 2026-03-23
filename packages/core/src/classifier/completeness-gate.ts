/**
 * Completeness gate — checks whether a classification has all meaningful fields
 * populated. Runs BEFORE confidence band analysis. Blank meaningful fields
 * trigger follow-up regardless of confidence score.
 *
 * Domain-specific rules:
 * - Maintenance: require Category, Priority; Location, Sub_Location,
 *   Maintenance_Object are follow-up-eligible when blank
 * - Management: require Category, Priority; blank Location is accepted as-is
 *   (Decision 1); cross-domain fields are not_applicable
 * - needs_object always triggers follow-up (Decision 2) but does not block
 *   submission if unresolved
 */

export const FollowUpType = {
  LOCATION: 'location',
  OBJECT_CLARIFICATION: 'object_clarification',
  OTHER: 'other',
} as const;
export type FollowUpType = (typeof FollowUpType)[keyof typeof FollowUpType];

export interface CompletenessResult {
  readonly complete: boolean;
  readonly incompleteFields: readonly string[];
  readonly followupTypes: Record<string, FollowUpType>;
}

export interface CompletenessPolicy {
  readonly maintenanceFollowupEligible: readonly string[];
  readonly managementFollowupEligible: readonly string[];
}

export const DEFAULT_COMPLETENESS_POLICY: CompletenessPolicy = {
  maintenanceFollowupEligible: [
    'Location',
    'Sub_Location',
    'Maintenance_Object',
  ],
  managementFollowupEligible: [],
};

const CROSS_DOMAIN_MAINTENANCE = new Set([
  'Management_Category',
  'Management_Object',
]);

const CROSS_DOMAIN_MANAGEMENT = new Set([
  'Maintenance_Category',
  'Maintenance_Object',
  'Maintenance_Problem',
]);

/**
 * Check classification completeness and derive follow-up types.
 */
export function checkCompleteness(
  classification: Record<string, string>,
  category: 'maintenance' | 'management' | string,
  policy: CompletenessPolicy = DEFAULT_COMPLETENESS_POLICY,
): CompletenessResult {
  const incompleteFields: string[] = [];
  const followupTypes: Record<string, FollowUpType> = {};

  const crossDomainFields =
    category === 'maintenance' ? CROSS_DOMAIN_MAINTENANCE : CROSS_DOMAIN_MANAGEMENT;

  const followupEligible =
    category === 'maintenance'
      ? policy.maintenanceFollowupEligible
      : policy.managementFollowupEligible;

  // Check follow-up-eligible fields for blanks
  for (const field of followupEligible) {
    const value = classification[field];

    // Cross-domain not_applicable fields are never follow-up-eligible
    if (crossDomainFields.has(field)) continue;

    if (!value || value === '') {
      // Blank field — needs follow-up
      incompleteFields.push(field);
      followupTypes[field] = deriveFollowupType(field);
    } else if (value === 'needs_object') {
      // needs_object always triggers follow-up (Decision 2)
      incompleteFields.push(field);
      followupTypes[field] = FollowUpType.OBJECT_CLARIFICATION;
    }
  }

  // Also check for needs_object in any field (not just eligible ones)
  for (const [field, value] of Object.entries(classification)) {
    if (value === 'needs_object' && !incompleteFields.includes(field)) {
      incompleteFields.push(field);
      followupTypes[field] = FollowUpType.OBJECT_CLARIFICATION;
    }
  }

  return {
    complete: incompleteFields.length === 0,
    incompleteFields,
    followupTypes,
  };
}

function deriveFollowupType(field: string): FollowUpType {
  if (field === 'Location' || field === 'Sub_Location') {
    return FollowUpType.LOCATION;
  }
  return FollowUpType.OTHER;
}
