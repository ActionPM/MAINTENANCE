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
import { DemoProgress } from './demo-progress';
import type { UIMessage, QuickReply } from '@wo-agent/schemas';
import styles from './chat-shell.module.css';

interface ChatShellProps {
  token: string;
  unitIds: readonly string[];
  demoScenario?: string;
  demoMessage?: string;
}

const SCENARIO_NAMES: Record<string, string> = {
  standard: 'Standard Request',
  'multi-issue': 'Multi-Issue Report',
  emergency: 'Emergency Detection',
};

const INPUT_STATES = new Set(['unit_selected']);

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

export function ChatShell({ token, unitIds, demoScenario, demoMessage }: ChatShellProps) {
  const conv = useConversation(token);
  const snapshot = conv.response?.conversation_snapshot;
  const directive = conv.response?.ui_directive;
  const state = snapshot?.state;
  const isLoading = conv.status === 'loading';
  const isDemo = !!demoScenario;

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
        case 'CONFIRM_EMERGENCY':
          return conv.confirmEmergency();
        case 'DECLINE_EMERGENCY':
          return conv.declineEmergency();
        case 'RESUME':
          return conv.resumeConversation(conv.conversationId!);
        default:
          return conv.submitAdditionalMessage(reply.value);
      }
    },
    [conv],
  );

  if (!conv.response) {
    return (
      <div className={styles.shell}>
        <div className={styles.header}>Maintenance Portal</div>
        {isDemo && (
          <div
            style={{
              background: '#eef2ff',
              padding: '0.5rem 1rem',
              fontSize: '0.8rem',
              color: '#3b5998',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Demo Mode — {SCENARIO_NAMES[demoScenario] ?? demoScenario}</span>
            <a href="/dev/demo" style={{ color: '#0066cc', textDecoration: 'none' }}>
              Back to Scenarios
            </a>
          </div>
        )}
        <div className={styles.startContainer}>
          <button className={styles.startBtn} onClick={conv.startConversation}>
            Start a request
          </button>
        </div>
      </div>
    );
  }

  const messages: readonly UIMessage[] = directive?.messages ?? [];
  let quickReplies: readonly QuickReply[] = directive?.quick_replies ?? [];

  if (
    snapshot?.risk_summary?.escalation_state === 'pending_confirmation' &&
    !quickReplies.some((r) => r.action_type === 'CONFIRM_EMERGENCY')
  ) {
    quickReplies = [
      {
        label: 'Yes, this is an emergency',
        value: 'confirm_emergency',
        action_type: 'CONFIRM_EMERGENCY' as const,
      },
      {
        label: 'No, not an emergency',
        value: 'decline_emergency',
        action_type: 'DECLINE_EMERGENCY' as const,
      },
      ...quickReplies,
    ];
  }

  return (
    <div className={styles.shell}>
      <div className={styles.header}>Maintenance Portal</div>

      {isDemo && (
        <div
          style={{
            background: '#eef2ff',
            padding: '0.5rem 1rem',
            fontSize: '0.8rem',
            color: '#3b5998',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Demo Mode — {SCENARIO_NAMES[demoScenario] ?? demoScenario}</span>
          <a href="/dev/demo" style={{ color: '#0066cc', textDecoration: 'none' }}>
            Back to Scenarios
          </a>
        </div>
      )}

      {isDemo && <DemoProgress state={state} />}

      {conv.error && <div className={styles.errorBanner}>{conv.error}</div>}

      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
        ))}
      </div>

      <div className={styles.interactionArea}>
        {/* Show UnitSelector for unit_selection_required AND intake_started (legacy/resumed sessions) */}
        {(state === 'unit_selection_required' || state === 'intake_started') && (
          <UnitSelector unitIds={unitIds} onSelect={conv.selectUnit} disabled={isLoading} />
        )}

        {state === 'split_proposed' && snapshot?.issues && (
          <SplitReview
            issues={snapshot.issues}
            onConfirm={conv.confirmSplit}
            onReject={conv.rejectSplit}
            onEdit={conv.editIssue}
            onMerge={conv.mergeIssues}
            onAdd={conv.addIssue}
            disabled={isLoading}
          />
        )}

        {state === 'needs_tenant_input' && snapshot?.pending_followup_questions && (
          <FollowupForm
            questions={snapshot.pending_followup_questions}
            onSubmit={conv.answerFollowups}
            disabled={isLoading}
          />
        )}

        {state === 'tenant_confirmation_pending' && snapshot?.confirmation_payload && (
          <ConfirmationPanel
            payload={snapshot.confirmation_payload}
            onConfirm={conv.confirmSubmission}
            disabled={isLoading}
          />
        )}

        {state && PROCESSING_STATES.has(state) && <StatusIndicator state={state} />}

        {state && TERMINAL_STATES.has(state) && (
          <StatusIndicator
            state={state}
            workOrderIds={snapshot?.work_order_ids}
            queuedMessages={snapshot?.queued_messages}
            onRetry={() => conv.resumeConversation(conv.conversationId!)}
            onResume={() => conv.resumeConversation(conv.conversationId!)}
            onStartOver={conv.startConversation}
            onStartQueued={
              snapshot?.queued_messages?.length && snapshot?.unit_id
                ? () =>
                    conv.startWithQueuedText(
                      snapshot.queued_messages!,
                      snapshot.unit_id!,
                    )
                : undefined
            }
            token={token}
            disabled={isLoading}
          />
        )}

        {quickReplies.length > 0 && (
          <QuickReplies replies={quickReplies} onSelect={handleQuickReply} disabled={isLoading} />
        )}

        {state && INPUT_STATES.has(state) && (
          <MessageInput
            onSend={conv.submitInitialMessage}
            disabled={isLoading}
            defaultValue={demoMessage}
          />
        )}

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
