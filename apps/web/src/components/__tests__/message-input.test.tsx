import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from '../message-input';

describe('MessageInput', () => {
  it('renders textarea and send button', () => {
    render(<MessageInput onSend={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('calls onSend with trimmed message and clears input', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} />);

    const input = screen.getByRole('textbox');
    await user.type(input, '  Sink leaking  ');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('Sink leaking');
    expect(input).toHaveValue('');
  });

  it('does not send empty messages', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables input when disabled prop is true', () => {
    render(<MessageInput onSend={vi.fn()} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('shows character count approaching limit', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} maxChars={100} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'a'.repeat(90));
    expect(screen.getByText('90 / 100')).toBeInTheDocument();
  });
});
