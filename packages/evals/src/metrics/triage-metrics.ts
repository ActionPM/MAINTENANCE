export interface TriageComparisonInput {
  readonly predicted_needs_human_triage: boolean;
  readonly expected_needs_human_triage: boolean;
}

export function computeTriagePrecision(pairs: readonly TriageComparisonInput[]): number {
  let tp = 0,
    fp = 0;
  for (const { predicted_needs_human_triage, expected_needs_human_triage } of pairs) {
    if (predicted_needs_human_triage) {
      if (expected_needs_human_triage) tp++;
      else fp++;
    }
  }
  return tp + fp > 0 ? tp / (tp + fp) : 1;
}

export function computeTriageRecall(pairs: readonly TriageComparisonInput[]): number {
  let tp = 0,
    fn = 0;
  for (const { predicted_needs_human_triage, expected_needs_human_triage } of pairs) {
    if (expected_needs_human_triage) {
      if (predicted_needs_human_triage) tp++;
      else fn++;
    }
  }
  return tp + fn > 0 ? tp / (tp + fn) : 1;
}
