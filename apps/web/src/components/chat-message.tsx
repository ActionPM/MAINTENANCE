'use client';

import styles from './chat-message.module.css';

interface ChatMessageProps {
  role: 'system' | 'agent' | 'tenant';
  content: string;
  timestamp: string;
}

export function ChatMessage({ role, content, timestamp }: ChatMessageProps) {
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={styles.message} data-role={role}>
      <span className={styles.content}>{content}</span>
      <span className={styles.time}>{time}</span>
    </div>
  );
}
