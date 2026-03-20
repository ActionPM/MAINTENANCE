import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationPanel } from '../confirmation-panel';

const payload = {
  issues: [
    {
      issue_id: 'i1',
      summary: 'Kitchen sink leaking',
      raw_excerpt: 'sink leaks',
      classification: { Category: 'maintenance', Sub_Location: 'kitchen' } as Record<
        string,
        string
      >,
      confidence_by_field: { Category: 0.95, Sub_Location: 0.88 } as Record<string, number>,
      missing_fields: [] as string[],
      needs_human_triage: false,
    },
    {
      issue_id: 'i2',
      summary: 'Door sticks',
      raw_excerpt: 'door sticks',
      classification: { Category: 'maintenance' } as Record<string, string>,
      confidence_by_field: { Category: 0.72 } as Record<string, number>,
      missing_fields: ['Sub_Location'],
      needs_human_triage: true,
    },
  ],
};

describe('ConfirmationPanel', () => {
  it('renders all issues with summaries', () => {
    render(<ConfirmationPanel payload={payload} onConfirm={vi.fn()} />);
    expect(screen.getByText('Kitchen sink leaking')).toBeInTheDocument();
    expect(screen.getByText('Door sticks')).toBeInTheDocument();
  });

  it('displays classification labels', () => {
    render(<ConfirmationPanel payload={payload} onConfirm={vi.fn()} />);
    expect(screen.getAllByText(/Maintenance/i).length).toBeGreaterThanOrEqual(1);
    // "Kitchen" appears both as issue summary ("Kitchen sink leaking") and as label
    expect(screen.getAllByText(/Kitchen/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows human triage badge when needed', () => {
    render(<ConfirmationPanel payload={payload} onConfirm={vi.fn()} />);
    expect(screen.getByText(/review needed/i)).toBeInTheDocument();
  });

  it('calls onConfirm when confirmed', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmationPanel payload={payload} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables confirm when disabled', () => {
    render(<ConfirmationPanel payload={payload} onConfirm={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });
});
