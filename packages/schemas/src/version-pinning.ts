/**
 * Version pinning (spec §5.2).
 * Every conversation pins these on creation.
 * Resumed conversations retain their pinned versions.
 */
export interface PinnedVersions {
  readonly taxonomy_version: string;
  readonly schema_version: string;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly cue_version: string;
}

/**
 * Authoritative version constants.
 * Bump these when the corresponding artifact changes.
 */
export const TAXONOMY_VERSION = '1.0.0';
export const SCHEMA_VERSION = '1.0.0';
export const PROMPT_VERSION = '2.0.0';
export const DEFAULT_MODEL_ID = 'claude-sonnet-4-20250514';
export const CUE_VERSION = '1.3.0';

/** Default cue_version for pre-migration sessions/WOs that lack the field. */
export const DEFAULT_CUE_VERSION = '1.2.0';

/**
 * Resolve the current runtime versions for pinning on new conversations.
 * @param modelId — the LLM model ID in use (from config or env)
 */
export function resolveCurrentVersions(modelId?: string): PinnedVersions {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    schema_version: SCHEMA_VERSION,
    model_id: modelId ?? DEFAULT_MODEL_ID,
    prompt_version: PROMPT_VERSION,
    cue_version: CUE_VERSION,
  };
}

/**
 * Normalize a PinnedVersions object, injecting defaults for fields missing
 * from pre-migration data. Used on the read path for historical WOs and
 * resumed sessions.
 */
export function normalizePinnedVersions(
  versions: Record<string, unknown>,
): PinnedVersions {
  return {
    taxonomy_version: versions.taxonomy_version as string,
    schema_version: versions.schema_version as string,
    model_id: versions.model_id as string,
    prompt_version: versions.prompt_version as string,
    cue_version: (versions.cue_version as string) ?? DEFAULT_CUE_VERSION,
  };
}

/**
 * Assert that a restored session's pinned versions have not been tampered with.
 * Returns true if all five fields are non-empty strings.
 * Used as a defense-in-depth guard on the resume path.
 */
/**
 * Compare two semver strings numerically.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Handles major.minor.patch correctly (e.g., '10.0.0' > '2.0.0').
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function assertPinnedVersionsIntact(versions: PinnedVersions): boolean {
  return (
    typeof versions.taxonomy_version === 'string' &&
    versions.taxonomy_version.length > 0 &&
    typeof versions.schema_version === 'string' &&
    versions.schema_version.length > 0 &&
    typeof versions.model_id === 'string' &&
    versions.model_id.length > 0 &&
    typeof versions.prompt_version === 'string' &&
    versions.prompt_version.length > 0 &&
    typeof versions.cue_version === 'string' &&
    versions.cue_version.length > 0
  );
}
