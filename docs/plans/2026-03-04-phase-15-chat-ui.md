# Chat UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build a tenant-facing in-app chatbot UI that drives the conversation state machine through all intake states — from issue description through split confirmation, follow-up questions, tenant confirmation, and submission — rendering server-driven `ui_directive` payloads at each step.

**Architecture:** React client components inside the existing Next.js 15 app (`apps/web`). The UI is a **state-machine consumer**: the server returns `OrchestratorActionResponse` with a `conversation_snapshot.state` and `ui_directive`, and the UI renders the appropriate panel/form for each state. All business logic stays server-side; the UI is a thin rendering + action-dispatch layer. A single `useConversation` hook manages API calls + optimistic state. No external state library — React context + `useReducer` is sufficient for this single-page chat flow.

**Tech Stack:** React 19 + Next.js 15 (App Router, client components) + CSS Modules (zero additional deps) + TypeScript strict mode. All types imported from `@wo-agent/schemas`.

---

## Conventions

- **No new dependencies.** React 19, Next.js 15, and CSS Modules are already available. No Tailwind, no component libraries, no state management libraries.
- **Client components only** for interactive chat. Server components for layout shell.
- **CSS Modules** for all styling (`*.module.css`). One module per component.
- **File naming:** `kebab-case.tsx` for components, `use-*.ts` for hooks, `*.module.css` for styles.
- **Import types from `@wo-agent/schemas`** — never duplicate type definitions.
- **Tests:** Vitest + React Testing Library (already configured in `apps/web`). Test files co-located as `__tests__/component-name.test.tsx`.
- **Path alias:** `@/*` maps to `./src/*`.

---

## Task 0: Install React Testing Library

**Files:**

- Modify: `apps/web/package.json`

**Step 1: Add dev dependencies**

```bash
cd apps/web && pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

**Step 2: Update vitest config for jsdom**

Modify `apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 3: Create test setup file**

Create `apps/web/src/test-setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

**Step 4: Verify setup works**

Run: `cd apps/web && pnpm test`
Expected: All existing tests still pass.

**Step 5: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/test-setup.ts pnpm-lock.yaml
git commit -m "chore: add React Testing Library + jsdom for UI tests"
```

---

## Task 1: API Client Module

**Files:**

- Create: `apps/web/src/lib/api-client.ts`
- Test: `apps/web/src/lib/__tests__/api-client.test.ts`

This module wraps all `fetch` calls to the conversation API. Every function returns `OrchestratorActionResponse`. The UI never calls `fetch` directly.

**Step 1: Write the failing test**

Create `apps/web/src/lib/__tests__/api-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createConversation,
  selectUnit,
  submitInitialMessage,
  submitAdditionalMessage,
  confirmSplit,
  rejectSplit,
  mergeIssues,
  editIssue,
  addIssue,
  answerFollowups,
  confirmSubmission,
  resumeConversation,
  initPhotoUpload,
  completePhotoUpload,
  fetchDrafts,
} from '../api-client';

const mockResponse = {
  conversation_snapshot: {
    conversation_id: 'conv-1',
    state: 'intake_started',
    pinned_versions: {
      taxonomy_version: '1.0',
      schema_version: '1.0',
      model_id: 'test',
      prompt_version: '1.0',
    },
  },
  ui_directive: {},
  artifacts: [],
  pending_side_effects: [],
  errors: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('api-client', () => {
  it('createConversation posts to /api/conversations', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 201 }));

    const result = await createConversation('token-123');
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-123',
      },
      body: '{}',
    });
    expect(result.conversation_snapshot.state).toBe('intake_started');
  });

  it('selectUnit posts unit_id', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await selectUnit('token-123', 'conv-1', 'unit-a');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/select-unit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ unit_id: 'unit-a' }),
      }),
    );
  });

  it('submitInitialMessage posts message', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await submitInitialMessage('token-123', 'conv-1', 'Sink is leaking');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/message/initial',
      expect.objectContaining({
        body: JSON.stringify({ message: 'Sink is leaking' }),
      }),
    );
  });

  it('throws ApiError on non-ok response', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ errors: [{ code: 'RATE_LIMITED', message: 'Too many requests' }] }),
        { status: 429 },
      ),
    );

    await expect(createConversation('token-123')).rejects.toThrow('Too many requests');
  });

  it('confirmSplit posts empty body', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await confirmSplit('token-123', 'conv-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/split/confirm',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('answerFollowups posts answers array', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 200 }));

    const answers = [{ question_id: 'q1', answer: 'kitchen' }];
    await answerFollowups('token-123', 'conv-1', answers);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/followups/answer',
      expect.objectContaining({
        body: JSON.stringify({ answers }),
      }),
    );
  });

  it('fetchDrafts returns drafts array', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ drafts: [] }), { status: 200 }));

    const result = await fetchDrafts('token-123');
    expect(result).toEqual({ drafts: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations-drafts',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/lib/__tests__/api-client.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/lib/api-client.ts`:

```typescript
import type { OrchestratorActionResponse } from '@wo-agent/schemas';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface DraftsResponse {
  drafts: Array<{
    conversation_id: string;
    state: string;
    last_activity_at: string;
  }>;
}

function headers(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function request<T = OrchestratorActionResponse>(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: headers(token),
  });

  const body = await res.json();

  if (!res.ok) {
    const err = body.errors?.[0] ?? { code: 'UNKNOWN', message: 'Request failed' };
    throw new ApiError(res.status, err.code, err.message);
  }

  return body as T;
}

// --- Conversation lifecycle ---

export function createConversation(token: string): Promise<OrchestratorActionResponse> {
  return request('/api/conversations', token, {
    method: 'POST',
    body: '{}',
  });
}

export function selectUnit(
  token: string,
  conversationId: string,
  unitId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/select-unit`, token, {
    method: 'POST',
    body: JSON.stringify({ unit_id: unitId }),
  });
}

export function submitInitialMessage(
  token: string,
  conversationId: string,
  message: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/message/initial`, token, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function submitAdditionalMessage(
  token: string,
  conversationId: string,
  message: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/message/additional`, token, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

// --- Split actions ---

export function confirmSplit(
  token: string,
  conversationId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/split/confirm`, token, {
    method: 'POST',
    body: '{}',
  });
}

export function rejectSplit(
  token: string,
  conversationId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/split/reject`, token, {
    method: 'POST',
    body: '{}',
  });
}

