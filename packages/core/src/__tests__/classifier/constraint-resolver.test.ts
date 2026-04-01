import { describe, it, expect } from 'vitest';
import {
  resolveValidOptions,
  resolveConstraintImpliedFields,
} from '../../classifier/constraint-resolver.js';
import { loadTaxonomyConstraints } from '@wo-agent/schemas';

const constraints = loadTaxonomyConstraints();

describe('resolveValidOptions', () => {
  it('returns only suite sub-locations when Location=suite', () => {
    const classification = { Location: 'suite' };
    const options = resolveValidOptions('Sub_Location', classification, constraints);
    expect(options).toContain('kitchen');
    expect(options).toContain('bathroom');
    expect(options).not.toContain('parking_garage');
    expect(options).not.toContain('elevator');
  });

  it('returns only plumbing objects when Maintenance_Category=plumbing', () => {
    const classification = { Maintenance_Category: 'plumbing' };
    const options = resolveValidOptions('Maintenance_Object', classification, constraints);
    expect(options).toContain('toilet');
    expect(options).toContain('sink');
    expect(options).not.toContain('breaker');
    expect(options).not.toContain('light');
  });

  it('returns only valid problems for toilet', () => {
    const classification = { Maintenance_Object: 'toilet' };
    const options = resolveValidOptions('Maintenance_Problem', classification, constraints);
    expect(options).toContain('leak');
    expect(options).toContain('clog');
    expect(options).not.toContain('no_heat');
    expect(options).not.toContain('infestation');
  });

  it('intersects constraints from multiple parents', () => {
    const classification = { Location: 'suite', Maintenance_Object: 'toilet' };
    const options = resolveValidOptions('Sub_Location', classification, constraints);
    expect(options).toEqual(['bathroom']);
  });

  it('returns null when no parent is classified', () => {
    const options = resolveValidOptions('Sub_Location', {}, constraints);
    expect(options).toBeNull();
  });

  it('returns full problem list for other_object', () => {
    const classification = { Maintenance_Object: 'other_object' };
    const options = resolveValidOptions('Maintenance_Problem', classification, constraints);
    expect(options).toContain('leak');
    expect(options).toContain('infestation');
    expect(options).toContain('other_problem');
  });

  it('returns objects for other_maintenance_category', () => {
    const classification = { Maintenance_Category: 'other_maintenance_category' };
    const options = resolveValidOptions('Maintenance_Object', classification, constraints);
    expect(options).toContain('other_object');
    expect(options).toContain('needs_object');
  });

  it('handles needs_object parent gracefully', () => {
    const classification = { Maintenance_Object: 'needs_object' };
    const options = resolveValidOptions('Maintenance_Problem', classification, constraints);
    expect(options).toContain('leak');
    expect(options!.length).toBeGreaterThan(5);
  });

  it('returns null for fields with no constraint edges (e.g., Category)', () => {
    const options = resolveValidOptions('Category', { Location: 'suite' }, constraints);
    expect(options).toBeNull();
  });
});

describe('resolveConstraintImpliedFields', () => {
  it('does not imply Sub_Location from Maintenance_Object by default', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBeUndefined();
  });

  it('can imply Sub_Location from Maintenance_Object when all constraint directions are enabled', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints, undefined, {
      mode: 'all',
    });
    expect(implied['Sub_Location']).toBe('bathroom');
  });

  it('does not imply when multiple options exist', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBeUndefined();
  });

  it('does not imply Sub_Location=kitchen for fridge by default', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Object: 'fridge',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBeUndefined();
  });

  it('does NOT overwrite already-classified specific values', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'bathroom',
      Maintenance_Object: 'toilet',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBeUndefined();
  });

  it('does not auto-resolve "general" from reverse constraints by default', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Object: 'toilet',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBeUndefined();
  });

  it('still supports resolving "general" when all constraint directions are enabled', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Object: 'toilet',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints, undefined, {
      mode: 'all',
    });
    expect(implied['Sub_Location']).toBe('bathroom');
  });

  it('does NOT auto-resolve needs_object - it triggers follow-up instead', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'needs_object',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Maintenance_Object']).toBeUndefined();
  });

  it('still leaves needs_object unresolved even when another field is vague', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Object: 'needs_object',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Maintenance_Object']).toBeUndefined();
  });
});

describe('appliance-leak cross-category constraint', () => {
  it('dishwasher is reachable under plumbing for kitchen leaks', () => {
    const objects = resolveValidOptions(
      'Maintenance_Object',
      {
        Sub_Location: 'kitchen',
        Maintenance_Category: 'plumbing',
      },
      constraints,
    );
    expect(objects).toContain('dishwasher');
    expect(objects).toContain('fridge');
  });

  it('dishwasher still reachable under appliance', () => {
    const objects = resolveValidOptions(
      'Maintenance_Object',
      {
        Sub_Location: 'kitchen',
        Maintenance_Category: 'appliance',
      },
      constraints,
    );
    expect(objects).toContain('dishwasher');
  });

  it('leak is a valid problem for dishwasher', () => {
    const problems = resolveValidOptions(
      'Maintenance_Problem',
      {
        Maintenance_Object: 'dishwasher',
      },
      constraints,
    );
    expect(problems).toContain('leak');
  });
});

describe('not_applicable bypass', () => {
  it('returns null (unconstrained) when Maintenance_Category is not_applicable', () => {
    const result = resolveValidOptions(
      'Maintenance_Object',
      {
        Category: 'management',
        Maintenance_Category: 'not_applicable',
      },
      constraints,
    );
    expect(result).toBeNull();
  });

  it('returns null (unconstrained) when Maintenance_Object is not_applicable', () => {
    const result = resolveValidOptions(
      'Maintenance_Problem',
      {
        Category: 'management',
        Maintenance_Object: 'not_applicable',
      },
      constraints,
    );
    expect(result).toBeNull();
  });

  it('does not auto-resolve not_applicable via constraint implication', () => {
    const implied = resolveConstraintImpliedFields(
      {
        Category: 'management',
        Maintenance_Category: 'not_applicable',
        Maintenance_Object: 'not_applicable',
      },
      constraints,
    );
    expect(implied).toEqual({});
  });
});
