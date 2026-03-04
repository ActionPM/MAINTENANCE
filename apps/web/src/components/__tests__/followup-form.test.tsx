import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FollowupForm } from '../followup-form';
import type { FollowUpQuestion } from '@wo-agent/schemas';

const questions: FollowUpQuestion[] = [
  {
    question_id: 'q1',
    field_target: 'Sub_Location',
    prompt: 'Where is the issue?',
    options: ['kitchen', 'bathroom', 'bedroom'],
    answer_type: 'enum',
  },
  {
    question_id: 'q2',
    field_target: 'Maintenance_Problem',
    prompt: 'Is it actively leaking?',
    options: ['Yes', 'No'],
    answer_type: 'yes_no',
  },
  {
    question_id: 'q3',
    field_target: 'Maintenance_Object',
    prompt: 'Can you describe the fixture?',
    options: [],
    answer_type: 'text',
  },
];

describe('FollowupForm', () => {
  it('renders all questions', () => {
    render(<FollowupForm questions={questions} onSubmit={vi.fn()} />);
    expect(screen.getByText('Where is the issue?')).toBeInTheDocument();
    expect(screen.getByText('Is it actively leaking?')).toBeInTheDocument();
    expect(screen.getByText('Can you describe the fixture?')).toBeInTheDocument();
  });

  it('renders radio buttons for enum type', () => {
    render(<FollowupForm questions={[questions[0]]} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('kitchen')).toBeInTheDocument();
    expect(screen.getByLabelText('bathroom')).toBeInTheDocument();
    expect(screen.getByLabelText('bedroom')).toBeInTheDocument();
  });

  it('renders radio buttons for yes_no type', () => {
    render(<FollowupForm questions={[questions[1]]} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Yes')).toBeInTheDocument();
    expect(screen.getByLabelText('No')).toBeInTheDocument();
  });

  it('renders text input for text type', () => {
    render(<FollowupForm questions={[questions[2]]} onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('submits all answers', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<FollowupForm questions={questions} onSubmit={onSubmit} />);

    await user.click(screen.getByLabelText('kitchen'));
    await user.click(screen.getByLabelText('Yes'));
    await user.type(screen.getByRole('textbox'), 'The faucet');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith([
      { question_id: 'q1', answer: 'kitchen' },
      { question_id: 'q2', answer: 'Yes' },
      { question_id: 'q3', answer: 'The faucet' },
    ]);
  });

  it('disables submit until all questions answered', () => {
    render(<FollowupForm questions={questions} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });
});
