export interface SliceDefinition {
  readonly name: string;
  readonly filter: (example: { slice_tags: readonly string[] }) => boolean;
}

export const TAXONOMY_SLICES: readonly SliceDefinition[] = [
  { name: 'plumbing', filter: (e) => e.slice_tags.includes('plumbing') },
  { name: 'electrical', filter: (e) => e.slice_tags.includes('electrical') },
  { name: 'hvac', filter: (e) => e.slice_tags.includes('hvac') },
  { name: 'pest_control', filter: (e) => e.slice_tags.includes('pest_control') },
  { name: 'appliance', filter: (e) => e.slice_tags.includes('appliance') },
  { name: 'carpentry', filter: (e) => e.slice_tags.includes('carpentry') },
  { name: 'flooring', filter: (e) => e.slice_tags.includes('flooring') },
  { name: 'accounting', filter: (e) => e.slice_tags.includes('accounting') },
  { name: 'lease', filter: (e) => e.slice_tags.includes('lease') },
  { name: 'noise_vibration', filter: (e) => e.slice_tags.includes('noise_vibration') },
  { name: 'parking', filter: (e) => e.slice_tags.includes('parking') },
  { name: 'building_access', filter: (e) => e.slice_tags.includes('building_access') },
];

export const CRITICAL_SLICES: readonly SliceDefinition[] = [
  { name: 'emergency', filter: (e) => e.slice_tags.includes('emergency') },
  { name: 'building_access', filter: (e) => e.slice_tags.includes('building_access') },
  { name: 'pest_control', filter: (e) => e.slice_tags.includes('pest_control') },
  { name: 'ood', filter: (e) => e.slice_tags.includes('ood') || e.slice_tags.includes('off_topic') || e.slice_tags.includes('gibberish') },
];

export const INPUT_QUALITY_SLICES: readonly SliceDefinition[] = [
  { name: 'slang', filter: (e) => e.slice_tags.includes('slang') },
  { name: 'typo', filter: (e) => e.slice_tags.includes('typo') },
  { name: 'vague', filter: (e) => e.slice_tags.includes('vague') },
  { name: 'multi_issue', filter: (e) => e.slice_tags.includes('multi_issue') },
  { name: 'ambiguous', filter: (e) => e.slice_tags.includes('ambiguous') },
];

export function filterBySlice<T extends { slice_tags: readonly string[] }>(
  examples: readonly T[],
  slice: SliceDefinition,
): T[] {
  return examples.filter(slice.filter);
}
