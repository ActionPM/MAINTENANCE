'use client';

import { useState } from 'react';
import type { FollowUpQuestion } from '@wo-agent/schemas';
import styles from './followup-form.module.css';

interface FollowupFormProps {
  questions: readonly FollowUpQuestion[];
  onSubmit: (answers: Array<{ question_id: string; answer: unknown }>) => void;
  disabled?: boolean;
}

export function FollowupForm({ questions, onSubmit, disabled = false }: FollowupFormProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const allAnswered = questions.every(
    (q) => answers[q.question_id] !== undefined && answers[q.question_id] !== '',
  );

  function handleSubmit() {
    if (!allAnswered) return;
    const result = questions.map((q) => ({
      question_id: q.question_id,
      answer: answers[q.question_id],
    }));
    onSubmit(result);
  }

  return (
    <div className={styles.container}>
      <p className={styles.heading}>We need a bit more information:</p>

      {questions.map((q) => (
        <div key={q.question_id} className={styles.questionGroup}>
          <p className={styles.questionPrompt}>{q.prompt}</p>

          {(q.answer_type === 'enum' || q.answer_type === 'yes_no') &&
            q.options.map((option) => (
              <label key={option} className={styles.optionLabel}>
                <input
                  type="radio"
                  name={q.question_id}
                  value={option}
                  checked={answers[q.question_id] === option}
                  onChange={() => setAnswer(q.question_id, option)}
                  disabled={disabled}
                />
                {option}
              </label>
            ))}

          {q.answer_type === 'text' && (
            <input
              className={styles.textInput}
              type="text"
              value={(answers[q.question_id] as string) ?? ''}
              onChange={(e) => setAnswer(q.question_id, e.target.value)}
              disabled={disabled}
            />
          )}
        </div>
      ))}

      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={disabled || !allAnswered}
      >
        Submit answers
      </button>
    </div>
  );
}
