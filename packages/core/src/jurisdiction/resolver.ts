/**
 * Jurisdiction resolution (spec §1.9).
 * Resolves compliance jurisdiction from property metadata.
 * Feeds into SLA override-capable policy logic.
 */

export interface JurisdictionInfo {
  readonly jurisdiction_id: string;
  readonly name: string;
  readonly compliance_framework: string;
}

/**
 * Known jurisdictions with compliance frameworks.
 * RentSafeTO is the baseline (spec §1.9).
 */
const JURISDICTIONS: Record<string, JurisdictionInfo> = {
  'on-toronto': {
    jurisdiction_id: 'on-toronto',
    name: 'Toronto, Ontario',
    compliance_framework: 'RentSafeTO',
  },
  'on-ottawa': {
    jurisdiction_id: 'on-ottawa',
    name: 'Ottawa, Ontario',
    compliance_framework: 'Ontario_RTA',
  },
  'bc-vancouver': {
    jurisdiction_id: 'bc-vancouver',
    name: 'Vancouver, British Columbia',
    compliance_framework: 'BC_RTA',
  },
};

const DEFAULT_JURISDICTION: JurisdictionInfo = {
  jurisdiction_id: 'default',
  name: 'Default',
  compliance_framework: 'Ontario_RTA',
};

/**
 * Resolve jurisdiction from a property's postal code prefix or explicit jurisdiction ID.
 */
export function resolveJurisdiction(input: {
  jurisdiction_id?: string;
  postal_code_prefix?: string;
}): JurisdictionInfo {
  // Direct lookup by ID
  if (input.jurisdiction_id && JURISDICTIONS[input.jurisdiction_id]) {
    return JURISDICTIONS[input.jurisdiction_id];
  }

  // Postal code prefix heuristic (Canadian postal codes)
  if (input.postal_code_prefix) {
    const prefix = input.postal_code_prefix.toUpperCase();
    if (prefix.startsWith('M')) return JURISDICTIONS['on-toronto'];
    if (prefix.startsWith('K')) return JURISDICTIONS['on-ottawa'];
    if (prefix.startsWith('V')) return JURISDICTIONS['bc-vancouver'];
  }

  return DEFAULT_JURISDICTION;
}

/**
 * Get all registered jurisdictions.
 */
export function getRegisteredJurisdictions(): readonly JurisdictionInfo[] {
  return Object.values(JURISDICTIONS);
}
