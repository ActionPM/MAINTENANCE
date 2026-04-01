import { validateClassificationAgainstTaxonomy } from '@wo-agent/schemas';
import type { Taxonomy, TaxonomyFieldName } from '@wo-agent/schemas';

export const ClassifierTriageReason = {
  CATEGORY_GATING_RETRY_FAILED: 'category_gating_retry_failed',
  SCHEMA_VALIDATION_RETRY_FAILED: 'schema_validation_retry_failed',
  CONSTRAINT_RETRY_FAILED: 'constraint_retry_failed',
} as const;

export type ClassifierTriageReason =
  (typeof ClassifierTriageReason)[keyof typeof ClassifierTriageReason];

export const RoutingReason = {
  CAPS_EXHAUSTED: 'caps_exhausted',
  FOLLOWUP_GENERATION_FAILED: 'followup_generation_failed',
  UNRECOVERABLE_CLASSIFICATION: 'unrecoverable_classification',
  RECOVERED_VIA_FOLLOWUP: 'recovered_via_followup',
} as const;

export type RoutingReason = (typeof RoutingReason)[keyof typeof RoutingReason];

const CATEGORY_PLACEHOLDERS = new Set(['', 'other_category', 'not_applicable']);
const MAINTENANCE_CATEGORY_PLACEHOLDERS = new Set([
  '',
  'other_issue',
  'other_maintenance_category',
  'not_applicable',
]);
const MANAGEMENT_CATEGORY_PLACEHOLDERS = new Set([
  '',
  'other_mgmt_cat',
  'other_management_category',
  'not_applicable',
]);

function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === '';
}

function taxonomyIncludes(taxonomy: Taxonomy, field: TaxonomyFieldName, value: string): boolean {
  return taxonomy[field].includes(value);
}

export function normalizeCrossDomainClassification(
  classification: Record<string, string>,
): Record<string, string> {
  const normalized = { ...classification };
  const category = normalized.Category;

  if (category === 'maintenance') {
    if (isBlank(normalized.Management_Category)) {
      normalized.Management_Category = 'not_applicable';
    }
    if (isBlank(normalized.Management_Object)) {
      normalized.Management_Object = 'not_applicable';
    }
  } else if (category === 'management') {
    if (isBlank(normalized.Maintenance_Category)) {
      normalized.Maintenance_Category = 'not_applicable';
    }
    if (isBlank(normalized.Maintenance_Object)) {
      normalized.Maintenance_Object = 'not_applicable';
    }
    if (isBlank(normalized.Maintenance_Problem)) {
      normalized.Maintenance_Problem = 'not_applicable';
    }
  }

  return normalized;
}

function hasValidCategoryAnchor(
  classification: Record<string, string>,
  taxonomy: Taxonomy,
): boolean {
  const category = classification.Category;
  return (
    !!category &&
    !CATEGORY_PLACEHOLDERS.has(category) &&
    taxonomyIncludes(taxonomy, 'Category', category)
  );
}

function hasValidDomainAnchor(classification: Record<string, string>, taxonomy: Taxonomy): boolean {
  const category = classification.Category;
  if (category === 'maintenance') {
    const value = classification.Maintenance_Category;
    return (
      !!value &&
      !MAINTENANCE_CATEGORY_PLACEHOLDERS.has(value) &&
      taxonomyIncludes(taxonomy, 'Maintenance_Category', value)
    );
  }

  if (category === 'management') {
    const value = classification.Management_Category;
    return (
      !!value &&
      !MANAGEMENT_CATEGORY_PLACEHOLDERS.has(value) &&
      taxonomyIncludes(taxonomy, 'Management_Category', value)
    );
  }

  return false;
}

export interface RecoverableViaFollowupInput {
  readonly needsHumanTriage: boolean;
  readonly fieldsNeedingInput: readonly string[];
  readonly classification: Record<string, string>;
  readonly taxonomy: Taxonomy;
  readonly taxonomyVersion?: string;
}

export function computeRecoverableViaFollowup(input: RecoverableViaFollowupInput): boolean {
  if (!input.needsHumanTriage || input.fieldsNeedingInput.length === 0) {
    return false;
  }

  const normalized = normalizeCrossDomainClassification(input.classification);
  if (!hasValidCategoryAnchor(normalized, input.taxonomy)) {
    return false;
  }

  if (!hasValidDomainAnchor(normalized, input.taxonomy)) {
    return false;
  }

  const validation = validateClassificationAgainstTaxonomy(
    normalized,
    input.taxonomy,
    input.taxonomyVersion,
  );

  return !validation.contradictory;
}
