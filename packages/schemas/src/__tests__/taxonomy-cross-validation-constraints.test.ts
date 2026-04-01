import { describe, it, expect } from 'vitest';
import { validateHierarchicalConstraints } from '../validators/taxonomy-cross-validator.js';
import { loadTaxonomyConstraints } from '../taxonomy-constraints.js';

const constraints = loadTaxonomyConstraints();

describe('validateHierarchicalConstraints', () => {
  it('passes for toilet + bathroom + plumbing + leak', () => {
    const result = validateHierarchicalConstraints(
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'other_mgmt_obj',
        Priority: 'high',
      },
      constraints,
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('flags toilet in bedroom', () => {
    const result = validateHierarchicalConstraints(
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bedroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'other_mgmt_obj',
        Priority: 'normal',
      },
      constraints,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('toilet') && v.includes('bedroom'))).toBe(true);
  });

  it('flags no_heat for a shelf', () => {
    const result = validateHierarchicalConstraints(
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'closets',
        Maintenance_Category: 'carpentry',
        Maintenance_Object: 'shelf',
        Maintenance_Problem: 'no_heat',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'other_mgmt_obj',
        Priority: 'normal',
      },
      constraints,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('shelf') && v.includes('no_heat'))).toBe(true);
  });

  it('passes for management issues (skips maintenance constraints)', () => {
    const result = validateHierarchicalConstraints(
      {
        Category: 'management',
        Location: 'suite',
        Sub_Location: 'general',
        Maintenance_Category: 'other_maintenance_category',
        Maintenance_Object: 'other_object',
        Maintenance_Problem: 'other_problem',
        Management_Category: 'accounting',
        Management_Object: 'rent_charges',
        Priority: 'normal',
      },
      constraints,
    );
    expect(result.valid).toBe(true);
  });

  it('passes when parent or child is an other_* value', () => {
    const result = validateHierarchicalConstraints(
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'general',
        Maintenance_Category: 'other_maintenance_category',
        Maintenance_Object: 'other_object',
        Maintenance_Problem: 'other_problem',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'other_mgmt_obj',
        Priority: 'normal',
      },
      constraints,
    );
    expect(result.valid).toBe(true);
  });

  it('passes for partial classification', () => {
    const result = validateHierarchicalConstraints(
      { Category: 'maintenance', Location: 'suite' },
      constraints,
    );
    expect(result.valid).toBe(true);
  });
});
