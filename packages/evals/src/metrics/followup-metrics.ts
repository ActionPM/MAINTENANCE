export interface FollowupComparisonInput {
  readonly predicted_followup_fields: readonly string[];
  readonly expected_followup_fields: readonly string[];
}

/**
 * Follow-up necessity precision: of predicted follow-up fields, how many were expected.
 */
export function computeFollowupPrecision(pairs: readonly FollowupComparisonInput[]): number {
  let tp = 0,
    fp = 0;
  for (const { predicted_followup_fields, expected_followup_fields } of pairs) {
    const expected = new Set(expected_followup_fields);
    for (const field of predicted_followup_fields) {
      if (expected.has(field)) tp++;
      else fp++;
    }
  }
  return tp + fp > 0 ? tp / (tp + fp) : 1;
}

/**
 * Follow-up necessity recall: of expected follow-up fields, how many were predicted.
 */
export function computeFollowupRecall(pairs: readonly FollowupComparisonInput[]): number {
  let tp = 0,
    fn = 0;
  for (const { predicted_followup_fields, expected_followup_fields } of pairs) {
    const predicted = new Set(predicted_followup_fields);
    for (const field of expected_followup_fields) {
      if (predicted.has(field)) tp++;
      else fn++;
    }
  }
  return tp + fn > 0 ? tp / (tp + fn) : 1;
}
