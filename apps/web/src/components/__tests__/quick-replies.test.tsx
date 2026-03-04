import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickReplies } from '../quick-replies';

const replies = [
  { label: 'Continue', value: 'continue' },
  { label: 'Edit issues', value: 'edit' },
  { label: 'Cancel', value: 'cancel' },
];

describe('QuickReplies', () => {
  it('renders all reply buttons', () => {
    render(<QuickReplies replies={replies} onSelect={vi.fn()} />);
    expect(screen.getByText('Continue')).toBeInTheDocument();
    expect(screen.getByText('Edit issues')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onSelect with value when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<QuickReplies replies={replies} onSelect={onSelect} />);

    await user.click(screen.getByText('Continue'));
    expect(onSelect).toHaveBeenCalledWith(replies[0]);
  });

  it('disables buttons when disabled', () => {
    render(<QuickReplies replies={replies} onSelect={vi.fn()} disabled />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('renders nothing when replies array is empty', () => {
    const { container } = render(<QuickReplies replies={[]} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
