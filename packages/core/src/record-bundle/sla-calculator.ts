import type { SlaMetadata } from '@wo-agent/schemas';
import type { SlaPolicies } from './types.js';

export interface ComputeSlaInput {
  readonly priority: string;
  readonly classification: Record<string, string>;
  readonly createdAt: string;
  readonly slaPolicies: SlaPolicies;
}

/**
 * Compute SLA metadata for a work order (spec §22).
 * Checks taxonomy-path overrides first, then falls back to priority-based client defaults.
 */
export function computeSlaMetadata(input: ComputeSlaInput): SlaMetadata {
  const { priority, classification, createdAt, slaPolicies } = input;

  // 1. Check taxonomy-path overrides
  const taxonomyPath = buildTaxonomyPath(classification);
  const override = slaPolicies.overrides.find((o) => taxonomyPath.startsWith(o.taxonomy_path));

  let responseHours: number;
  let resolutionHours: number;

  if (override) {
    responseHours = override.response_hours;
    resolutionHours = override.resolution_hours;
  } else {
    // 2. Fall back to priority-based defaults (spec §22 — normal if unrecognized)
    const tier = slaPolicies.client_defaults[priority] ?? slaPolicies.client_defaults['normal'];
    responseHours = tier.response_hours;
    resolutionHours = tier.resolution_hours;
  }

  const createdMs = new Date(createdAt).getTime();

  return {
    priority,
    response_hours: responseHours,
    resolution_hours: resolutionHours,
    response_due_at: new Date(createdMs + responseHours * 3_600_000).toISOString(),
    resolution_due_at: new Date(createdMs + resolutionHours * 3_600_000).toISOString(),
  };
}

/**
 * Build a dotted taxonomy path from classification fields.
 * Example: { Category: 'maintenance', Maintenance_Category: 'plumbing', Maintenance_Problem: 'flood' }
 *       → 'maintenance.plumbing.flood'
 */
function buildTaxonomyPath(classification: Record<string, string>): string {
  const parts: string[] = [];
  if (classification['Category']) parts.push(classification['Category']);
  if (classification['Maintenance_Category']) parts.push(classification['Maintenance_Category']);
  if (classification['Maintenance_Object']) parts.push(classification['Maintenance_Object']);
  if (classification['Maintenance_Problem']) parts.push(classification['Maintenance_Problem']);
  if (classification['Management_Category']) parts.push(classification['Management_Category']);
  if (classification['Management_Object']) parts.push(classification['Management_Object']);
  return parts.join('.');
}
