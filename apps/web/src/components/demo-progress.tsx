'use client';

import styles from './demo-progress.module.css';

const STEPS = [
  { label: 'Send Message', states: ['intake_started', 'unit_selection_required', 'unit_selected'] },
  { label: 'Review Split', states: ['split_in_progress', 'split_proposed'] },
  { label: 'Classify', states: ['split_finalized', 'classification_in_progress'] },
  { label: 'Follow-ups', states: ['needs_tenant_input'] },
  { label: 'Confirm', states: ['tenant_confirmation_pending'] },
  { label: 'Done', states: ['submitted'] },
];

interface DemoProgressProps {
  state: string | undefined;
}

export function DemoProgress({ state }: DemoProgressProps) {
  if (!state) return null;

  let activeIdx = -1;
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i].states.includes(state)) {
      activeIdx = i;
      break;
    }
  }

  return (
    <div className={styles.container}>
      {STEPS.map((step, i) => {
        let cls = styles.step;
        if (i < activeIdx) cls += ` ${styles.completed}`;
        else if (i === activeIdx) cls += ` ${styles.active}`;

        return (
          <span key={step.label}>
            {i > 0 && <span className={styles.arrow}>&rarr; </span>}
            <span className={cls}>
              {i < activeIdx ? '\u2713 ' : ''}
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
