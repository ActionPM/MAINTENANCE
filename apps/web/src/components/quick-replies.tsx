'use client';

import styles from './quick-replies.module.css';

interface Reply {
  label: string;
  value: string;
  action_type?: string;
}

interface QuickRepliesProps {
  replies: readonly Reply[];
  onSelect: (reply: Reply) => void;
  disabled?: boolean;
}

export function QuickReplies({ replies, onSelect, disabled = false }: QuickRepliesProps) {
  if (replies.length === 0) return null;

  return (
    <div className={styles.container}>
      {replies.map((reply) => (
        <button
          key={reply.value}
          className={styles.replyBtn}
          onClick={() => onSelect(reply)}
          disabled={disabled}
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
}
