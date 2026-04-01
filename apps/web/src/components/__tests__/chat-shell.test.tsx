import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatShell } from '../chat-shell';
import * as api from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    createConversation: vi.fn(),
    selectUnit: vi.fn(),
    submitInitialMessage: vi.fn(),
    submitAdditionalMessage: vi.fn(),
    confirmSplit: vi.fn(),
    rejectSplit: vi.fn(),
    mergeIssues: vi.fn(),
    editIssue: vi.fn(),
    addIssue: vi.fn(),
    answerFollowups: vi.fn(),
    confirmSubmission: vi.fn(),
    resumeConversation: vi.fn(),
    initPhotoUpload: vi.fn(),
    completePhotoUpload: vi.fn(),
    fetchDrafts: vi.fn(),
  };
});

const makeResponse = (state: string, extras: Record<string, unknown> = {}) => ({
  conversation_snapshot: {
    conversation_id: 'conv-1',
    state,
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'test',
      prompt_version: '1',
    },
    ...extras,
  },
  ui_directive: {
    messages: [{ role: 'agent' as const, content: 'Hello!', timestamp: '2026-03-04T10:00:00Z' }],
    quick_replies: [],
  },
  artifacts: [],
  pending_side_effects: [],
  errors: [],
});

describe('ChatShell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders start button before conversation begins', () => {
    render(<ChatShell token="tok" unitIds={['unit-1']} />);
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('starts conversation and shows message input after unit_selected', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(makeResponse('unit_selected') as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows unit selector when unit_selection_required', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(
      makeResponse('unit_selection_required') as any,
    );
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1', 'unit-2']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/which unit/i)).toBeInTheDocument();
  });

  it('shows split review when split_proposed', async () => {
    const resp = makeResponse('split_proposed', {
      issues: [{ issue_id: 'i1', summary: 'Sink leaking', raw_excerpt: 'sink' }],
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText('Sink leaking')).toBeInTheDocument();
  });

  it('shows followup form when needs_tenant_input', async () => {
    const resp = makeResponse('needs_tenant_input', {
      pending_followup_questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Where is the issue?',
          options: ['kitchen', 'bathroom'],
          answer_type: 'enum',
        },
      ],
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText('Where is the issue?')).toBeInTheDocument();
  });

  it('shows confirmation panel when tenant_confirmation_pending', async () => {
    const resp = makeResponse('tenant_confirmation_pending', {
      confirmation_payload: {
        issues: [
          {
            issue_id: 'i1',
            summary: 'Sink leaking',
            raw_excerpt: 'sink',
            classification: { Category: 'maintenance' },
            confidence_by_field: { Category: 0.95 },
            missing_fields: [],
            needs_human_triage: false,
            recoverable_via_followup: false,
          },
        ],
      },
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/review before submitting/i)).toBeInTheDocument();
  });

  it('shows status indicator for processing states', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(
      makeResponse('split_in_progress') as any,
    );
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
  });

  it('displays chat messages from ui_directive', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(makeResponse('unit_selected') as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('passes queued messages to StatusIndicator in submitted state', async () => {
    const resp = makeResponse('submitted', {
      unit_id: 'unit-1',
      work_order_ids: ['wo-1'],
      queued_messages: ['kitchen sink leaking too'],
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/you mentioned another issue/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with new issue/i })).toBeInTheDocument();
  });

  it('does not show queued section when submitted without queued messages', async () => {
    const resp = makeResponse('submitted', {
      work_order_ids: ['wo-1'],
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.queryByText(/you mentioned another issue/i)).not.toBeInTheDocument();
  });

  it('dispatches quick reply action based on action_type', async () => {
    const resp = {
      ...makeResponse('split_proposed', {
        issues: [{ issue_id: 'i1', summary: 'Sink leaking', raw_excerpt: 'sink' }],
      }),
      ui_directive: {
        messages: [],
        quick_replies: [{ label: 'Confirm split', value: 'confirm', action_type: 'CONFIRM_SPLIT' }],
      },
    };
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    vi.mocked(api.confirmSplit).mockResolvedValueOnce(makeResponse('split_finalized') as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.click(screen.getByText('Confirm split'));
    expect(api.confirmSplit).toHaveBeenCalledWith('tok', 'conv-1');
  });
});
