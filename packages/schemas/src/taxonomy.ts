import taxonomyData from '../taxonomy.json';

export interface Taxonomy {
  readonly Category: readonly string[];
  readonly Location: readonly string[];
  readonly Sub_Location: readonly string[];
  readonly Maintenance_Category: readonly string[];
  readonly Maintenance_Object: readonly string[];
  readonly Maintenance_Problem: readonly string[];
  readonly Management_Category: readonly string[];
  readonly Management_Object: readonly string[];
  readonly Priority: readonly string[];
}

export type TaxonomyFieldName = keyof Taxonomy;

export const TAXONOMY_FIELD_NAMES: readonly TaxonomyFieldName[] = [
  'Category',
  'Location',
  'Sub_Location',
  'Maintenance_Category',
  'Maintenance_Object',
  'Maintenance_Problem',
  'Management_Category',
  'Management_Object',
  'Priority',
] as const;

const MAINTENANCE_FIELDS: readonly TaxonomyFieldName[] = [
  'Maintenance_Category',
  'Maintenance_Object',
  'Maintenance_Problem',
] as const;

const MANAGEMENT_FIELDS: readonly TaxonomyFieldName[] = [
  'Management_Category',
  'Management_Object',
] as const;

export { MAINTENANCE_FIELDS, MANAGEMENT_FIELDS };

export function loadTaxonomy(): Taxonomy {
  const parsed = taxonomyData as unknown as Taxonomy;

  for (const field of TAXONOMY_FIELD_NAMES) {
    if (!Array.isArray(parsed[field]) || parsed[field].length === 0) {
      throw new Error(`Taxonomy field "${field}" must be a non-empty array`);
    }
  }

  return parsed;
}

export function isTaxonomyValue(field: TaxonomyFieldName, value: string): boolean {
  return taxonomy[field].includes(value);
}

export const taxonomy: Taxonomy = loadTaxonomy();
