'use client';

import { useState } from 'react';
import styles from './split-review.module.css';

interface Issue {
  issue_id: string;
  summary: string;
  raw_excerpt: string;
}

interface SplitReviewProps {
  issues: readonly Issue[];
  onConfirm: () => void;
  onReject: () => void;
  onEdit: (issueId: string, summary: string) => void;
  onMerge: (issueIds: readonly string[]) => void;
  onAdd: (summary: string) => void;
  disabled?: boolean;
}

export function SplitReview({
  issues,
  onConfirm,
  onReject,
  onEdit,
  onMerge,
  onAdd,
  disabled = false,
}: SplitReviewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function startEdit(issue: Issue) {
    setEditingId(issue.issue_id);
    setEditValue(issue.summary);
  }

  function saveEdit() {
    if (editingId && editValue.trim()) {
      onEdit(editingId, editValue.trim());
      setEditingId(null);
      setEditValue('');
    }
  }

  function startAdd() {
    setAdding(true);
    setAddValue('');
  }

  function saveAdd() {
    if (addValue.trim()) {
      onAdd(addValue.trim());
      setAdding(false);
      setAddValue('');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMerge() {
    if (selected.size >= 2) {
      onMerge(Array.from(selected));
      setSelected(new Set());
    }
  }

  return (
    <div className={styles.container}>
      <p className={styles.heading}>
        We identified {issues.length} issue{issues.length !== 1 ? 's' : ''} in your message:
      </p>

      <ul className={styles.issueList}>
        {issues.map((issue) => (
          <li key={issue.issue_id} className={styles.issueItem}>
            {issues.length > 1 && (
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.has(issue.issue_id)}
                onChange={() => toggleSelect(issue.issue_id)}
                disabled={disabled}
              />
            )}

            {editingId === issue.issue_id ? (
              <>
                <input
                  className={styles.editInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  maxLength={500}
                />
                <button className={styles.btnSmall} onClick={saveEdit} disabled={disabled}>
                  Save
                </button>
                <button
                  className={styles.btnSmall}
                  onClick={() => setEditingId(null)}
                  disabled={disabled}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className={styles.issueSummary}>{issue.summary}</span>
                <button
                  className={styles.btnSmall}
                  onClick={() => startEdit(issue)}
                  disabled={disabled}
                  aria-label={`Edit ${issue.summary}`}
                >
                  Edit
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div>
          <input
            className={styles.addInput}
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            placeholder="Describe the additional issue..."
            maxLength={500}
          />
          <div className={styles.actions}>
            <button className={styles.btnSmall} onClick={saveAdd} disabled={disabled}>
              Save
            </button>
            <button
              className={styles.btnSmall}
              onClick={() => setAdding(false)}
              disabled={disabled}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.btnPrimary} onClick={onConfirm} disabled={disabled}>
          Confirm
        </button>
        <button className={styles.btnSecondary} onClick={onReject} disabled={disabled}>
          Reject
        </button>
        {selected.size >= 2 && (
          <button className={styles.btnSecondary} onClick={handleMerge} disabled={disabled}>
            Merge selected
          </button>
        )}
        {!adding && (
          <button className={styles.btnSecondary} onClick={startAdd} disabled={disabled}>
            Add issue
          </button>
        )}
      </div>
    </div>
  );
}