export function mergeIssues(
  token: string,
  conversationId: string,
  issueIds: readonly string[],
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/split/merge`, token, {
    method: 'POST',
    body: JSON.stringify({ issue_ids: issueIds }),
  });
}

export function editIssue(
  token: string,
  conversationId: string,
  issueId: string,
  summary: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/split/edit`, token, {
    method: 'POST',
    body: JSON.stringify({ issue_id: issueId, summary }),
  });
}

export function addIssue(
  token: string,
  conversationId: string,
  summary: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/split/add`, token, {
    method: 'POST',
    body: JSON.stringify({ summary }),
  });
}

// --- Follow-ups & confirmation ---

export function answerFollowups(
  token: string,
  conversationId: string,
  answers: Array<{ question_id: string; answer: unknown }>,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/followups/answer`, token, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export function confirmSubmission(
  token: string,
  conversationId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/confirm-submission`, token, {
    method: 'POST',
    body: '{}',
  });
}

// --- Resume & drafts ---

export function resumeConversation(
  token: string,
  conversationId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/resume`, token, {
    method: 'POST',
    body: '{}',
  });
}

export function fetchDrafts(token: string): Promise<DraftsResponse> {
  return request<DraftsResponse>('/api/conversations-drafts', token, {
    method: 'GET',
  });
}

// --- Photos ---

export function initPhotoUpload(
  token: string,
  conversationId: string,
  file: { filename: string; content_type: string; size_bytes: number },
): Promise<OrchestratorActionResponse> {
  return request('/api/photos/init', token, {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, ...file }),
  });
}

