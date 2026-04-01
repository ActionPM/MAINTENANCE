import { describe, it, expect } from 'vitest';
import { loadTaxonomy } from '../taxonomy.js';
import type { CueDictionary } from '../validators/cue-dictionary-validator.js';
import cuesJson from '../../classification_cues.json' with { type: 'json' };

const cues = cuesJson as unknown as CueDictionary;

describe('cue coverage audit', () => {
  it('every taxonomy value either has cues or is in the explicit exclusion list', () => {
    const taxonomy = loadTaxonomy();

    // Values excluded from cue matching. Each group must have a justification.
    // To add cues for a value: remove it from this list and add entries
    // in classification_cues.json. Expand based on eval regression frequency.
    // All currently-uncovered values, grouped by justification.
    // To add cues for a value: remove it from this list and add entries
    // in classification_cues.json. Expand based on eval regression frequency.
    const EXCLUDED: Record<string, string[]> = {
      // --- Placeholder/meta values: no meaningful keyword signal ---
      Maintenance_Category: ['other_maintenance_category', 'not_applicable'],
      Maintenance_Object: [
        'other_object',
        'no_object',
        'needs_object',
        'not_applicable',
        // Common terms or ambiguous without context -- eval-driven expansion pending
        'fuse',
        'switch',
        'cabinet',
        'shelf',
        'baseboard',
        'floor',
        'tile',
        'carpet',
        'wood',
        'laminate',
        'wall',
        'ceiling',
        'paint',
        // Pest objects -- overlap with pest_control category cues
        'pests',
        'cockroaches',
        'ants',
        'bedbugs',
        'rodents',
        // Low frequency in eval data
        'microwave',
        'range_hood',
        'roof',
        'grout',
      ],
      Maintenance_Problem: ['other_problem', 'not_applicable'],
      Management_Category: ['other_mgmt_cat', 'not_applicable'],
      Management_Object: [
        'other_mgmt_obj',
        'no_object',
        'needs_object',
        'not_applicable',
        // Uncommon management topics -- eval-driven expansion pending
        'sublet_assign',
        'rentable_item',
        'add_remove_tenant',
        'legal_matters',
        'technical_issues',
        'accommodations',
        'chargebacks',
        'general_feedback',
        'questions',
      ],

      // --- Uncovered values: eval-driven expansion pending ---
      Sub_Location: [
        'other_sub_location',
        // building interior/exterior -- low standalone keyword signal
        'closets',
        'windows',
        'ceiling',
        'entrance_lobby',
        'hallways_stairwells',
        'elevator',
        'laundry',
        'locker_room',
        'gym',
        'pool',
        'party_room',
        'other_amenity',
        'mechanical_room',
        'cable_room',
        'bike_locker',
        'parking_garage',
        'landscape',
        'hardscape',
        'facade',
        'roof',
        'mechanical',
        'garbage',
        'amenity',
        'surface_parking',
        // multi-area values
        'entire_unit',
        'multiple_rooms',
      ],
    };

    const uncovered: string[] = [];
    for (const [field, values] of Object.entries(taxonomy)) {
      const fieldCues = cues.fields[field] ?? {};
      const excluded = EXCLUDED[field] ?? [];
      for (const value of values) {
        if (excluded.includes(value)) continue;
        const entry = fieldCues[value];
        if (!entry || (entry.keywords.length === 0 && entry.regex.length === 0)) {
          uncovered.push(`${field}.${value}`);
        }
      }
    }

    expect(
      uncovered,
      `Uncovered values (add cues or add to EXCLUDED with justification):\n${uncovered.join('\n')}`,
    ).toEqual([]);
  });
});
