'use client';

import { getTaxonomyLabel } from '@wo-agent/schemas';
import styles from './confirmation-panel.module.css';

interface DisplayField {
  field: string;
  field_label: string;
  value: string;
  value_label: string;
}

interface ConfirmationIssue {
  issue_id: string;
  summary: string;
  raw_excerpt: string;
  classification: Record<string, string>;
  confidence_by_field: Record<string, number>;
  missing_fields: readonly string[];
  needs_human_triage: boolean;
  recoverable_via_followup: boolean;
  display_fields?: readonly DisplayField[];
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
  const hasUnrecoverableTriage = payload.issues.some(
    (issue) => issue.needs_human_triage && !issue.recoverable_via_followup,
  );

  return (
    <div className={styles.container}>
      <p className={styles.heading}>
        {hasUnrecoverableTriage
          ? 'Partial classification: a team member will review this request.'
          : 'Please review before submitting:'}
      </p>

      {payload.issues.map((issue) => (
        <div key={issue.issue_id} className={styles.issueCard}>
          <p className={styles.issueSummary}>{issue.summary}</p>

          <div className={styles.labels}>
            {issue.display_fields
              ? issue.display_fields.map((df) => (
                  <div key={df.field} className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{df.field_label}</span>
                    <span className={styles.fieldValue}>{df.value_label}</span>
                  </div>
                ))
              : Object.entries(issue.classification).map(([field, value]) => (
                  <span key={field} className={styles.label}>
                    {getTaxonomyLabel(field, value)}
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
          {hasUnrecoverableTriage
            ? 'Submit for review'
            : `Submit work order${payload.issues.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