export function completePhotoUpload(
  token: string,
  conversationId: string,
  upload: { photo_id: string; storage_key: string; sha256: string },
): Promise<OrchestratorActionResponse> {
  return request('/api/photos/complete', token, {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, ...upload }),
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/lib/__tests__/api-client.test.ts`
Expected: PASS — all 7 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/__tests__/api-client.test.ts
git commit -m "feat(ui): add API client module wrapping all conversation endpoints"
```

---

## Task 2: useConversation Hook

**Files:**

- Create: `apps/web/src/hooks/use-conversation.ts`
- Test: `apps/web/src/hooks/__tests__/use-conversation.test.ts`

Central hook managing conversation state. Takes an auth token, returns the current `OrchestratorActionResponse`, loading/error state, and action dispatch functions. All state transitions go through this hook.

**Step 1: Write the failing test**

Create `apps/web/src/hooks/__tests__/use-conversation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversation } from '../use-conversation';
import * as api from '@/lib/api-client';

vi.mock('@/lib/api-client');

const makeResponse = (state: string, extras = {}) => ({
  conversation_snapshot: {
    conversation_id: 'conv-1',
    state,
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'test',
      prompt_version: '1',
    },
    ...extras,
  },
  ui_directive: { messages: [] },
  artifacts: [],
  pending_side_effects: [],
  errors: [],
});

describe('useConversation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('starts with null response and idle status', () => {
    const { result } = renderHook(() => useConversation('token'));
    expect(result.current.response).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('startConversation calls createConversation and sets response', async () => {
    const resp = makeResponse('intake_started');
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);

    const { result } = renderHook(() => useConversation('token'));

    await act(async () => {
      await result.current.startConversation();
    });

    expect(api.createConversation).toHaveBeenCalledWith('token');
    expect(result.current.response).toEqual(resp);
    expect(result.current.status).toBe('ready');
  });

  it('sets error status on API failure', async () => {
    vi.mocked(api.createConversation).mockRejectedValueOnce(
      new api.ApiError(429, 'RATE_LIMITED', 'Too many requests'),
    );

    const { result } = renderHook(() => useConversation('token'));

    await act(async () => {
      await result.current.startConversation();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Too many requests');
  });

  it('sets loading status during API call', async () => {
    let resolve: (v: any) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    vi.mocked(api.createConversation).mockReturnValueOnce(pending as any);

    const { result } = renderHook(() => useConversation('token'));

    act(() => {
      result.current.startConversation();
    });

    expect(result.current.status).toBe('loading');

    await act(async () => {
      resolve!(makeResponse('intake_started'));
    });

    expect(result.current.status).toBe('ready');
  });

  it('selectUnit dispatches and updates response', async () => {
    const r1 = makeResponse('intake_started');
    const r2 = makeResponse('unit_selected');
    vi.mocked(api.createConversation).mockResolvedValueOnce(r1 as any);
    vi.mocked(api.selectUnit).mockResolvedValueOnce(r2 as any);

    const { result } = renderHook(() => useConversation('token'));

    await act(async () => {
      await result.current.startConversation();
    });
    await act(async () => {
      await result.current.selectUnit('unit-a');
    });

    expect(api.selectUnit).toHaveBeenCalledWith('token', 'conv-1', 'unit-a');
    expect(result.current.response?.conversation_snapshot.state).toBe('unit_selected');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/hooks/__tests__/use-conversation.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/hooks/use-conversation.ts`:

```typescript
'use client';

import { useCallback, useState } from 'react';
import type { OrchestratorActionResponse } from '@wo-agent/schemas';
import * as api from '@/lib/api-client';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function useConversation(token: string) {
  const [response, setResponse] = useState<OrchestratorActionResponse | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const conversationId = response?.conversation_snapshot.conversation_id ?? null;

  async function dispatch<T extends unknown[]>(
    fn: (...args: T) => Promise<OrchestratorActionResponse>,
    ...args: T
  ): Promise<void> {
    setStatus('loading');
    setError(null);
    try {
      const result = await fn(...args);
      setResponse(result);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  const startConversation = useCallback(() => dispatch(api.createConversation, token), [token]);

  const selectUnit = useCallback(
    (unitId: string) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.selectUnit, token, conversationId, unitId);
    },
    [token, conversationId],
  );

  const submitInitialMessage = useCallback(
    (message: string) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.submitInitialMessage, token, conversationId, message);
    },
    [token, conversationId],
  );

  const submitAdditionalMessage = useCallback(
    (message: string) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.submitAdditionalMessage, token, conversationId, message);
    },
    [token, conversationId],
  );

  const confirmSplit = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return dispatch(api.confirmSplit, token, conversationId);
  }, [token, conversationId]);

  const rejectSplit = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return dispatch(api.rejectSplit, token, conversationId);
  }, [token, conversationId]);

  const mergeIssues = useCallback(
    (issueIds: readonly string[]) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.mergeIssues, token, conversationId, issueIds);
    },
    [token, conversationId],
  );

  const editIssue = useCallback(
    (issueId: string, summary: string) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.editIssue, token, conversationId, issueId, summary);
    },
    [token, conversationId],
  );

  const addIssue = useCallback(
    (summary: string) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.addIssue, token, conversationId, summary);
    },
    [token, conversationId],
  );

  const answerFollowups = useCallback(
    (answers: Array<{ question_id: string; answer: unknown }>) => {
      if (!conversationId) return Promise.resolve();
      return dispatch(api.answerFollowups, token, conversationId, answers);
    },
    [token, conversationId],
  );

  const confirmSubmission = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return dispatch(api.confirmSubmission, token, conversationId);
  }, [token, conversationId]);

  const resumeConversation = useCallback(
    (id: string) => dispatch(api.resumeConversation, token, id),
    [token],
  );

  return {
    response,
    status,
    error,
    conversationId,
    startConversation,
    selectUnit,
    submitInitialMessage,
    submitAdditionalMessage,
    confirmSplit,
    rejectSplit,
    mergeIssues,
    editIssue,
    addIssue,
    answerFollowups,
    confirmSubmission,
    resumeConversation,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/hooks/__tests__/use-conversation.test.ts`
Expected: PASS — all 5 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/hooks/use-conversation.ts apps/web/src/hooks/__tests__/use-conversation.test.ts
git commit -m "feat(ui): add useConversation hook managing conversation state and API dispatch"
```

---

## Task 3: ChatMessage Component

**Files:**

- Create: `apps/web/src/components/chat-message.tsx`
- Create: `apps/web/src/components/chat-message.module.css`
- Test: `apps/web/src/components/__tests__/chat-message.test.tsx`

Renders a single chat message bubble. Supports `agent`, `tenant`, and `system` roles with different alignment and styling.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/chat-message.test.tsx`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/chat-message.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/chat-message.module.css`:

```css
.message {
  display: flex;
  flex-direction: column;
  max-width: 75%;
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  margin-bottom: 0.5rem;
  word-wrap: break-word;
}

.message[data-role='agent'] {
  align-self: flex-start;
  background: #f0f0f0;
  color: #1a1a1a;
  border-bottom-left-radius: 0.25rem;
}

.message[data-role='tenant'] {
  align-self: flex-end;
  background: #0066cc;
  color: #fff;
  border-bottom-right-radius: 0.25rem;
}

.message[data-role='system'] {
  align-self: center;
  background: #fff8e1;
  color: #6d4c00;
  font-size: 0.875rem;
  max-width: 90%;
}

.content {
  white-space: pre-wrap;
}

.time {
  font-size: 0.7rem;
  opacity: 0.6;
  margin-top: 0.25rem;
}

.message[data-role='tenant'] .time {
  text-align: right;
}
```

Create `apps/web/src/components/chat-message.tsx`:

```typescript
'use client';

import styles from './chat-message.module.css';

interface ChatMessageProps {
  role: 'system' | 'agent' | 'tenant';
  content: string;
  timestamp: string;
}

export function ChatMessage({ role, content, timestamp }: ChatMessageProps) {
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={styles.message} data-role={role}>
      <span className={styles.content}>{content}</span>
      <span className={styles.time}>{time}</span>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/chat-message.test.tsx`
Expected: PASS — all 5 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat-message.tsx apps/web/src/components/chat-message.module.css apps/web/src/components/__tests__/chat-message.test.tsx
git commit -m "feat(ui): add ChatMessage component with role-based styling"
```

---

## Task 4: MessageInput Component

**Files:**

- Create: `apps/web/src/components/message-input.tsx`
- Create: `apps/web/src/components/message-input.module.css`
- Test: `apps/web/src/components/__tests__/message-input.test.tsx`

Text input with send button. Enforces `max_message_chars` (8000). Disables while loading.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/message-input.test.tsx`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/message-input.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/message-input.module.css`:

```css
.container {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid #e0e0e0;
  background: #fff;
}

.textarea {
  flex: 1;
  padding: 0.625rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 1.25rem;
  resize: none;
  font-family: inherit;
  font-size: 0.9375rem;
  min-height: 2.5rem;
  max-height: 8rem;
  outline: none;
}

.textarea:focus {
  border-color: #0066cc;
}

.textarea:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.sendButton {
  padding: 0.5rem 1rem;
  background: #0066cc;
  color: #fff;
  border: none;
  border-radius: 1.25rem;
  cursor: pointer;
  font-size: 0.9375rem;
  font-weight: 500;
  align-self: flex-end;
}

.sendButton:hover:not(:disabled) {
  background: #0052a3;
}

.sendButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.charCount {
  font-size: 0.75rem;
  color: #888;
  text-align: right;
  padding: 0 0.75rem;
}

.charCount[data-over='true'] {
  color: #cc0000;
}
```

Create `apps/web/src/components/message-input.tsx`:

```typescript
'use client';

import { useState } from 'react';
import styles from './message-input.module.css';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxChars?: number;
}

export function MessageInput({
  onSend,
  disabled = false,
  placeholder = 'Describe your issue...',
  maxChars = 8000,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const showCount = value.length > maxChars * 0.8;
  const overLimit = value.length > maxChars;

  function handleSend() {
    if (!trimmed || disabled || overLimit) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div>
      <div className={styles.container}>
        <textarea
          className={styles.textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={maxChars}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={disabled || !trimmed || overLimit}
          aria-label="Send"
        >
          Send
        </button>
      </div>
      {showCount && (
        <div className={styles.charCount} data-over={overLimit}>
          {value.length} / {maxChars}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/message-input.test.tsx`
Expected: PASS — all 5 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/message-input.tsx apps/web/src/components/message-input.module.css apps/web/src/components/__tests__/message-input.test.tsx
git commit -m "feat(ui): add MessageInput component with char limit and send"
```

---

## Task 5: UnitSelector Component

**Files:**

- Create: `apps/web/src/components/unit-selector.tsx`
- Create: `apps/web/src/components/unit-selector.module.css`
- Test: `apps/web/src/components/__tests__/unit-selector.test.tsx`

Renders when tenant has multiple units. Displays a list of unit IDs as selectable buttons.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/unit-selector.test.tsx`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/unit-selector.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/unit-selector.module.css`:

```css
.container {
  padding: 1rem;
  text-align: center;
}

.prompt {
  margin-bottom: 1rem;
  font-size: 1rem;
  color: #333;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 20rem;
  margin: 0 auto;
}

.unitButton {
  padding: 0.75rem 1rem;
  border: 1px solid #ccc;
  border-radius: 0.5rem;
  background: #fff;
  cursor: pointer;
  font-size: 0.9375rem;
  transition: background 0.15s;
}

.unitButton:hover:not(:disabled) {
  background: #e8f0fe;
  border-color: #0066cc;
}

.unitButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

Create `apps/web/src/components/unit-selector.tsx`:

```typescript
'use client';

import styles from './unit-selector.module.css';

interface UnitSelectorProps {
  unitIds: readonly string[];
  onSelect: (unitId: string) => void;
  disabled?: boolean;
}

export function UnitSelector({ unitIds, onSelect, disabled = false }: UnitSelectorProps) {
  return (
    <div className={styles.container}>
      <p className={styles.prompt}>Which unit is this issue for?</p>
      <div className={styles.options}>
        {unitIds.map((id) => (
          <button
            key={id}
            className={styles.unitButton}
            onClick={() => onSelect(id)}
            disabled={disabled}
          >
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/unit-selector.test.tsx`
Expected: PASS — all 4 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/unit-selector.tsx apps/web/src/components/unit-selector.module.css apps/web/src/components/__tests__/unit-selector.test.tsx
git commit -m "feat(ui): add UnitSelector component for multi-unit tenants"
```

---

## Task 6: SplitReview Component

**Files:**

- Create: `apps/web/src/components/split-review.tsx`
- Create: `apps/web/src/components/split-review.module.css`
- Test: `apps/web/src/components/__tests__/split-review.test.tsx`

Displays the list of proposed issues from the splitter. Supports confirm, reject, edit, merge, and add actions.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/split-review.test.tsx`:

```typescript
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
    await user.type(input, 'Window won\'t close');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onAdd).toHaveBeenCalledWith('Window won\'t close');
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/split-review.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/split-review.module.css`:

```css
.container {
  padding: 1rem;
}

.heading {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.issueList {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
}

.issueItem {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
  background: #fafafa;
}

.issueSummary {
  flex: 1;
}

.editInput {
  flex: 1;
  padding: 0.375rem 0.5rem;
  border: 1px solid #0066cc;
  border-radius: 0.25rem;
  font-size: 0.9375rem;
}

.addInput {
  width: 100%;
  padding: 0.375rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  font-size: 0.9375rem;
  margin-bottom: 0.5rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.btnPrimary {
  padding: 0.5rem 1.25rem;
  background: #0066cc;
  color: #fff;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.btnSecondary {
  padding: 0.5rem 1.25rem;
  background: #fff;
  color: #333;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.btnSmall {
  padding: 0.25rem 0.5rem;
  font-size: 0.8125rem;
  background: none;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  cursor: pointer;
}

.btnPrimary:disabled,
.btnSecondary:disabled,
.btnSmall:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkbox {
  width: 1rem;
  height: 1rem;
}
```

Create `apps/web/src/components/split-review.tsx`:

```typescript
'use client';

import { useState } from 'react';
import styles from './split-review.module.css';

interface Issue {
  issue_id: string;
  summary: string;
  raw_excerpt: string;
}

interface SplitReviewProps {
  issues: readonly Issue[];
  onConfirm: () => void;
  onReject: () => void;
  onEdit: (issueId: string, summary: string) => void;
  onMerge: (issueIds: readonly string[]) => void;
  onAdd: (summary: string) => void;
  disabled?: boolean;
}

export function SplitReview({
  issues,
  onConfirm,
  onReject,
  onEdit,
  onMerge,
  onAdd,
  disabled = false,
}: SplitReviewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function startEdit(issue: Issue) {
    setEditingId(issue.issue_id);
    setEditValue(issue.summary);
  }

  function saveEdit() {
    if (editingId && editValue.trim()) {
      onEdit(editingId, editValue.trim());
      setEditingId(null);
      setEditValue('');
    }
  }

  function startAdd() {
    setAdding(true);
    setAddValue('');
  }

  function saveAdd() {
    if (addValue.trim()) {
      onAdd(addValue.trim());
      setAdding(false);
      setAddValue('');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMerge() {
    if (selected.size >= 2) {
      onMerge(Array.from(selected));
      setSelected(new Set());
    }
  }

  return (
    <div className={styles.container}>
      <p className={styles.heading}>
        We identified {issues.length} issue{issues.length !== 1 ? 's' : ''} in your message:
      </p>

      <ul className={styles.issueList}>
        {issues.map((issue) => (
          <li key={issue.issue_id} className={styles.issueItem}>
            {issues.length > 1 && (
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.has(issue.issue_id)}
                onChange={() => toggleSelect(issue.issue_id)}
                disabled={disabled}
              />
            )}

            {editingId === issue.issue_id ? (
              <>
                <input
                  className={styles.editInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  maxLength={500}
                />
                <button className={styles.btnSmall} onClick={saveEdit} disabled={disabled}>
                  Save
                </button>
                <button
                  className={styles.btnSmall}
                  onClick={() => setEditingId(null)}
                  disabled={disabled}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className={styles.issueSummary}>{issue.summary}</span>
                <button
                  className={styles.btnSmall}
                  onClick={() => startEdit(issue)}
                  disabled={disabled}
                  aria-label={`Edit ${issue.summary}`}
                >
                  Edit
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div>
          <input
            className={styles.addInput}
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            placeholder="Describe the additional issue..."
            maxLength={500}
          />
          <div className={styles.actions}>
            <button className={styles.btnSmall} onClick={saveAdd} disabled={disabled}>
              Save
            </button>
            <button
              className={styles.btnSmall}
              onClick={() => setAdding(false)}
              disabled={disabled}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.btnPrimary} onClick={onConfirm} disabled={disabled}>
          Confirm
        </button>
        <button className={styles.btnSecondary} onClick={onReject} disabled={disabled}>
          Reject
        </button>
        {selected.size >= 2 && (
          <button className={styles.btnSecondary} onClick={handleMerge} disabled={disabled}>
            Merge selected
          </button>
        )}
        {!adding && (
          <button className={styles.btnSecondary} onClick={startAdd} disabled={disabled}>
            Add issue
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/split-review.test.tsx`
Expected: PASS — all 6 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/split-review.tsx apps/web/src/components/split-review.module.css apps/web/src/components/__tests__/split-review.test.tsx
git commit -m "feat(ui): add SplitReview component for issue split confirmation"
```

---

## Task 7: FollowupForm Component

**Files:**

- Create: `apps/web/src/components/followup-form.tsx`
- Create: `apps/web/src/components/followup-form.module.css`
- Test: `apps/web/src/components/__tests__/followup-form.test.tsx`

Renders follow-up questions from the classifier. Supports `enum` (radio buttons), `yes_no` (radio), and `text` (input) answer types. Submits all answers at once.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/followup-form.test.tsx`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/followup-form.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/followup-form.module.css`:

```css
.container {
  padding: 1rem;
}

.heading {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.questionGroup {
  margin-bottom: 1.25rem;
}

.questionPrompt {
  font-size: 0.9375rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.optionLabel {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0;
  cursor: pointer;
  font-size: 0.9375rem;
}

.textInput {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 0.375rem;
  font-size: 0.9375rem;
}

.submitBtn {
  padding: 0.625rem 1.5rem;
  background: #0066cc;
  color: #fff;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.9375rem;
  margin-top: 0.5rem;
}

.submitBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

Create `apps/web/src/components/followup-form.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { FollowUpQuestion } from '@wo-agent/schemas';
import styles from './followup-form.module.css';

interface FollowupFormProps {
  questions: readonly FollowUpQuestion[];
  onSubmit: (answers: Array<{ question_id: string; answer: unknown }>) => void;
  disabled?: boolean;
}

export function FollowupForm({ questions, onSubmit, disabled = false }: FollowupFormProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const allAnswered = questions.every(
    (q) => answers[q.question_id] !== undefined && answers[q.question_id] !== '',
  );

  function handleSubmit() {
    if (!allAnswered) return;
    const result = questions.map((q) => ({
      question_id: q.question_id,
      answer: answers[q.question_id],
    }));
    onSubmit(result);
  }

  return (
    <div className={styles.container}>
      <p className={styles.heading}>We need a bit more information:</p>

      {questions.map((q) => (
        <div key={q.question_id} className={styles.questionGroup}>
          <p className={styles.questionPrompt}>{q.prompt}</p>

          {(q.answer_type === 'enum' || q.answer_type === 'yes_no') &&
            q.options.map((option) => (
              <label key={option} className={styles.optionLabel}>
                <input
                  type="radio"
                  name={q.question_id}
                  value={option}
                  checked={answers[q.question_id] === option}
                  onChange={() => setAnswer(q.question_id, option)}
                  disabled={disabled}
                />
                {option}
              </label>
            ))}

          {q.answer_type === 'text' && (
            <input
              className={styles.textInput}
              type="text"
              value={(answers[q.question_id] as string) ?? ''}
              onChange={(e) => setAnswer(q.question_id, e.target.value)}
              disabled={disabled}
            />
          )}
        </div>
      ))}

      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={disabled || !allAnswered}
      >
        Submit answers
      </button>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/followup-form.test.tsx`
Expected: PASS — all 6 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/followup-form.tsx apps/web/src/components/followup-form.module.css apps/web/src/components/__tests__/followup-form.test.tsx
git commit -m "feat(ui): add FollowupForm component for classifier follow-up questions"
```

---

## Task 8: ConfirmationPanel Component

**Files:**

- Create: `apps/web/src/components/confirmation-panel.tsx`
- Create: `apps/web/src/components/confirmation-panel.module.css`
- Test: `apps/web/src/components/__tests__/confirmation-panel.test.tsx`

Displays the `confirmation_payload` for tenant review before submission. Shows each issue with its summary, classification labels, confidence levels, and missing fields.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/confirmation-panel.test.tsx`:

```typescript
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
      classification: { Category: 'maintenance', Sub_Location: 'kitchen' },
      confidence_by_field: { Category: 0.95, Sub_Location: 0.88 },
      missing_fields: [] as string[],
      needs_human_triage: false,
    },
    {
      issue_id: 'i2',
      summary: 'Door sticks',
      raw_excerpt: 'door sticks',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Category: 0.72 },
      missing_fields: ['Sub_Location'],
      needs_human_triage: true,
    },
  ],
};

describe('ConfirmationPanel', () => {
  it('renders all issues with summaries', () => {
    render(
      <ConfirmationPanel payload={payload} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText('Kitchen sink leaking')).toBeInTheDocument();
    expect(screen.getByText('Door sticks')).toBeInTheDocument();
  });

  it('displays classification labels', () => {
    render(
      <ConfirmationPanel payload={payload} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/maintenance/)).toBeInTheDocument();
    expect(screen.getByText(/kitchen/)).toBeInTheDocument();
  });

  it('shows human triage badge when needed', () => {
    render(
      <ConfirmationPanel payload={payload} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText(/review needed/i)).toBeInTheDocument();
  });

  it('calls onConfirm when confirmed', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmationPanel payload={payload} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables confirm when disabled', () => {
    render(
      <ConfirmationPanel payload={payload} onConfirm={vi.fn()} disabled />,
    );
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/confirmation-panel.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/confirmation-panel.module.css`:

```css
.container {
  padding: 1rem;
}

.heading {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.issueCard {
  border: 1px solid #e0e0e0;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  background: #fafafa;
}

.issueSummary {
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.labels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.375rem;
}

.label {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 1rem;
  font-size: 0.8125rem;
  background: #e8f0fe;
  color: #1a4d8f;
}

.triageBadge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 1rem;
  font-size: 0.8125rem;
  background: #fff3e0;
  color: #e65100;
}

.missingFields {
  font-size: 0.8125rem;
  color: #888;
  margin-top: 0.25rem;
}

.actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
}

.submitBtn {
  padding: 0.625rem 1.5rem;
  background: #0066cc;
  color: #fff;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.9375rem;
  font-weight: 500;
}

.submitBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

Create `apps/web/src/components/confirmation-panel.tsx`:

```typescript
'use client';

import styles from './confirmation-panel.module.css';

interface ConfirmationIssue {
  issue_id: string;
  summary: string;
  raw_excerpt: string;
  classification: Record<string, string>;
  confidence_by_field: Record<string, number>;
  missing_fields: readonly string[];
  needs_human_triage: boolean;
}

interface ConfirmationPanelProps {
  payload: { issues: readonly ConfirmationIssue[] };
  onConfirm: () => void;
  disabled?: boolean;
}

export function ConfirmationPanel({
  payload,
  onConfirm,
  disabled = false,
}: ConfirmationPanelProps) {
  return (
    <div className={styles.container}>
      <p className={styles.heading}>
        Please review before submitting:
      </p>

      {payload.issues.map((issue) => (
        <div key={issue.issue_id} className={styles.issueCard}>
          <p className={styles.issueSummary}>{issue.summary}</p>

          <div className={styles.labels}>
            {Object.entries(issue.classification).map(([field, value]) => (
              <span key={field} className={styles.label}>
                {value}
              </span>
            ))}
          </div>

          {issue.needs_human_triage && (
            <span className={styles.triageBadge}>Review needed</span>
          )}

          {issue.missing_fields.length > 0 && (
            <p className={styles.missingFields}>
              Missing: {issue.missing_fields.join(', ')}
            </p>
          )}
        </div>
      ))}

      <div className={styles.actions}>
        <button
          className={styles.submitBtn}
          onClick={onConfirm}
          disabled={disabled}
        >
          Submit work order{payload.issues.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/confirmation-panel.test.tsx`
Expected: PASS — all 5 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/confirmation-panel.tsx apps/web/src/components/confirmation-panel.module.css apps/web/src/components/__tests__/confirmation-panel.test.tsx
git commit -m "feat(ui): add ConfirmationPanel component for pre-submission review"
```

---

## Task 9: StatusIndicator Component

**Files:**

- Create: `apps/web/src/components/status-indicator.tsx`
- Create: `apps/web/src/components/status-indicator.module.css`
- Test: `apps/web/src/components/__tests__/status-indicator.test.tsx`

Shows loading spinners, error messages, and success confirmations for intermediate states (`split_in_progress`, `classification_in_progress`, `submitted`, error states).

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/status-indicator.test.tsx`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/status-indicator.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/status-indicator.module.css`:

```css
.container {
  padding: 1.5rem;
  text-align: center;
}

.spinner {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  border: 3px solid #e0e0e0;
  border-top-color: #0066cc;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 0.75rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.message {
  font-size: 0.9375rem;
  color: #555;
  margin-bottom: 0.75rem;
}

.success {
  color: #2e7d32;
}

.error {
  color: #c62828;
}

.woList {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0;
}

.woItem {
  font-family: monospace;
  font-size: 0.875rem;
  padding: 0.25rem 0;
}

.actionBtn {
  padding: 0.5rem 1.25rem;
  background: #0066cc;
  color: #fff;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

.actionBtn:hover {
  background: #0052a3;
}
```

Create `apps/web/src/components/status-indicator.tsx`:

```typescript
'use client';

import styles from './status-indicator.module.css';

interface StatusIndicatorProps {
  state: string;
  workOrderIds?: readonly string[];
  onRetry?: () => void;
  onResume?: () => void;
  onStartOver?: () => void;
}

const MESSAGES: Record<string, string> = {
  split_in_progress: 'Analyzing your message...',
  split_finalized: 'Preparing classification...',
  classification_in_progress: 'Classifying your issues...',
  submitted: 'Your work orders have been submitted!',
  llm_error_retryable: 'Something went wrong. You can try again.',
  llm_error_terminal: 'Unable to process your request automatically.',
  intake_abandoned: 'This conversation was paused.',
  intake_expired: 'This session has expired. Please start a new conversation.',
};

const PROCESSING_STATES = new Set([
  'split_in_progress',
  'split_finalized',
  'classification_in_progress',
]);

export function StatusIndicator({
  state,
  workOrderIds,
  onRetry,
  onResume,
  onStartOver,
}: StatusIndicatorProps) {
  const message = MESSAGES[state] ?? state;
  const isProcessing = PROCESSING_STATES.has(state);
  const isSuccess = state === 'submitted';
  const isError = state === 'llm_error_retryable' || state === 'llm_error_terminal';

  return (
    <div className={styles.container} role="status">
      {isProcessing && <div className={styles.spinner} />}

      <p
        className={`${styles.message} ${isSuccess ? styles.success : ''} ${isError ? styles.error : ''}`}
      >
        {message}
      </p>

      {isSuccess && workOrderIds && workOrderIds.length > 0 && (
        <ul className={styles.woList}>
          {workOrderIds.map((id) => (
            <li key={id} className={styles.woItem}>{id}</li>
          ))}
        </ul>
      )}

      {state === 'llm_error_retryable' && onRetry && (
        <button className={styles.actionBtn} onClick={onRetry}>
          Try again
        </button>
      )}

      {state === 'llm_error_terminal' && onStartOver && (
        <button className={styles.actionBtn} onClick={onStartOver}>
          Start over
        </button>
      )}

      {state === 'intake_expired' && onStartOver && (
        <button className={styles.actionBtn} onClick={onStartOver}>
          Start over
        </button>
      )}

      {state === 'intake_abandoned' && onResume && (
        <button className={styles.actionBtn} onClick={onResume}>
          Resume
        </button>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/status-indicator.test.tsx`
Expected: PASS — all 7 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/status-indicator.tsx apps/web/src/components/status-indicator.module.css apps/web/src/components/__tests__/status-indicator.test.tsx
git commit -m "feat(ui): add StatusIndicator for processing, success, and error states"
```

---

## Task 10: QuickReplies Component

**Files:**

- Create: `apps/web/src/components/quick-replies.tsx`
- Create: `apps/web/src/components/quick-replies.module.css`
- Test: `apps/web/src/components/__tests__/quick-replies.test.tsx`

Renders `ui_directive.quick_replies` as clickable buttons. Each button dispatches the corresponding action.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/quick-replies.test.tsx`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/quick-replies.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/quick-replies.module.css`:

```css
.container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
}

.replyBtn {
  padding: 0.375rem 0.875rem;
  border: 1px solid #0066cc;
  border-radius: 1.25rem;
  background: #fff;
  color: #0066cc;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s;
}

.replyBtn:hover:not(:disabled) {
  background: #e8f0fe;
}

.replyBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

Create `apps/web/src/components/quick-replies.tsx`:

```typescript
'use client';

import styles from './quick-replies.module.css';

interface Reply {
  label: string;
  value: string;
  action_type?: string;
}

interface QuickRepliesProps {
  replies: readonly Reply[];
  onSelect: (reply: Reply) => void;
  disabled?: boolean;
}

export function QuickReplies({ replies, onSelect, disabled = false }: QuickRepliesProps) {
  if (replies.length === 0) return null;

  return (
    <div className={styles.container}>
      {replies.map((reply) => (
        <button
          key={reply.value}
          className={styles.replyBtn}
          onClick={() => onSelect(reply)}
          disabled={disabled}
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/quick-replies.test.tsx`
Expected: PASS — all 4 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/quick-replies.tsx apps/web/src/components/quick-replies.module.css apps/web/src/components/__tests__/quick-replies.test.tsx
git commit -m "feat(ui): add QuickReplies component for server-driven action buttons"
```

---

## Task 11: ChatShell — Main Conversation Container

**Files:**

- Create: `apps/web/src/components/chat-shell.tsx`
- Create: `apps/web/src/components/chat-shell.module.css`
- Test: `apps/web/src/components/__tests__/chat-shell.test.tsx`

The top-level orchestration component. Uses `useConversation` hook internally. Reads `conversation_snapshot.state` and renders the appropriate sub-component: message list, unit selector, split review, followup form, confirmation panel, or status indicator. This is the state-machine consumer that wires everything together.

**Step 1: Write the failing test**

Create `apps/web/src/components/__tests__/chat-shell.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatShell } from '../chat-shell';
import * as api from '@/lib/api-client';

vi.mock('@/lib/api-client');

const makeResponse = (state: string, extras: Record<string, unknown> = {}) => ({
  conversation_snapshot: {
    conversation_id: 'conv-1',
    state,
    pinned_versions: {
      taxonomy_version: '1',
      schema_version: '1',
      model_id: 'test',
      prompt_version: '1',
    },
    ...extras,
  },
  ui_directive: {
    messages: [
      { role: 'agent' as const, content: 'Hello!', timestamp: '2026-03-04T10:00:00Z' },
    ],
    quick_replies: [],
  },
  artifacts: [],
  pending_side_effects: [],
  errors: [],
});

describe('ChatShell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders start button before conversation begins', () => {
    render(<ChatShell token="tok" unitIds={['unit-1']} />);
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('starts conversation and shows message input after unit_selected', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(
      makeResponse('unit_selected') as any,
    );
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows unit selector when unit_selection_required', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(
      makeResponse('unit_selection_required') as any,
    );
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1', 'unit-2']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/which unit/i)).toBeInTheDocument();
  });

  it('shows split review when split_proposed', async () => {
    const resp = makeResponse('split_proposed', {
      issues: [
        { issue_id: 'i1', summary: 'Sink leaking', raw_excerpt: 'sink' },
      ],
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText('Sink leaking')).toBeInTheDocument();
  });

  it('shows followup form when needs_tenant_input', async () => {
    const resp = makeResponse('needs_tenant_input', {
      pending_followup_questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Where is the issue?',
          options: ['kitchen', 'bathroom'],
          answer_type: 'enum',
        },
      ],
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText('Where is the issue?')).toBeInTheDocument();
  });

  it('shows confirmation panel when tenant_confirmation_pending', async () => {
    const resp = makeResponse('tenant_confirmation_pending', {
      confirmation_payload: {
        issues: [
          {
            issue_id: 'i1',
            summary: 'Sink leaking',
            raw_excerpt: 'sink',
            classification: { Category: 'maintenance' },
            confidence_by_field: { Category: 0.95 },
            missing_fields: [],
            needs_human_triage: false,
          },
        ],
      },
    });
    vi.mocked(api.createConversation).mockResolvedValueOnce(resp as any);
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/review before submitting/i)).toBeInTheDocument();
  });

  it('shows status indicator for processing states', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(
      makeResponse('split_in_progress') as any,
    );
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
  });

  it('displays chat messages from ui_directive', async () => {
    vi.mocked(api.createConversation).mockResolvedValueOnce(
      makeResponse('unit_selected') as any,
    );
    const user = userEvent.setup();
    render(<ChatShell token="tok" unitIds={['unit-1']} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/components/__tests__/chat-shell.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/chat-shell.module.css`:

```css
.shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 48rem;
  margin: 0 auto;
  background: #fff;
}

.header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
  font-size: 1rem;
  background: #f8f9fa;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

.interactionArea {
  border-top: 1px solid #e0e0e0;
}

.startContainer {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.startBtn {
  padding: 0.75rem 2rem;
  background: #0066cc;
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
}

.startBtn:hover {
  background: #0052a3;
}

.errorBanner {
  padding: 0.5rem 1rem;
  background: #fde8e8;
  color: #c62828;
  font-size: 0.875rem;
  text-align: center;
}
```

Create `apps/web/src/components/chat-shell.tsx`:

```typescript
'use client';

import { useConversation } from '@/hooks/use-conversation';
import { ChatMessage } from './chat-message';
import { MessageInput } from './message-input';
import { UnitSelector } from './unit-selector';
import { SplitReview } from './split-review';
import { FollowupForm } from './followup-form';
import { ConfirmationPanel } from './confirmation-panel';
import { StatusIndicator } from './status-indicator';
import { QuickReplies } from './quick-replies';
import styles from './chat-shell.module.css';

interface ChatShellProps {
  token: string;
  unitIds: readonly string[];
}

const INPUT_STATES = new Set([
  'intake_started',
  'unit_selected',
]);

const PROCESSING_STATES = new Set([
  'split_in_progress',
  'split_finalized',
  'classification_in_progress',
]);

const TERMINAL_STATES = new Set([
  'submitted',
  'llm_error_retryable',
  'llm_error_terminal',
  'intake_abandoned',
  'intake_expired',
]);

export function ChatShell({ token, unitIds }: ChatShellProps) {
  const conv = useConversation(token);
  const snapshot = conv.response?.conversation_snapshot;
  const directive = conv.response?.ui_directive;
  const state = snapshot?.state;
  const isLoading = conv.status === 'loading';

  if (!conv.response) {
    return (
      <div className={styles.shell}>
        <div className={styles.header}>Maintenance Portal</div>
        <div className={styles.startContainer}>
          <button className={styles.startBtn} onClick={conv.startConversation}>
            Start a request
          </button>
        </div>
      </div>
    );
  }

  const messages = directive?.messages ?? [];
  const quickReplies = directive?.quick_replies ?? [];

  return (
    <div className={styles.shell}>
      <div className={styles.header}>Maintenance Portal</div>

      {conv.error && <div className={styles.errorBanner}>{conv.error}</div>}

      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
        ))}
      </div>

      <div className={styles.interactionArea}>
        {/* Unit selection */}
        {state === 'unit_selection_required' && (
          <UnitSelector
            unitIds={unitIds}
            onSelect={conv.selectUnit}
            disabled={isLoading}
          />
        )}

        {/* Split review */}
        {state === 'split_proposed' && snapshot?.issues && (
          <SplitReview
            issues={snapshot.issues as any}
            onConfirm={conv.confirmSplit}
            onReject={conv.rejectSplit}
            onEdit={conv.editIssue}
            onMerge={conv.mergeIssues}
            onAdd={conv.addIssue}
            disabled={isLoading}
          />
        )}

        {/* Follow-up questions */}
        {state === 'needs_tenant_input' && snapshot?.pending_followup_questions && (
          <FollowupForm
            questions={snapshot.pending_followup_questions as any}
            onSubmit={conv.answerFollowups}
            disabled={isLoading}
          />
        )}

        {/* Confirmation */}
        {state === 'tenant_confirmation_pending' && snapshot?.confirmation_payload && (
          <ConfirmationPanel
            payload={snapshot.confirmation_payload as any}
            onConfirm={conv.confirmSubmission}
            disabled={isLoading}
          />
        )}

        {/* Processing states */}
        {state && PROCESSING_STATES.has(state) && (
          <StatusIndicator state={state} />
        )}

        {/* Terminal and error states */}
        {state && TERMINAL_STATES.has(state) && (
          <StatusIndicator
            state={state}
            workOrderIds={snapshot?.work_order_ids as string[] | undefined}
            onRetry={() => conv.resumeConversation(conv.conversationId!)}
            onResume={() => conv.resumeConversation(conv.conversationId!)}
            onStartOver={conv.startConversation}
          />
        )}

        {/* Quick replies */}
        {quickReplies.length > 0 && (
          <QuickReplies
            replies={quickReplies}
            onSelect={() => {}}
            disabled={isLoading}
          />
        )}

        {/* Message input for text-entry states */}
        {state && INPUT_STATES.has(state) && (
          <MessageInput
            onSend={conv.submitInitialMessage}
            disabled={isLoading}
          />
        )}

        {/* Additional message input for states that accept it */}
        {(state === 'needs_tenant_input' || state === 'tenant_confirmation_pending') && (
          <MessageInput
            onSend={conv.submitAdditionalMessage}
            disabled={isLoading}
            placeholder="Add more details..."
          />
        )}
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/components/__tests__/chat-shell.test.tsx`
Expected: PASS — all 8 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat-shell.tsx apps/web/src/components/chat-shell.module.css apps/web/src/components/__tests__/chat-shell.test.tsx
git commit -m "feat(ui): add ChatShell orchestration component wiring state machine to UI"
```

---

## Task 12: Wire ChatShell into Page

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`

Replace the stub page with the ChatShell. For MVP, token and unit IDs come from URL query params (a real auth flow is out of scope for this phase).

**Step 1: Write the failing test**

Create `apps/web/src/app/__tests__/page.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPage from '../page';

vi.mock('@/components/chat-shell', () => ({
  ChatShell: ({ token }: { token: string }) => (
    <div data-testid="chat-shell" data-token={token} />
  ),
}));

describe('ChatPage', () => {
  it('renders ChatShell when token is provided via searchParams', () => {
    render(<ChatPage searchParams={{ token: 'test-tok', units: 'u1,u2' }} />);
    expect(screen.getByTestId('chat-shell')).toBeInTheDocument();
    expect(screen.getByTestId('chat-shell')).toHaveAttribute('data-token', 'test-tok');
  });

  it('shows auth prompt when no token', () => {
    render(<ChatPage searchParams={{}} />);
    expect(screen.getByText(/token required/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test src/app/__tests__/page.test.tsx`
Expected: FAIL — module not found or existing test fails.

**Step 3: Write minimal implementation**

Update `apps/web/src/app/page.tsx`:

```typescript
'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ChatShell } from '@/components/chat-shell';

function ChatPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const units = searchParams.get('units');

  if (!token) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Token required. Append <code>?token=YOUR_JWT&units=unit1,unit2</code> to the URL.</p>
      </div>
    );
  }

  const unitIds = units ? units.split(',').filter(Boolean) : [];

  return <ChatShell token={token} unitIds={unitIds} />;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <ChatPageContent />
    </Suspense>
  );
}
```

Update `apps/web/src/app/layout.tsx` — add a viewport meta tag and basic global styles:

```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Maintenance Portal',
  description: 'Submit and track maintenance requests',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test src/app/__tests__/page.test.tsx`
Expected: PASS — both tests green.

**Step 5: Run full test suite**

Run: `cd apps/web && pnpm test`
Expected: All tests pass.

**Step 6: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: No type errors.

**Step 7: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/layout.tsx apps/web/src/app/__tests__/page.test.tsx
git commit -m "feat(ui): wire ChatShell into main page with query param auth (MVP)"
```

---

## Task 13: Smoke Test — Full Flow Verification

**Files:**

- No new files. Verification only.

**Step 1: Run full test suite across all packages**

Run: `pnpm test`
Expected: All packages pass.

**Step 2: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: No type errors.

**Step 3: Build the app**

Run: `cd apps/web && pnpm build`
Expected: Build succeeds.

**Step 4: Commit if any fixes were needed**

If any fixes were applied, commit them with an appropriate message.

---

## Summary

| Task | Component           | What it does                           |
| ---- | ------------------- | -------------------------------------- |
| 0    | Test setup          | React Testing Library + jsdom          |
| 1    | `api-client`        | Typed fetch wrappers for all endpoints |
| 2    | `useConversation`   | Hook managing state + dispatch         |
| 3    | `ChatMessage`       | Single message bubble                  |
| 4    | `MessageInput`      | Text input with send button            |
| 5    | `UnitSelector`      | Multi-unit selection                   |
| 6    | `SplitReview`       | Issue split confirmation/editing       |
| 7    | `FollowupForm`      | Follow-up question answers             |
| 8    | `ConfirmationPanel` | Pre-submission review                  |
| 9    | `StatusIndicator`   | Loading/error/success states           |
| 10   | `QuickReplies`      | Server-driven action buttons           |
| 11   | `ChatShell`         | Top-level orchestration                |
| 12   | Page wiring         | Connect to Next.js page                |
| 13   | Smoke test          | Full verification                      |
