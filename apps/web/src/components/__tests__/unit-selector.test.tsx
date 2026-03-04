import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnitSelector } from '../unit-selector';

describe('UnitSelector', () => {
  const units = ['unit-101', 'unit-202', 'unit-303'];

  it('renders all unit options', () => {
    render(<UnitSelector unitIds={units} onSelect={vi.fn()} />);
    expect(screen.getByText('unit-101')).toBeInTheDocument();
    expect(screen.getByText('unit-202')).toBeInTheDocument();
    expect(screen.getByText('unit-303')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen unit id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<UnitSelector unitIds={units} onSelect={onSelect} />);

    await user.click(screen.getByText('unit-202'));
    expect(onSelect).toHaveBeenCalledWith('unit-202');
  });

  it('displays prompt text', () => {
    render(<UnitSelector unitIds={units} onSelect={vi.fn()} />);
    expect(screen.getByText(/which unit/i)).toBeInTheDocument();
  });

  it('disables buttons when disabled', () => {
    render(<UnitSelector unitIds={units} onSelect={vi.fn()} disabled />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });
});
