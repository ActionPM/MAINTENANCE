import { describe, it, expect } from 'vitest';
import { getTaxonomyLabel, getFieldLabel } from '../taxonomy-labels.js';

describe('getFieldLabel', () => {
  it('returns mapped label for Maintenance_Category', () => {
    expect(getFieldLabel('Maintenance_Category')).toBe('Maintenance type');
  });

  it('returns mapped label for Sub_Location', () => {
    expect(getFieldLabel('Sub_Location')).toBe('Sub-location');
  });

  it('returns mapped label for Category', () => {
    expect(getFieldLabel('Category')).toBe('Category');
  });

  it('returns mapped label for Location', () => {
    expect(getFieldLabel('Location')).toBe('Location');
  });

  it('returns mapped label for Maintenance_Object', () => {
    expect(getFieldLabel('Maintenance_Object')).toBe('Maintenance object');
  });

  it('returns mapped label for Maintenance_Problem', () => {
    expect(getFieldLabel('Maintenance_Problem')).toBe('Problem');
  });

  it('returns mapped label for Management_Category', () => {
    expect(getFieldLabel('Management_Category')).toBe('Management type');
  });

  it('returns mapped label for Management_Object', () => {
    expect(getFieldLabel('Management_Object')).toBe('Management object');
  });

  it('returns mapped label for Priority', () => {
    expect(getFieldLabel('Priority')).toBe('Priority');
  });

  it('falls back to underscore-replaced string for unknown fields', () => {
    expect(getFieldLabel('Unknown_Field')).toBe('Unknown Field');
  });

  it('falls back for single-word unknown field', () => {
    expect(getFieldLabel('Foo')).toBe('Foo');
  });
});

describe('getTaxonomyLabel (existing)', () => {
  it('returns mapped value label', () => {
    expect(getTaxonomyLabel('Category', 'maintenance')).toBe('Maintenance');
  });

  it('falls back for unknown value', () => {
    expect(getTaxonomyLabel('Category', 'unknown_value')).toBe('Unknown value');
  });
});
