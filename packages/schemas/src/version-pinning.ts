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
