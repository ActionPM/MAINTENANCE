'use client';

import styles from './confirmation-panel.module.css';

interface ConfirmationIssue {
  issue_id: string;
  summary: string;
  raw_excerpt: string;
  classification: Record<string, string>;
  confidence_by_field: Record<string, number>;
  missing_fields: readonly string[];
  needs_human_triage: boolean;
}

interface ConfirmationPanelProps {
  payload: { issues: readonly ConfirmationIssue[] };
  onConfirm: () => void;
  disabled?: boolean;
}

export function ConfirmationPanel({
  payload,
  onConfirm,
  disabled = false,
}: ConfirmationPanelProps) {
  return (
    <div className={styles.container}>
      <p className={styles.heading}>Please review before submitting:</p>

      {payload.issues.map((issue) => (
        <div key={issue.issue_id} className={styles.issueCard}>
          <p className={styles.issueSummary}>{issue.summary}</p>

          <div className={styles.labels}>
            {Object.entries(issue.classification).map(([field, value]) => (
              <span key={field} className={styles.label}>
                {value}
              </span>
            ))}
          </div>

          {issue.needs_human_triage && <span className={styles.triageBadge}>Review needed</span>}

          {issue.missing_fields.length > 0 && (
            <p className={styles.missingFields}>Missing: {issue.missing_fields.join(', ')}</p>
          )}
        </div>
      ))}

      <div className={styles.actions}>
        <button className={styles.submitBtn} onClick={onConfirm} disabled={disabled}>
          Submit work order{payload.issues.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}
