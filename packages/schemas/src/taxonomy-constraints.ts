import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TaxonomyConstraints {
  readonly version: string;
  readonly description: string;
  readonly [key: string]: unknown;
  readonly Location_to_Sub_Location: Record<string, readonly string[]>;
  readonly Sub_Location_to_Maintenance_Category: Record<string, readonly string[]>;
  readonly Maintenance_Category_to_Maintenance_Object: Record<string, readonly string[]>;
  readonly Maintenance_Object_to_Maintenance_Problem: Record<string, readonly string[]>;
  readonly Maintenance_Object_to_Sub_Location: Record<string, readonly string[]>;
}

export type ConstraintMapName = 'Location_to_Sub_Location'
  | 'Sub_Location_to_Maintenance_Category'
  | 'Maintenance_Category_to_Maintenance_Object'
  | 'Maintenance_Object_to_Maintenance_Problem'
  | 'Maintenance_Object_to_Sub_Location';

export interface ConstraintEdge {
  readonly parentField: string;
  readonly childField: string;
  readonly mapKey: ConstraintMapName;
}

/**
 * Derive CONSTRAINT_EDGES from the constraint map key naming convention.
 * Keys follow the pattern "ParentField_to_ChildField".
 * This avoids a hardcoded second source of truth (C3 fix).
 */
export function deriveConstraintEdges(constraints: TaxonomyConstraints): ConstraintEdge[] {
  const metaKeys = new Set(['version', 'description']);
  const edges: ConstraintEdge[] = [];
  for (const key of Object.keys(constraints)) {
    if (metaKeys.has(key)) continue;
    const parts = key.split('_to_');
    if (parts.length !== 2) continue;
    edges.push({
      parentField: parts[0],
      childField: parts[1],
      mapKey: key as ConstraintMapName,
    });
  }
  return edges;
}

export function loadTaxonomyConstraints(): TaxonomyConstraints {
  const filePath = resolve(__dirname, '..', 'taxonomy_constraints.json');
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TaxonomyConstraints;
}

export const taxonomyConstraints: TaxonomyConstraints = loadTaxonomyConstraints();
export const CONSTRAINT_EDGES: readonly ConstraintEdge[] = deriveConstraintEdges(taxonomyConstraints);
