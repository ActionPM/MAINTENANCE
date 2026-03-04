import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPage from '../page';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('@/components/chat-shell', () => ({
  ChatShell: ({ token }: { token: string }) => (
    <div data-testid="chat-shell" data-token={token} />
  ),
}));

import { useSearchParams } from 'next/navigation';

describe('ChatPage', () => {
  it('renders ChatShell when token is provided via searchParams', () => {
    vi.mocked(useSearchParams).mockReturnValue({
      get: (key: string) => {
        if (key === 'token') return 'test-tok';
        if (key === 'units') return 'u1,u2';
        return null;
      },
    } as any);

    render(<ChatPage />);
    expect(screen.getByTestId('chat-shell')).toBeInTheDocument();
    expect(screen.getByTestId('chat-shell')).toHaveAttribute('data-token', 'test-tok');
  });

  it('shows auth prompt when no token', () => {
    vi.mocked(useSearchParams).mockReturnValue({
      get: () => null,
    } as any);

    render(<ChatPage />);
    expect(screen.getByText(/token required/i)).toBeInTheDocument();
  });
});
