'use client';

import { useCallback } from 'react';
import { useConversation } from '@/hooks/use-conversation';
import { ChatMessage } from './chat-message';
import { MessageInput } from './message-input';
import { UnitSelector } from './unit-selector';
import { SplitReview } from './split-review';
import { FollowupForm } from './followup-form';
import { ConfirmationPanel } from './confirmation-panel';
import { StatusIndicator } from './status-indicator';
import { QuickReplies } from './quick-replies';
import styles from './chat-shell.module.css';

interface ChatShellProps {
  token: string;
  unitIds: readonly string[];
}

const INPUT_STATES = new Set(['intake_started', 'unit_selected']);

const PROCESSING_STATES = new Set([
  'split_in_progress',
  'split_finalized',
  'classification_in_progress',
]);

const TERMINAL_STATES = new Set([
  'submitted',
  'llm_error_retryable',
  'llm_error_terminal',
  'intake_abandoned',
  'intake_expired',
]);

export function ChatShell({ token, unitIds }: ChatShellProps) {
  const conv = useConversation(token);
  const snapshot = conv.response?.conversation_snapshot;
  const directive = conv.response?.ui_directive;
  const state = snapshot?.state;
  const isLoading = conv.status === 'loading';

  const handleQuickReply = useCallback(
    (reply: { label: string; value: string; action_type?: string }) => {
      switch (reply.action_type) {
        case 'CONFIRM_SPLIT':
          return conv.confirmSplit();
        case 'REJECT_SPLIT':
          return conv.rejectSplit();
        case 'CONFIRM_SUBMISSION':
          return conv.confirmSubmission();
        case 'SELECT_UNIT':
          return conv.selectUnit(reply.value);
        case 'RESUME':
          return conv.resumeConversation(conv.conversationId!);
        default:
          // Fallback: treat as additional message text
          return conv.submitAdditionalMessage(reply.value);
      }
    },
    [conv],
  );

  if (!conv.response) {
    return (
      <div className={styles.shell}>
        <div className={styles.header}>Maintenance Portal</div>
        <div className={styles.startContainer}>
          <button className={styles.startBtn} onClick={conv.startConversation}>
            Start a request
          </button>
        </div>
      </div>
    );
  }

  const messages = (directive as any)?.messages ?? [];
  const quickReplies = (directive as any)?.quick_replies ?? [];

  return (
    <div className={styles.shell}>
      <div className={styles.header}>Maintenance Portal</div>

      {conv.error && <div className={styles.errorBanner}>{conv.error}</div>}

      <div className={styles.messages}>
        {messages.map((msg: any, i: number) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
        ))}
      </div>

      <div className={styles.interactionArea}>
        {/* Unit selection */}
        {state === 'unit_selection_required' && (
          <UnitSelector unitIds={unitIds} onSelect={conv.selectUnit} disabled={isLoading} />
        )}

        {/* Split review */}
        {state === 'split_proposed' && (snapshot as any)?.issues && (
          <SplitReview
            issues={(snapshot as any).issues}
            onConfirm={conv.confirmSplit}
            onReject={conv.rejectSplit}
            onEdit={conv.editIssue}
            onMerge={conv.mergeIssues}
            onAdd={conv.addIssue}
            disabled={isLoading}
          />
        )}

        {/* Follow-up questions */}
        {state === 'needs_tenant_input' && (snapshot as any)?.pending_followup_questions && (
          <FollowupForm
            questions={(snapshot as any).pending_followup_questions}
            onSubmit={conv.answerFollowups}
            disabled={isLoading}
          />
        )}

        {/* Confirmation */}
        {state === 'tenant_confirmation_pending' && (snapshot as any)?.confirmation_payload && (
          <ConfirmationPanel
            payload={(snapshot as any).confirmation_payload}
            onConfirm={conv.confirmSubmission}
            disabled={isLoading}
          />
        )}

        {/* Processing states */}
        {state && PROCESSING_STATES.has(state) && <StatusIndicator state={state} />}

        {/* Terminal and error states */}
        {state && TERMINAL_STATES.has(state) && (
          <StatusIndicator
            state={state}
            workOrderIds={(snapshot as any)?.work_order_ids}
            onRetry={() => conv.resumeConversation(conv.conversationId!)}
            onResume={() => conv.resumeConversation(conv.conversationId!)}
            onStartOver={conv.startConversation}
          />
        )}

        {/* Quick replies */}
        {quickReplies.length > 0 && (
          <QuickReplies replies={quickReplies} onSelect={handleQuickReply} disabled={isLoading} />
        )}

        {/* Message input for text-entry states */}
        {state && INPUT_STATES.has(state) && (
          <MessageInput onSend={conv.submitInitialMessage} disabled={isLoading} />
        )}

        {/* Additional message input for states that accept it */}
        {(state === 'needs_tenant_input' || state === 'tenant_confirmation_pending') && (
          <MessageInput
            onSend={conv.submitAdditionalMessage}
            disabled={isLoading}
            placeholder="Add more details..."
          />
        )}
      </div>
    </div>
  );
}
