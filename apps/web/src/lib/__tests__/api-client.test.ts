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
