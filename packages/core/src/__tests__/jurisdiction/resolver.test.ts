import { describe, it, expect } from 'vitest';
import { resolveJurisdiction, getRegisteredJurisdictions } from '../../jurisdiction/resolver.js';

describe('resolveJurisdiction (S01-12)', () => {
  it('resolves Toronto by jurisdiction_id', () => {
    const result = resolveJurisdiction({ jurisdiction_id: 'on-toronto' });
    expect(result.jurisdiction_id).toBe('on-toronto');
    expect(result.compliance_framework).toBe('RentSafeTO');
  });

  it('resolves Toronto by postal code prefix M', () => {
    const result = resolveJurisdiction({ postal_code_prefix: 'M5V' });
    expect(result.jurisdiction_id).toBe('on-toronto');
    expect(result.compliance_framework).toBe('RentSafeTO');
  });

  it('resolves Vancouver by postal code prefix V', () => {
    const result = resolveJurisdiction({ postal_code_prefix: 'V6B' });
    expect(result.jurisdiction_id).toBe('bc-vancouver');
    expect(result.compliance_framework).toBe('BC_RTA');
  });

  it('returns default jurisdiction for unknown postal code', () => {
    const result = resolveJurisdiction({ postal_code_prefix: 'X0A' });
    expect(result.jurisdiction_id).toBe('default');
  });

  it('returns default when no input provided', () => {
    const result = resolveJurisdiction({});
    expect(result.jurisdiction_id).toBe('default');
  });

  it('prefers jurisdiction_id over postal code', () => {
    const result = resolveJurisdiction({
      jurisdiction_id: 'bc-vancouver',
      postal_code_prefix: 'M5V',
    });
    expect(result.jurisdiction_id).toBe('bc-vancouver');
  });

  it('lists registered jurisdictions', () => {
    const all = getRegisteredJurisdictions();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.some((j) => j.compliance_framework === 'RentSafeTO')).toBe(true);
  });
});
