import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusIndicator } from '../status-indicator';

describe('StatusIndicator', () => {
  it('renders processing message for split_in_progress', () => {
    render(<StatusIndicator state="split_in_progress" />);
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders processing message for classification_in_progress', () => {
    render(<StatusIndicator state="classification_in_progress" />);
    expect(screen.getByText(/classifying/i)).toBeInTheDocument();
  });

  it('renders success for submitted', () => {
    render(<StatusIndicator state="submitted" workOrderIds={['wo-1', 'wo-2']} />);
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/wo-1/)).toBeInTheDocument();
  });

  it('renders retryable error with retry button', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<StatusIndicator state="llm_error_retryable" onRetry={onRetry} />);

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders terminal error with start over option', () => {
    render(<StatusIndicator state="llm_error_terminal" onStartOver={vi.fn()} />);
    expect(screen.getByText(/unable to process/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
  });

  it('renders expired state', () => {
    render(<StatusIndicator state="intake_expired" onStartOver={vi.fn()} />);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it('renders abandoned with resume option', async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    render(<StatusIndicator state="intake_abandoned" onResume={onResume} />);

    await user.click(screen.getByRole('button', { name: /resume/i }));
    expect(onResume).toHaveBeenCalled();
  });
});
