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

// --- Emergency ---

export function confirmEmergency(
  token: string,
  conversationId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/confirm-emergency`, token, {
    method: 'POST',
    body: '{}',
  });
}

export function declineEmergency(
  token: string,
  conversationId: string,
): Promise<OrchestratorActionResponse> {
  return request(`/api/conversations/${conversationId}/decline-emergency`, token, {
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
