import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from '../chat-message';

describe('ChatMessage', () => {
  it('renders message content', () => {
    render(
      <ChatMessage
        role="agent"
        content="Hello! How can I help?"
        timestamp="2026-03-04T10:00:00Z"
      />,
    );
    expect(screen.getByText('Hello! How can I help?')).toBeInTheDocument();
  });

  it('applies agent styling', () => {
    const { container } = render(
      <ChatMessage role="agent" content="Hi" timestamp="2026-03-04T10:00:00Z" />,
    );
    expect(container.firstChild).toHaveAttribute('data-role', 'agent');
  });

  it('applies tenant styling', () => {
    const { container } = render(
      <ChatMessage role="tenant" content="My sink leaks" timestamp="2026-03-04T10:00:00Z" />,
    );
    expect(container.firstChild).toHaveAttribute('data-role', 'tenant');
  });

  it('applies system styling', () => {
    const { container } = render(
      <ChatMessage role="system" content="Processing..." timestamp="2026-03-04T10:00:00Z" />,
    );
    expect(container.firstChild).toHaveAttribute('data-role', 'system');
  });

  it('displays formatted time', () => {
    render(
      <ChatMessage role="agent" content="Hi" timestamp="2026-03-04T10:30:00Z" />,
    );
    expect(screen.getByText(/10:30/)).toBeInTheDocument();
  });
});
