'use client';

import styles from './status-indicator.module.css';

interface StatusIndicatorProps {
  state: string;
  workOrderIds?: readonly string[];
  onRetry?: () => void;
  onResume?: () => void;
  onStartOver?: () => void;
}

const MESSAGES: Record<string, string> = {
  split_in_progress: 'Analyzing your message...',
  split_finalized: 'Preparing classification...',
  classification_in_progress: 'Classifying your issues...',
  submitted: 'Your work orders have been submitted!',
  llm_error_retryable: 'Something went wrong. You can try again.',
  llm_error_terminal: 'Unable to process your request automatically.',
  intake_abandoned: 'This conversation was paused.',
  intake_expired: 'This session has expired. Please start a new conversation.',
};

const PROCESSING_STATES = new Set([
  'split_in_progress',
  'split_finalized',
  'classification_in_progress',
]);

export function StatusIndicator({
  state,
  workOrderIds,
  onRetry,
  onResume,
  onStartOver,
}: StatusIndicatorProps) {
  const message = MESSAGES[state] ?? state;
  const isProcessing = PROCESSING_STATES.has(state);
  const isSuccess = state === 'submitted';
  const isError = state === 'llm_error_retryable' || state === 'llm_error_terminal';

  return (
    <div className={styles.container} role="status">
      {isProcessing && <div className={styles.spinner} />}

      <p
        className={`${styles.message} ${isSuccess ? styles.success : ''} ${isError ? styles.error : ''}`}
      >
        {message}
      </p>

      {isSuccess && workOrderIds && workOrderIds.length > 0 && (
        <ul className={styles.woList}>
          {workOrderIds.map((id) => (
            <li key={id} className={styles.woItem}>{id}</li>
          ))}
        </ul>
      )}

      {state === 'llm_error_retryable' && onRetry && (
        <button className={styles.actionBtn} onClick={onRetry}>
          Try again
        </button>
      )}

      {state === 'llm_error_terminal' && onStartOver && (
        <button className={styles.actionBtn} onClick={onStartOver}>
          Start over
        </button>
      )}

      {state === 'intake_expired' && onStartOver && (
        <button className={styles.actionBtn} onClick={onStartOver}>
          Start over
        </button>
      )}

      {state === 'intake_abandoned' && onResume && (
        <button className={styles.actionBtn} onClick={onResume}>
          Resume
        </button>
      )}
    </div>
  );
}
