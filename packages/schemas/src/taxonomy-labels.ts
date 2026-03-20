import labelsJson from '../taxonomy-labels.json' with { type: 'json' };

const labels: Record<string, Record<string, string>> = labelsJson.labels;

/**
 * Look up a display-friendly label for a taxonomy slug.
 * Returns the label if mapped, otherwise formats the slug
 * (underscores → spaces, first letter capitalized).
 */
export function getTaxonomyLabel(field: string, slug: string): string {
  const fieldLabels = labels[field];
  if (fieldLabels && fieldLabels[slug]) {
    return fieldLabels[slug];
  }
  return slug.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
