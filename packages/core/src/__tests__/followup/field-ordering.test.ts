import { describe, expect, it } from 'vitest';
import { selectFollowUpFrontierFields } from '../../followup/field-ordering.js';
import { CONSTRAINT_EDGES } from '@wo-agent/schemas';

describe('selectFollowUpFrontierFields', () => {
  it('walks the maintenance hierarchy in order before releasing Priority', () => {
    expect(
      selectFollowUpFrontierFields(
        [
          'Location',
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ],
        { Category: 'maintenance' },
      ),
    ).toEqual(['Location']);

    expect(
      selectFollowUpFrontierFields(
        [
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ],
        { Category: 'maintenance', Location: 'suite' },
      ),
    ).toEqual(['Sub_Location']);

    expect(
      selectFollowUpFrontierFields(
        ['Maintenance_Category', 'Maintenance_Object', 'Maintenance_Problem', 'Priority'],
        { Category: 'maintenance', Location: 'suite', Sub_Location: 'bathroom' },
      ),
    ).toEqual(['Maintenance_Category']);

    expect(
      selectFollowUpFrontierFields(['Maintenance_Object', 'Maintenance_Problem', 'Priority'], {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
      }),
    ).toEqual(['Maintenance_Object']);

    expect(
      selectFollowUpFrontierFields(['Maintenance_Problem', 'Priority'], {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
      }),
    ).toEqual(['Maintenance_Problem']);

    expect(
      selectFollowUpFrontierFields(['Priority'], {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
      }),
    ).toEqual(['Priority']);
  });

  it('does not unlock Maintenance_Category when Sub_Location is general', () => {
    expect(
      selectFollowUpFrontierFields(['Sub_Location', 'Maintenance_Category'], {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'general',
      }),
    ).toEqual(['Sub_Location']);
  });

  it('does not unlock Maintenance_Category when Sub_Location is other_sub_location', () => {
    expect(
      selectFollowUpFrontierFields(['Sub_Location', 'Maintenance_Category'], {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'other_sub_location',
      }),
    ).toEqual(['Sub_Location']);
  });

  it('does not unlock Maintenance_Problem when Maintenance_Object is needs_object', () => {
    expect(
      selectFollowUpFrontierFields(['Maintenance_Object', 'Maintenance_Problem'], {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'needs_object',
      }),
    ).toEqual(['Maintenance_Object']);
  });

  it('returns only the root maintenance field when the classification is empty', () => {
    expect(
      selectFollowUpFrontierFields(
        [
          'Location',
          'Sub_Location',
          'Maintenance_Category',
          'Maintenance_Object',
          'Maintenance_Problem',
          'Priority',
        ],
        { Category: 'maintenance' },
      ),
    ).toEqual(['Location']);
  });

  it('walks the management hierarchy before releasing Priority', () => {
    expect(
      selectFollowUpFrontierFields(['Priority', 'Management_Object', 'Management_Category'], {
        Category: 'management',
      }),
    ).toEqual(['Management_Category']);

    expect(
      selectFollowUpFrontierFields(['Priority', 'Management_Object'], {
        Category: 'management',
        Management_Category: 'accounting',
      }),
    ).toEqual(['Management_Object']);

    expect(
      selectFollowUpFrontierFields(['Priority'], {
        Category: 'management',
        Management_Category: 'accounting',
        Management_Object: 'rent_charges',
        Maintenance_Category: 'not_applicable',
        Maintenance_Object: 'not_applicable',
        Maintenance_Problem: 'not_applicable',
      }),
    ).toEqual(['Priority']);
  });

  it('returns incoming eligible fields unchanged when Category is unresolved', () => {
    expect(
      selectFollowUpFrontierFields(['Priority', 'Management_Object', 'Management_Category'], {}),
    ).toEqual(['Priority', 'Management_Object', 'Management_Category']);
  });

  it('does not let the reverse Maintenance_Object -> Sub_Location edge block Sub_Location', () => {
    expect(
      selectFollowUpFrontierFields(['Sub_Location', 'Maintenance_Object'], {
        Category: 'maintenance',
        Location: 'suite',
      }),
    ).toEqual(['Sub_Location']);
  });

  it('does not let reverse-direction object constraints skip Sub_Location', () => {
    expect(
      selectFollowUpFrontierFields(
        ['Sub_Location', 'Maintenance_Category', 'Maintenance_Problem'],
        {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'general',
          Maintenance_Object: 'toilet',
        },
      ),
    ).toEqual(['Sub_Location']);
  });

  it('uses the expected forward constraint map keys for maintenance ordering', () => {
    expect(CONSTRAINT_EDGES.map((edge) => edge.mapKey)).toEqual(
      expect.arrayContaining([
        'Location_to_Sub_Location',
        'Sub_Location_to_Maintenance_Category',
        'Maintenance_Category_to_Maintenance_Object',
        'Maintenance_Object_to_Maintenance_Problem',
      ]),
    );
  });
});
