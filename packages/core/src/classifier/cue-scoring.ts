import type { CueDictionary } from '@wo-agent/schemas';

export interface CueFieldResult {
  /** Top cue_strength score across all candidate labels for this field (0..1) */
  readonly score: number;
  /** The label that scored highest, or null if no matches */
  readonly topLabel: string | null;
  /** Ambiguity: how close the top-2 labels are in score (0..1, higher = more ambiguous) */
  readonly ambiguity: number;
  /** All label scores for disagreement detection */
  readonly labelScores: ReadonlyArray<{ label: string; score: number }>;
}

export type CueScoreMap = Record<string, CueFieldResult>;

/**
 * Compute cue_strength for a single taxonomy field (spec 14.4).
 * Keyword hits and regex matches contribute to a normalized 0..1 score
 * per candidate label; the top score becomes cue_strength.
 */
/**
 * Per-hit boost factor for cue scoring normalization.
 * Each keyword/regex hit contributes this much to the score (clamped to 1.0).
 * This replaces hits/totalCues which produced negligible scores for large keyword lists.
 */
const HIT_BOOST = 0.6;

export function computeCueStrengthForField(
  text: string,
  fieldName: string,
  cueDict: CueDictionary,
): CueFieldResult {
  const fieldCues = cueDict.fields[fieldName];
  if (!fieldCues) {
    return { score: 0, topLabel: null, ambiguity: 0, labelScores: [] };
  }

  const scores: Array<{ label: string; score: number }> = [];
  const lowerText = text.toLowerCase();

  for (const [label, cues] of Object.entries(fieldCues)) {
    const totalCues = cues.keywords.length + cues.regex.length;
    if (totalCues === 0) continue;

    let hits = 0;

    // Keyword hits (case-insensitive)
    for (const keyword of cues.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) hits++;
    }

    // Regex hits (case-insensitive, skip invalid patterns)
    for (const pattern of cues.regex) {
      try {
        if (new RegExp(pattern, 'i').test(text)) hits++;
      } catch {
        // Invalid regex pattern -- skip silently
      }
    }

    scores.push({ label, score: Math.min(1, hits * HIT_BOOST) });
  }

  if (scores.length === 0) {
    return { score: 0, topLabel: null, ambiguity: 0, labelScores: [] };
  }

  // Sort descending by score
  scores.sort((a, b) => b.score - a.score);

  const topScore = scores[0].score;
  const topLabel = topScore > 0 ? scores[0].label : null;

  // Ambiguity: how close the top-2 scores are (1.0 = identical, 0.0 = no second candidate)
  let ambiguity = 0;
  if (scores.length >= 2 && topScore > 0) {
    const secondScore = scores[1].score;
    // If top and second are both > 0 and close together, high ambiguity
    ambiguity = secondScore > 0 ? 1 - (topScore - secondScore) / topScore : 0;
  }

  return { score: topScore, topLabel, ambiguity, labelScores: scores };
}

/**
 * Compute cue scores for ALL fields in the cue dictionary (spec 14.4).
 * Returns a map of field name to CueFieldResult.
 */
export function computeCueScores(text: string, cueDict: CueDictionary): CueScoreMap {
  const result: Record<string, CueFieldResult> = {};

  for (const fieldName of Object.keys(cueDict.fields)) {
    result[fieldName] = computeCueStrengthForField(text, fieldName, cueDict);
  }

  return result;
}
