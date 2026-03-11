import type { ConfidenceBand } from '../classifier/confidence.js';

const STALENESS_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

export type StalenessReason =
  | 'source_hash_changed'
  | 'split_hash_changed'
  | 'unseen_artifact_expired'
  | 'seen_artifact_borderline_expired';

export interface StalenessInput {
  /** ISO timestamp when tenant_confirmation_pending was entered */
  readonly confirmationEnteredAt: string;
  /** Current ISO timestamp (injected for testability) */
  readonly currentTime: string;
  /** Hash of current source text (raw tenant message) */
  readonly sourceTextHash: string;
  /** Hash of source text when classification was run */
  readonly originalSourceTextHash: string;
  /** Hash of current split issues */
  readonly splitHash: string;
  /** Hash of split issues when classification was run */
  readonly originalSplitHash: string;
  /** Whether the classification artifacts have been shown to the tenant */
  readonly artifactPresentedToTenant: boolean;
  /** Per-field confidence bands from the classification result */
  readonly confidenceBands: Readonly<Record<string, ConfidenceBand>>;
}

export interface StalenessResult {
  readonly isStale: boolean;
  readonly reasons: readonly StalenessReason[];
}

/**
 * Check whether a confirmation is stale per spec §12.3 and §16.
 *
 * Rules:
 * 1. Source text hash changed → stale
 * 2. Split hash changed → stale
 * 3. Unseen artifacts (never presented) → stale if age > 60 min
 * 4. Seen artifacts → stale if age > 60 min AND any field has borderline confidence (medium or low)
 */
export function checkStaleness(input: StalenessInput): StalenessResult {
  const reasons: StalenessReason[] = [];

  // Rule 1: source text hash changed
  if (input.sourceTextHash !== input.originalSourceTextHash) {
    reasons.push('source_hash_changed');
  }

  // Rule 2: split hash changed
  if (input.splitHash !== input.originalSplitHash) {
    reasons.push('split_hash_changed');
  }

  // Compute age
  const ageMs =
    new Date(input.currentTime).getTime() - new Date(input.confirmationEnteredAt).getTime();
  const isOverThreshold = ageMs > STALENESS_THRESHOLD_MS;

  if (isOverThreshold) {
    if (!input.artifactPresentedToTenant) {
      // Rule 3: unseen artifacts always expire after 60 min
      reasons.push('unseen_artifact_expired');
    } else {
      // Rule 4: seen artifacts expire only if borderline confidence
      const hasBorderline = Object.values(input.confidenceBands).some(
        (band) => band === 'medium' || band === 'low',
      );
      if (hasBorderline) {
        reasons.push('seen_artifact_borderline_expired');
      }
    }
  }

  return {
    isStale: reasons.length > 0,
    reasons,
  };
}
