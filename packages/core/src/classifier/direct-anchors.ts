import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { CueFieldResult, CueScoreMap } from './cue-scoring.js';

export interface DirectAnchorRule {
  readonly categoryLabel: string;
  readonly problemLabel: string;
  readonly objectLabel?: string;
}

/**
 * Obvious maintenance anchor rules (spec §14.4 extension).
 * When cue scoring detects corroborating object+problem signals that match
 * a known common maintenance pattern, the cue_strength for those fields
 * is boosted to 1.0 — reflecting that co-occurring evidence is stronger
 * than isolated single-keyword hits.
 *
 * Labels are validated against taxonomy.json in direct-anchors.test.ts
 * to prevent silent drift.
 */
export const DIRECT_ANCHOR_RULES: readonly DirectAnchorRule[] = [
  // Plumbing object+problem anchors
  { categoryLabel: 'plumbing', objectLabel: 'faucet', problemLabel: 'leak' },
  { categoryLabel: 'plumbing', objectLabel: 'toilet', problemLabel: 'leak' },
  { categoryLabel: 'plumbing', objectLabel: 'toilet', problemLabel: 'clog' },
  { categoryLabel: 'plumbing', objectLabel: 'sink', problemLabel: 'leak' },
  { categoryLabel: 'plumbing', objectLabel: 'sink', problemLabel: 'clog' },
  { categoryLabel: 'plumbing', objectLabel: 'drain', problemLabel: 'clog' },
  { categoryLabel: 'plumbing', objectLabel: 'pipe', problemLabel: 'leak' },
  { categoryLabel: 'plumbing', objectLabel: 'shower', problemLabel: 'leak' },
  { categoryLabel: 'plumbing', objectLabel: 'bathtub', problemLabel: 'leak' },
  { categoryLabel: 'plumbing', objectLabel: 'bathtub', problemLabel: 'clog' },
  // HVAC object+problem anchors
  { categoryLabel: 'hvac', objectLabel: 'radiator', problemLabel: 'no_heat' },
  { categoryLabel: 'hvac', objectLabel: 'thermostat', problemLabel: 'no_heat' },
  // HVAC category+problem anchor (no specific object required)
  { categoryLabel: 'hvac', problemLabel: 'no_heat' },
];

/** Max ambiguity for Maintenance_Category / Maintenance_Problem fields. */
const FIELD_ANCHOR_MAX_AMBIGUITY = 0.5;

/**
 * Detect whether cue scores match a known direct anchor rule.
 * Returns the matched rule or null. Object+problem anchors (more specific)
 * are checked before category+problem anchors (less specific).
 *
 * @param categoryAmbiguityMax - Max Category ambiguity for anchor to fire.
 *   Should match the downstream gating threshold (config.resolved_medium_max_ambiguity)
 *   to prevent the boost from triggering incorrect category gating on mixed-domain text.
 */
export function detectDirectAnchor(
  cueScores: CueScoreMap,
  categoryAmbiguityMax: number,
): DirectAnchorRule | null {
  const catCue = cueScores.Category;
  const maintCatCue = cueScores.Maintenance_Category;
  const objCue = cueScores.Maintenance_Object;
  const probCue = cueScores.Maintenance_Problem;

  // Guard: Category cue must not indicate management
  if (catCue && catCue.topLabel === 'management' && catCue.score > 0) return null;

  // Guard: Category cue must not be ambiguous — the boost sets Category ambiguity
  // to 0 which enables category gating. If original Category was ambiguous between
  // maintenance and management, gating would incorrectly prune management fields.
  if ((catCue?.ambiguity ?? 0) > categoryAmbiguityMax) return null;

  const catLabel = maintCatCue?.topLabel;
  const probLabel = probCue?.topLabel;

  // Need at minimum a category and problem cue signal
  if (!catLabel || !probLabel) return null;
  if ((maintCatCue?.score ?? 0) === 0 || (probCue?.score ?? 0) === 0) return null;

  // Guard: reject if either key field is ambiguous
  if ((maintCatCue?.ambiguity ?? 0) > FIELD_ANCHOR_MAX_AMBIGUITY) return null;
  if ((probCue?.ambiguity ?? 0) > FIELD_ANCHOR_MAX_AMBIGUITY) return null;

  const objLabel = objCue?.topLabel;

  // Phase 1: check object+problem+category anchors (more specific)
  if (objLabel && (objCue?.score ?? 0) > 0) {
    for (const rule of DIRECT_ANCHOR_RULES) {
      if (
        rule.objectLabel &&
        catLabel === rule.categoryLabel &&
        objLabel === rule.objectLabel &&
        probLabel === rule.problemLabel
      ) {
        return rule;
      }
    }
  }

  // Phase 2: check category+problem anchors (no object requirement)
  for (const rule of DIRECT_ANCHOR_RULES) {
    if (!rule.objectLabel && catLabel === rule.categoryLabel && probLabel === rule.problemLabel) {
      return rule;
    }
  }

  return null;
}

function boostField(original: CueFieldResult | undefined, label: string): CueFieldResult {
  if (!original || original.topLabel !== label) {
    return original ?? { score: 0, topLabel: null, ambiguity: 0, labelScores: [] };
  }
  return {
    score: 1.0,
    topLabel: original.topLabel,
    ambiguity: 0,
    labelScores: original.labelScores.map((ls) =>
      ls.label === label ? { ...ls, score: 1.0 } : ls,
    ),
  };
}

/**
 * Apply direct anchor boost to a CueScoreMap.
 * If cue scores match a known obvious-maintenance anchor rule, boosts
 * cue_strength for the corroborated fields to 1.0. Returns the original
 * map unchanged if no anchor matches.
 *
 * @param config - Confidence config, used to derive the Category ambiguity
 *   threshold from config.resolved_medium_max_ambiguity.
 */
export function applyDirectAnchorBoost(
  cueScores: CueScoreMap,
  config: ConfidenceConfig,
): CueScoreMap {
  const match = detectDirectAnchor(cueScores, config.resolved_medium_max_ambiguity);
  if (!match) return cueScores;

  const boosted: CueScoreMap = { ...cueScores };
  boosted.Category = boostField(cueScores.Category, 'maintenance');
  boosted.Maintenance_Category = boostField(cueScores.Maintenance_Category, match.categoryLabel);
  boosted.Maintenance_Problem = boostField(cueScores.Maintenance_Problem, match.problemLabel);

  if (match.objectLabel) {
    boosted.Maintenance_Object = boostField(cueScores.Maintenance_Object, match.objectLabel);
  }

  return boosted;
}
