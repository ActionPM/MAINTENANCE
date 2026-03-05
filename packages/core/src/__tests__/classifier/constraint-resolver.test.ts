import { describe, it, expect } from 'vitest';
import { resolveValidOptions, resolveConstraintImpliedFields } from '../../classifier/constraint-resolver.js';
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
    expect(options).not.toContain('fridge');
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

  // I2: other_* values as parents
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
    expect(options).toContain('other_maintenance_object');
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
  it('implies Sub_Location=bathroom when Object=toilet and Location=suite', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
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

  it('implies Sub_Location=kitchen for fridge', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Object: 'fridge',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBe('kitchen');
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

  it('DOES resolve fields set to "general" (vague marker) — I1 fix', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Object: 'toilet',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Sub_Location']).toBe('bathroom');
  });
});
