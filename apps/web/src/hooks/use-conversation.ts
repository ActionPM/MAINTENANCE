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

  const confirmEmergency = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return dispatch(api.confirmEmergency, token, conversationId);
  }, [token, conversationId]);

  const declineEmergency = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return dispatch(api.declineEmergency, token, conversationId);
  }, [token, conversationId]);

  const resumeConversation = useCallback(
    (id: string) => dispatch(api.resumeConversation, token, id),
    [token],
  );

  const startWithQueuedText = useCallback(
    async (messages: readonly string[], unitId: string) => {
      setStatus('loading');
      setError(null);
      try {
        const created = await api.createConversation(token);
        const newId = created.conversation_snapshot.conversation_id;
        let current = created;

        // If CREATE_CONVERSATION already auto-selected the unit (single-unit tenant),
        // skip SELECT_UNIT — the transition matrix doesn't allow it from unit_selected.
        if (current.conversation_snapshot.state !== 'unit_selected') {
          current = await api.selectUnit(token, newId, unitId);
        }

        // Guard: only continue to submit if we actually reached unit_selected.
        // SELECT_UNIT can return unit_selection_required with errors (resolver-null)
        // and the route returns 200, not 4xx — so the API client won't throw.
        if (current.conversation_snapshot.state !== 'unit_selected') {
          setResponse(current);
          setStatus('ready');
          return;
        }

        const result = await api.submitInitialMessage(token, newId, messages.join('\n'));
        setResponse(result);
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      }
    },
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
    confirmEmergency,
    declineEmergency,
    resumeConversation,
    startWithQueuedText,
  };
}
