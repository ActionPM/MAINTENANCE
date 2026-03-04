'use client';

import { useState } from 'react';
import styles from './message-input.module.css';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxChars?: number;
}

export function MessageInput({
  onSend,
  disabled = false,
  placeholder = 'Describe your issue...',
  maxChars = 8000,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const showCount = value.length > maxChars * 0.8;
  const overLimit = value.length > maxChars;

  function handleSend() {
    if (!trimmed || disabled || overLimit) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div>
      <div className={styles.container}>
        <textarea
          className={styles.textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={maxChars}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={disabled || !trimmed || overLimit}
          aria-label="Send"
        >
          Send
        </button>
      </div>
      {showCount && (
        <div className={styles.charCount} data-over={overLimit}>
          {value.length} / {maxChars}
        </div>
      )}
    </div>
  );
}
