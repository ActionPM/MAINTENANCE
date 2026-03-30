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
      display_fields: [
        { field: 'Category', field_label: 'Category', value: 'maintenance', value_label: 'Maintenance' },
        { field: 'Sub_Location', field_label: 'Sub-location', value: 'kitchen', value_label: 'Kitchen' },
      ],
    },
    {
      issue_id: 'i2',
      summary: 'Door sticks',
      raw_excerpt: 'door sticks',
      classification: { Category: 'maintenance' } as Record<string, string>,
      confidence_by_field: { Category: 0.72 } as Record<string, number>,
      missing_fields: ['Sub_Location'],
      needs_human_triage: true,
      display_fields: [
        { field: 'Category', field_label: 'Category', value: 'maintenance', value_label: 'Maintenance' },
      ],
    },
  ],
};

const pestControlPayload = {
  issues: [
    {
      issue_id: 'i-pest',
      summary: 'Cockroaches in kitchen',
      raw_excerpt: 'cockroaches everywhere',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'pest_control',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
        Priority: 'normal',
      } as Record<string, string>,
      confidence_by_field: {} as Record<string, number>,
      missing_fields: [] as string[],
      needs_human_triage: false,
      display_fields: [
        { field: 'Category', field_label: 'Category', value: 'maintenance', value_label: 'Maintenance' },
        { field: 'Location', field_label: 'Location', value: 'suite', value_label: 'Your unit' },
        { field: 'Sub_Location', field_label: 'Sub-location', value: 'kitchen', value_label: 'Kitchen' },
        { field: 'Maintenance_Category', field_label: 'Maintenance type', value: 'pest_control', value_label: 'Pest control' },
        { field: 'Priority', field_label: 'Priority', value: 'normal', value_label: 'Normal' },
      ],
    },
  ],
};

const legacyPayload = {
  issues: [
    {
      issue_id: 'i-legacy',
      summary: 'Legacy issue',
      raw_excerpt: 'legacy',
      classification: { Category: 'maintenance', Sub_Location: 'kitchen' } as Record<
        string,
        string
      >,
      confidence_by_field: { Category: 0.95 } as Record<string, number>,
      missing_fields: [] as string[],
      needs_human_triage: false,
      // No display_fields — fallback to chip rendering
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

  it('renders labeled field/value rows from display_fields', () => {
    render(<ConfirmationPanel payload={payload} onConfirm={vi.fn()} />);
    // Field labels should appear
    expect(screen.getAllByText('Category').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sub-location')).toBeInTheDocument();
    // Value labels should appear
    expect(screen.getAllByText('Maintenance').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render not_applicable values (pest-control scenario)', () => {
    render(<ConfirmationPanel payload={pestControlPayload} onConfirm={vi.fn()} />);
    // not_applicable management fields should not appear
    expect(screen.queryByText('Management type')).not.toBeInTheDocument();
    expect(screen.queryByText('Management object')).not.toBeInTheDocument();
    // Maintenance fields should appear
    expect(screen.getByText('Maintenance type')).toBeInTheDocument();
    expect(screen.getByText('Pest control')).toBeInTheDocument();
  });

  it('falls back to chip rendering when display_fields is absent', () => {
    render(<ConfirmationPanel payload={legacyPayload} onConfirm={vi.fn()} />);
    // Should still render classification labels as chips
    expect(screen.getByText('Legacy issue')).toBeInTheDocument();
    expect(screen.getAllByText(/Maintenance/i).length).toBeGreaterThanOrEqual(1);
  });
});
