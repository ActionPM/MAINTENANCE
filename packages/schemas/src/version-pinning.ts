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
}

/**
 * Authoritative version constants.
 * Bump these when the corresponding artifact changes.
 */
export const TAXONOMY_VERSION = '1.0.0';
export const SCHEMA_VERSION = '1.0.0';
export const PROMPT_VERSION = '1.0.0';
export const DEFAULT_MODEL_ID = 'claude-sonnet-4-20250514';

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
  };
}

/**
 * Assert that a restored session's pinned versions have not been tampered with.
 * Returns true if all four fields are non-empty strings.
 * Used as a defense-in-depth guard on the resume path.
 */
export function assertPinnedVersionsIntact(versions: PinnedVersions): boolean {
  return (
    typeof versions.taxonomy_version === 'string' &&
    versions.taxonomy_version.length > 0 &&
    typeof versions.schema_version === 'string' &&
    versions.schema_version.length > 0 &&
    typeof versions.model_id === 'string' &&
    versions.model_id.length > 0 &&
    typeof versions.prompt_version === 'string' &&
    versions.prompt_version.length > 0
  );
}
