export interface UnitInfo {
  readonly unit_id: string;
  readonly property_id: string;
  readonly client_id: string;
  readonly building_id: string;
}

/**
 * Resolves property and client scope from a unit_id.
 * In production this queries the tenant/property database.
 * For testing, use a stub or in-memory map.
 */
export interface UnitResolver {
  resolve(unitId: string): Promise<UnitInfo | null>;
}
