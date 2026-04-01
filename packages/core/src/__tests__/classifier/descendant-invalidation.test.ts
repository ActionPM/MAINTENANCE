import { describe, it, expect } from 'vitest';
import {
  invalidateStaleDescendants,
  getForwardDescendants,
} from '../../classifier/descendant-invalidation.js';
import { loadTaxonomyConstraints } from '@wo-agent/schemas';

const constraints = loadTaxonomyConstraints();

describe('getForwardDescendants', () => {
  it('returns Sub_Location through Maintenance_Problem for Location', () => {
    expect(getForwardDescendants('Location')).toEqual([
      'Sub_Location',
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
    ]);
  });

  it('returns Maintenance_Category through Maintenance_Problem for Sub_Location', () => {
    expect(getForwardDescendants('Sub_Location')).toEqual([
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
    ]);
  });

  it('returns empty array for Maintenance_Problem (leaf field)', () => {
    expect(getForwardDescendants('Maintenance_Problem')).toEqual([]);
  });

  it('returns empty array for unknown fields', () => {
    expect(getForwardDescendants('Priority')).toEqual([]);
  });
});

describe('invalidateStaleDescendants', () => {
  it('clears Maintenance_Category when Sub_Location changes to an incompatible value', () => {
    // appliance is valid for kitchen but NOT for bathroom
    const classification: Record<string, string> = {
      Location: 'suite',
      Sub_Location: 'bathroom', // changed from kitchen to bathroom
      Maintenance_Category: 'appliance',
      Maintenance_Object: 'fridge',
      Maintenance_Problem: 'not_working',
    };
    const pins: Record<string, string> = { Maintenance_Category: 'appliance' };

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    // appliance is not valid for bathroom → clear Category
    // Category cleared → Object and Problem cleared unconditionally
    expect(result.clearedFields).toHaveLength(3);
    expect(result.clearedFields[0]).toEqual({
      field: 'Maintenance_Category',
      oldValue: 'appliance',
      wasPinned: true,
    });
    expect(result.clearedFields[1]).toEqual({
      field: 'Maintenance_Object',
      oldValue: 'fridge',
      wasPinned: false,
    });
    expect(result.clearedFields[2]).toEqual({
      field: 'Maintenance_Problem',
      oldValue: 'not_working',
      wasPinned: false,
    });
  });

  it('cascades: clearing Maintenance_Category also clears Object and Problem', () => {
    // pest_control is valid for kitchen but NOT for parking_garage
    const classification: Record<string, string> = {
      Location: 'building_interior',
      Sub_Location: 'parking_garage', // changed to parking_garage
      Maintenance_Category: 'pest_control',
      Maintenance_Object: 'rodents',
      Maintenance_Problem: 'infestation',
    };
    const pins: Record<string, string> = {};

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    expect(result.clearedFields).toHaveLength(3);
    expect(result.clearedFields.map((c) => c.field)).toEqual([
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
    ]);
  });

  it('does not clear valid descendants', () => {
    // plumbing is valid for both kitchen and bathroom
    const classification: Record<string, string> = {
      Location: 'suite',
      Sub_Location: 'kitchen', // changed from bathroom to kitchen
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'faucet',
      Maintenance_Problem: 'leak',
    };
    const pins: Record<string, string> = { Maintenance_Category: 'plumbing' };

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    // plumbing is valid for kitchen → no clearing
    expect(result.clearedFields).toHaveLength(0);
    expect(result.earliestClearedPin).toBeNull();
  });

  it('attributes wasPinned correctly: pinned vs unpinned', () => {
    // pest_control is pinned, rodents and infestation are classifier guesses
    const classification: Record<string, string> = {
      Sub_Location: 'parking_garage',
      Maintenance_Category: 'pest_control',
      Maintenance_Object: 'rodents',
      Maintenance_Problem: 'infestation',
    };
    const pins: Record<string, string> = { Maintenance_Category: 'pest_control' };

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    expect(result.clearedFields).toHaveLength(3);
    expect(result.clearedFields[0].wasPinned).toBe(true); // Maintenance_Category
    expect(result.clearedFields[1].wasPinned).toBe(false); // Maintenance_Object
    expect(result.clearedFields[2].wasPinned).toBe(false); // Maintenance_Problem
  });

  it('returns earliestClearedPin as the first pin in hierarchy order', () => {
    const classification: Record<string, string> = {
      Sub_Location: 'parking_garage',
      Maintenance_Category: 'pest_control',
      Maintenance_Object: 'rodents',
      Maintenance_Problem: 'infestation',
    };
    const pins: Record<string, string> = {
      Maintenance_Category: 'pest_control',
      Maintenance_Object: 'rodents',
    };

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    expect(result.earliestClearedPin).not.toBeNull();
    expect(result.earliestClearedPin!.field).toBe('Maintenance_Category');
    expect(result.clearedPinFields).toEqual(['Maintenance_Category', 'Maintenance_Object']);
  });

  it('returns null earliestClearedPin when only classifier guesses are cleared', () => {
    const classification: Record<string, string> = {
      Sub_Location: 'parking_garage',
      Maintenance_Category: 'pest_control',
      Maintenance_Object: 'rodents',
    };
    // No pins — all are classifier guesses
    const pins: Record<string, string> = {};

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    expect(result.clearedFields.length).toBeGreaterThan(0);
    expect(result.earliestClearedPin).toBeNull();
    expect(result.clearedPinFields).toEqual([]);
  });

  it('handles empty descendants (changedParent is Maintenance_Problem)', () => {
    const classification: Record<string, string> = {
      Maintenance_Problem: 'leak',
    };
    const pins: Record<string, string> = {};

    const result = invalidateStaleDescendants(
      'Maintenance_Problem',
      classification,
      pins,
      constraints,
    );

    expect(result.clearedFields).toEqual([]);
    expect(result.earliestClearedPin).toBeNull();
  });

  it('skips vague/unresolved descendants without clearing', () => {
    const classification: Record<string, string> = {
      Sub_Location: 'parking_garage',
      Maintenance_Category: 'pest_control',
      Maintenance_Object: 'general', // vague value
      Maintenance_Problem: '',
    };
    const pins: Record<string, string> = {};

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    // pest_control is invalid for parking_garage → clear Category
    // Maintenance_Object is 'general' (vague) → skip, reset parentJustCleared
    // Maintenance_Problem is '' (empty) → skip
    expect(result.clearedFields).toHaveLength(1);
    expect(result.clearedFields[0].field).toBe('Maintenance_Category');
  });

  it('full cascade from Location change clears 4 descendants', () => {
    // bathroom is valid for suite but NOT for building_exterior
    const classification: Record<string, string> = {
      Location: 'building_exterior',
      Sub_Location: 'bathroom',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };
    const pins: Record<string, string> = {
      Sub_Location: 'bathroom',
      Maintenance_Object: 'toilet',
    };

    const result = invalidateStaleDescendants('Location', classification, pins, constraints);

    expect(result.clearedFields).toHaveLength(4);
    expect(result.clearedFields.map((c) => c.field)).toEqual([
      'Sub_Location',
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
    ]);
    // Sub_Location and Maintenance_Object were pinned
    expect(result.clearedPinFields).toEqual(['Sub_Location', 'Maintenance_Object']);
    expect(result.earliestClearedPin!.field).toBe('Sub_Location');
  });

  it('catches stale descendant via reverse edge when intermediate parent is blank', () => {
    // Sub_Location changed to bathroom. Maintenance_Category is blank (gap).
    // Forward pass: Category blank → skip. Object = fridge → forward check uses
    // Category_to_Object edge, but Category is blank → null (unconstrained) → passes.
    // Reverse pass: fridge → Maintenance_Object_to_Sub_Location[fridge] = [kitchen].
    // bathroom is NOT in [kitchen] → fridge is invalid.
    const classification: Record<string, string> = {
      Sub_Location: 'bathroom',
      Maintenance_Category: '',
      Maintenance_Object: 'fridge',
      Maintenance_Problem: 'not_working',
    };
    const pins: Record<string, string> = { Maintenance_Object: 'fridge' };

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    // fridge caught by reverse edge, not_working cascade-cleared
    expect(result.clearedFields).toHaveLength(2);
    expect(result.clearedFields[0]).toEqual({
      field: 'Maintenance_Object',
      oldValue: 'fridge',
      wasPinned: true,
    });
    expect(result.clearedFields[1]).toEqual({
      field: 'Maintenance_Problem',
      oldValue: 'not_working',
      wasPinned: false,
    });
    expect(result.earliestClearedPin!.field).toBe('Maintenance_Object');
  });

  it('reverse edge does not clear when descendant is consistent', () => {
    // sink is valid for both kitchen and bathroom via reverse edge
    const classification: Record<string, string> = {
      Sub_Location: 'bathroom',
      Maintenance_Category: '',
      Maintenance_Object: 'sink',
      Maintenance_Problem: 'leak',
    };
    const pins: Record<string, string> = { Maintenance_Object: 'sink' };

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    // sink → Maintenance_Object_to_Sub_Location[sink] = [kitchen, bathroom, laundry]
    // bathroom IS in the list → sink is valid → no clearing
    expect(result.clearedFields).toHaveLength(0);
  });

  it('reverse edge cascade clears forward descendants of the invalidated field', () => {
    // toilet is only valid for bathroom, not kitchen. Category is blank (gap).
    // Reverse edge catches toilet → cascade clears Problem too.
    const classification: Record<string, string> = {
      Sub_Location: 'kitchen',
      Maintenance_Category: '',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'clog',
    };
    const pins: Record<string, string> = {};

    const result = invalidateStaleDescendants('Sub_Location', classification, pins, constraints);

    expect(result.clearedFields).toHaveLength(2);
    expect(result.clearedFields.map((c) => c.field)).toEqual([
      'Maintenance_Object',
      'Maintenance_Problem',
    ]);
  });
});
