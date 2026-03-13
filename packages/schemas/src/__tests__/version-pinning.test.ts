import { describe, it, expect } from 'vitest';
import {
  resolveCurrentVersions,
  assertPinnedVersionsIntact,
  TAXONOMY_VERSION,
  SCHEMA_VERSION,
  PROMPT_VERSION,
  DEFAULT_MODEL_ID,
} from '../version-pinning.js';

describe('resolveCurrentVersions', () => {
  it('returns all four version fields with defaults', () => {
    const versions = resolveCurrentVersions();
    expect(versions).toEqual({
      taxonomy_version: TAXONOMY_VERSION,
      schema_version: SCHEMA_VERSION,
      model_id: DEFAULT_MODEL_ID,
      prompt_version: PROMPT_VERSION,
    });
  });

  it('uses provided modelId when given', () => {
    const versions = resolveCurrentVersions('claude-opus-4-20250514');
    expect(versions.model_id).toBe('claude-opus-4-20250514');
    expect(versions.taxonomy_version).toBe(TAXONOMY_VERSION);
  });

  it('falls back to DEFAULT_MODEL_ID when modelId is undefined', () => {
    const versions = resolveCurrentVersions(undefined);
    expect(versions.model_id).toBe(DEFAULT_MODEL_ID);
  });

  it('returns non-empty strings for all fields', () => {
    const versions = resolveCurrentVersions();
    for (const [key, value] of Object.entries(versions)) {
      expect(value, `${key} should be non-empty`).toBeTruthy();
      expect(typeof value).toBe('string');
    }
  });
});

describe('assertPinnedVersionsIntact', () => {
  it('returns true for valid pinned versions', () => {
    expect(
      assertPinnedVersionsIntact({
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'claude-sonnet-4-20250514',
        prompt_version: '1.0.0',
      }),
    ).toBe(true);
  });

  it('returns false when taxonomy_version is empty', () => {
    expect(
      assertPinnedVersionsIntact({
        taxonomy_version: '',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
      }),
    ).toBe(false);
  });

  it('returns false when schema_version is empty', () => {
    expect(
      assertPinnedVersionsIntact({
        taxonomy_version: '1.0.0',
        schema_version: '',
        model_id: 'test',
        prompt_version: '1.0.0',
      }),
    ).toBe(false);
  });

  it('returns false when model_id is empty', () => {
    expect(
      assertPinnedVersionsIntact({
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: '',
        prompt_version: '1.0.0',
      }),
    ).toBe(false);
  });

  it('returns false when prompt_version is empty', () => {
    expect(
      assertPinnedVersionsIntact({
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '',
      }),
    ).toBe(false);
  });

  it('returns true for versions from resolveCurrentVersions', () => {
    const versions = resolveCurrentVersions();
    expect(assertPinnedVersionsIntact(versions)).toBe(true);
  });
});
