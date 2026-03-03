import { describe, it, expect } from 'vitest';
import {
  checkStaleness,
  type StalenessInput,
  type StalenessResult,
} from '../../confirmation/staleness.js';

const SIXTY_ONE_MINUTES_MS = 61 * 60 * 1000;
const FIFTY_NINE_MINUTES_MS = 59 * 60 * 1000;

function makeInput(overrides: Partial<StalenessInput> = {}): StalenessInput {
  return {
    confirmationEnteredAt: '2026-01-01T10:00:00.000Z',
    currentTime: '2026-01-01T10:30:00.000Z', // 30 min later — not stale
    sourceTextHash: 'abc123',
    originalSourceTextHash: 'abc123',
    splitHash: 'def456',
    originalSplitHash: 'def456',
    artifactPresentedToTenant: true,
    confidenceBands: { Category: 'high', Maintenance_Category: 'high' },
    ...overrides,
  };
}

describe('checkStaleness', () => {
  it('returns fresh when under 60 min, hashes match, high confidence', () => {
    const result = checkStaleness(makeInput());
    expect(result.isStale).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('returns stale when source text hash changed', () => {
    const result = checkStaleness(makeInput({
      sourceTextHash: 'changed',
    }));
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain('source_hash_changed');
  });

  it('returns stale when split hash changed', () => {
    const result = checkStaleness(makeInput({
      splitHash: 'changed',
    }));
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain('split_hash_changed');
  });

  it('returns stale when unseen artifact is over 60 minutes old', () => {
    const result = checkStaleness(makeInput({
      artifactPresentedToTenant: false,
      confirmationEnteredAt: '2026-01-01T09:00:00.000Z',
      currentTime: '2026-01-01T10:01:00.000Z', // 61 min
    }));
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain('unseen_artifact_expired');
  });

  it('returns fresh when unseen artifact is under 60 minutes old', () => {
    const result = checkStaleness(makeInput({
      artifactPresentedToTenant: false,
      confirmationEnteredAt: '2026-01-01T09:02:00.000Z',
      currentTime: '2026-01-01T10:01:00.000Z', // 59 min
    }));
    expect(result.isStale).toBe(false);
  });

  it('returns stale when seen artifact is over 60 min AND has borderline confidence', () => {
    const result = checkStaleness(makeInput({
      artifactPresentedToTenant: true,
      confirmationEnteredAt: '2026-01-01T09:00:00.000Z',
      currentTime: '2026-01-01T10:01:00.000Z', // 61 min
      confidenceBands: { Category: 'high', Maintenance_Category: 'medium' },
    }));
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain('seen_artifact_borderline_expired');
  });

  it('returns fresh when seen artifact is over 60 min but all confidence is high', () => {
    const result = checkStaleness(makeInput({
      artifactPresentedToTenant: true,
      confirmationEnteredAt: '2026-01-01T09:00:00.000Z',
      currentTime: '2026-01-01T10:01:00.000Z', // 61 min
      confidenceBands: { Category: 'high', Maintenance_Category: 'high' },
    }));
    expect(result.isStale).toBe(false);
  });

  it('returns stale when seen artifact is over 60 min and has low confidence', () => {
    const result = checkStaleness(makeInput({
      artifactPresentedToTenant: true,
      confirmationEnteredAt: '2026-01-01T09:00:00.000Z',
      currentTime: '2026-01-01T10:01:00.000Z',
      confidenceBands: { Category: 'low', Maintenance_Category: 'high' },
    }));
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain('seen_artifact_borderline_expired');
  });

  it('accumulates multiple staleness reasons', () => {
    const result = checkStaleness(makeInput({
      sourceTextHash: 'changed',
      splitHash: 'also-changed',
    }));
    expect(result.isStale).toBe(true);
    expect(result.reasons).toContain('source_hash_changed');
    expect(result.reasons).toContain('split_hash_changed');
  });
});
