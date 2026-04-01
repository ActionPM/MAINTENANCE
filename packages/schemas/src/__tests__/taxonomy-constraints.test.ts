import { describe, it, expect } from 'vitest';
import { loadTaxonomyConstraints, type TaxonomyConstraints } from '../taxonomy-constraints.js';
import { taxonomy } from '../taxonomy.js';

describe('taxonomy_constraints.json', () => {
  let constraints: TaxonomyConstraints;

  it('loads without error', () => {
    constraints = loadTaxonomyConstraints();
    expect(constraints).toBeDefined();
    expect(constraints.version).toBeDefined();
  });

  it('every Location -> Sub_Location mapping references valid taxonomy values', () => {
    constraints = loadTaxonomyConstraints();
    for (const [location, subs] of Object.entries(constraints.Location_to_Sub_Location)) {
      expect(taxonomy.Location).toContain(location);
      for (const sub of subs) {
        expect(taxonomy.Sub_Location).toContain(sub);
      }
    }
  });

  it('every Sub_Location -> Maintenance_Category mapping references valid values', () => {
    constraints = loadTaxonomyConstraints();
    for (const [sub, cats] of Object.entries(constraints.Sub_Location_to_Maintenance_Category)) {
      expect(taxonomy.Sub_Location).toContain(sub);
      for (const cat of cats) {
        expect(taxonomy.Maintenance_Category).toContain(cat);
      }
    }
  });

  it('every Maintenance_Category -> Maintenance_Object mapping references valid values', () => {
    constraints = loadTaxonomyConstraints();
    for (const [cat, objs] of Object.entries(
      constraints.Maintenance_Category_to_Maintenance_Object,
    )) {
      expect(taxonomy.Maintenance_Category).toContain(cat);
      for (const obj of objs) {
        expect(taxonomy.Maintenance_Object).toContain(obj);
      }
    }
  });

  it('every Maintenance_Object -> Maintenance_Problem mapping references valid values', () => {
    constraints = loadTaxonomyConstraints();
    for (const [obj, problems] of Object.entries(
      constraints.Maintenance_Object_to_Maintenance_Problem,
    )) {
      expect(taxonomy.Maintenance_Object).toContain(obj);
      for (const prob of problems) {
        expect(taxonomy.Maintenance_Problem).toContain(prob);
      }
    }
  });

  it('every Maintenance_Object -> Sub_Location mapping references valid values', () => {
    constraints = loadTaxonomyConstraints();
    for (const [obj, subs] of Object.entries(constraints.Maintenance_Object_to_Sub_Location)) {
      expect(taxonomy.Maintenance_Object).toContain(obj);
      for (const sub of subs) {
        expect(taxonomy.Sub_Location).toContain(sub);
      }
    }
  });

  it('suite Sub_Locations do not include building_interior or exterior sub-locations', () => {
    constraints = loadTaxonomyConstraints();
    const suiteSubs = constraints.Location_to_Sub_Location['suite'];
    const interiorSubs = constraints.Location_to_Sub_Location['building_interior'];
    for (const interior of interiorSubs) {
      expect(suiteSubs).not.toContain(interior);
    }
  });

  it('toilet is only valid in bathroom, not bedroom or kitchen', () => {
    constraints = loadTaxonomyConstraints();
    const toiletSubs = constraints.Maintenance_Object_to_Sub_Location['toilet'];
    expect(toiletSubs).toContain('bathroom');
    expect(toiletSubs).not.toContain('bedroom');
    expect(toiletSubs).not.toContain('kitchen');
  });

  // M1: Validate each Sub_Location appears in exactly one Location
  it('each Sub_Location belongs to exactly one Location', () => {
    constraints = loadTaxonomyConstraints();
    const subToLocations = new Map<string, string[]>();
    for (const [loc, subs] of Object.entries(constraints.Location_to_Sub_Location)) {
      for (const sub of subs) {
        if (!subToLocations.has(sub)) subToLocations.set(sub, []);
        subToLocations.get(sub)!.push(loc);
      }
    }
    for (const [sub, locs] of subToLocations) {
      expect(
        locs,
        `Sub_Location "${sub}" appears in multiple Locations: ${locs.join(', ')}`,
      ).toHaveLength(1);
    }
  });

  it('other_maintenance_category appears in Maintenance_Category_to_Maintenance_Object', () => {
    constraints = loadTaxonomyConstraints();
    expect(
      constraints.Maintenance_Category_to_Maintenance_Object['other_maintenance_category'],
    ).toBeDefined();
  });
});

describe('constraint coverage completeness', () => {
  // Values intentionally excluded from parent constraint mappings.
  // Documented in taxonomy_constraints.json _meta.not_applicable_policy.
  const PARENT_EXCLUSIONS: Record<string, string[]> = {
    Maintenance_Category: ['not_applicable'],
    Maintenance_Object: ['not_applicable'],
  };

  const CONSTRAINT_MAP_PARENTS: Array<{
    mapName: keyof TaxonomyConstraints;
    parentField: keyof typeof taxonomy;
  }> = [
    { mapName: 'Location_to_Sub_Location', parentField: 'Location' },
    { mapName: 'Sub_Location_to_Maintenance_Category', parentField: 'Sub_Location' },
    { mapName: 'Maintenance_Category_to_Maintenance_Object', parentField: 'Maintenance_Category' },
    { mapName: 'Maintenance_Object_to_Maintenance_Problem', parentField: 'Maintenance_Object' },
    { mapName: 'Maintenance_Object_to_Sub_Location', parentField: 'Maintenance_Object' },
  ];

  for (const { mapName, parentField } of CONSTRAINT_MAP_PARENTS) {
    it(`every ${parentField} value has a ${mapName} entry or is excluded`, () => {
      const constraints = loadTaxonomyConstraints();
      const map = constraints[mapName] as unknown as Record<string, readonly string[]>;
      const excluded = PARENT_EXCLUSIONS[parentField] ?? [];
      const parentValues = taxonomy[parentField];
      const missing = parentValues.filter(
        (val: string) => !map[val] && !excluded.includes(val),
      );
      expect(missing, `Missing ${mapName} entries: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
