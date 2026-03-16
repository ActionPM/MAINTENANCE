import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversation } from '../use-conversation';
import * as api from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    createConversation: vi.fn(),
    selectUnit: vi.fn(),
    submitInitialMessage: vi.fn(),
    submitAdditionalMessage: vi.fn(),
    confirmSplit: vi.fn(),
    rejectSplit: vi.fn(),
    mergeIssues: vi.fn(),
    editIssue: vi.fn(),
    addIssue: vi.fn(),
    answerFollowups: vi.fn(),
    confirmSubmission: vi.fn(),
    resumeConversation: vi.fn(),
    initPhotoUpload: vi.fn(),
    completePhotoUpload: vi.fn(),
    fetchDrafts: vi.fn(),
  };
});

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

  // --- S12-03: startWithQueuedText ---

  it('startWithQueuedText chains create → selectUnit → submitInitialMessage', async () => {
    const r1 = makeResponse('intake_started');
    const r2 = makeResponse('unit_selected');
    const r3 = makeResponse('split_proposed');
    vi.mocked(api.createConversation).mockResolvedValueOnce(r1 as any);
    vi.mocked(api.selectUnit).mockResolvedValueOnce(r2 as any);
    vi.mocked(api.submitInitialMessage).mockResolvedValueOnce(r3 as any);

    const { result } = renderHook(() => useConversation('token'));

    await act(async () => {
      await result.current.startWithQueuedText(['kitchen sink leaking'], 'unit-1');
    });

    expect(api.createConversation).toHaveBeenCalledWith('token');
    expect(api.selectUnit).toHaveBeenCalledWith('token', 'conv-1', 'unit-1');
    expect(api.submitInitialMessage).toHaveBeenCalledWith(
      'token',
      'conv-1',
      'kitchen sink leaking',
    );
    expect(result.current.response?.conversation_snapshot.state).toBe('split_proposed');
    expect(result.current.status).toBe('ready');
  });

  it('startWithQueuedText joins multiple messages with newline', async () => {
    const r1 = makeResponse('intake_started');
    const r2 = makeResponse('unit_selected');
    const r3 = makeResponse('split_proposed');
    vi.mocked(api.createConversation).mockResolvedValueOnce(r1 as any);
    vi.mocked(api.selectUnit).mockResolvedValueOnce(r2 as any);
    vi.mocked(api.submitInitialMessage).mockResolvedValueOnce(r3 as any);

    const { result } = renderHook(() => useConversation('token'));

    await act(async () => {
      await result.current.startWithQueuedText(['sink leaking', 'light broken'], 'unit-1');
    });

    expect(api.submitInitialMessage).toHaveBeenCalledWith(
      'token',
      'conv-1',
      'sink leaking\nlight broken',
    );
  });

  it('startWithQueuedText sets error on mid-chain failure', async () => {
    const r1 = makeResponse('intake_started');
    vi.mocked(api.createConversation).mockResolvedValueOnce(r1 as any);
    vi.mocked(api.selectUnit).mockRejectedValueOnce(
      new api.ApiError(404, 'UNIT_NOT_FOUND', 'Unit not found'),
    );

    const { result } = renderHook(() => useConversation('token'));

    await act(async () => {
      await result.current.startWithQueuedText(['sink leaking'], 'bad-unit');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Unit not found');
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
