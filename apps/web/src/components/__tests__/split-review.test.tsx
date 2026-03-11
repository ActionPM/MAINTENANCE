import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitReview } from '../split-review';

const issues = [
  { issue_id: 'i1', summary: 'Kitchen sink leaking', raw_excerpt: 'sink leaks' },
  { issue_id: 'i2', summary: 'Bedroom door sticks', raw_excerpt: 'door sticks' },
];

describe('SplitReview', () => {
  it('renders all issues', () => {
    render(
      <SplitReview
        issues={issues}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    expect(screen.getByText('Kitchen sink leaking')).toBeInTheDocument();
    expect(screen.getByText('Bedroom door sticks')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitReview
        issues={issues}
        onConfirm={onConfirm}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onReject when reject button clicked', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitReview
        issues={issues}
        onConfirm={vi.fn()}
        onReject={onReject}
        onEdit={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /reject/i }));
    expect(onReject).toHaveBeenCalled();
  });

  it('allows editing an issue summary inline', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitReview
        issues={issues}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onEdit={onEdit}
        onMerge={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]);

    const input = screen.getByDisplayValue('Kitchen sink leaking');
    await user.clear(input);
    await user.type(input, 'Kitchen faucet dripping');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onEdit).toHaveBeenCalledWith('i1', 'Kitchen faucet dripping');
  });

  it('allows adding a new issue', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitReview
        issues={issues}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onMerge={vi.fn()}
        onAdd={onAdd}
      />,
    );

    await user.click(screen.getByRole('button', { name: /add issue/i }));
    const input = screen.getByPlaceholderText(/describe/i);
    await user.type(input, "Window won't close");
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onAdd).toHaveBeenCalledWith("Window won't close");
  });

  it('disables all actions when disabled', () => {
    render(
      <SplitReview
        issues={issues}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onEdit={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn()}
        disabled
      />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });
});
