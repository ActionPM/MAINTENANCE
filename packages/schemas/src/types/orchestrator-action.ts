import type { ActionType, ActorType } from '../action-types.js';
import type { PinnedVersions } from '../version-pinning.js';

export interface AuthContext {
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly authorized_unit_ids: readonly string[];
}

// --- Tenant input shapes per action type ---

export interface TenantInputCreateConversation {}

export interface TenantInputSelectUnit {
  readonly unit_id: string;
}

export interface TenantInputSubmitInitialMessage {
  readonly message: string;
}

export interface TenantInputSubmitAdditionalMessage {
  readonly message: string;
}

export interface TenantInputConfirmSplit {}

export interface TenantInputMergeIssues {
  readonly issue_ids: readonly string[];
}

export interface TenantInputEditIssue {
  readonly issue_id: string;
  readonly summary: string;
}

export interface TenantInputAddIssue {
  readonly summary: string;
}

export interface TenantInputRejectSplit {}

export interface TenantInputAnswerFollowups {
  readonly answers: readonly {
    readonly question_id: string;
    readonly answer: unknown;
  }[];
}

export interface TenantInputConfirmSubmission {}

export interface TenantInputUploadPhotoInit {
  readonly filename: string;
  readonly content_type: 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp';
  readonly size_bytes: number;
}

export interface TenantInputUploadPhotoComplete {
  readonly photo_id: string;
  readonly storage_key: string;
  readonly sha256: string;
}

export interface TenantInputResume {}

export interface TenantInputAbandon {}

export type TenantInput =
  | TenantInputCreateConversation
  | TenantInputSelectUnit
  | TenantInputSubmitInitialMessage
  | TenantInputSubmitAdditionalMessage
  | TenantInputConfirmSplit
  | TenantInputMergeIssues
  | TenantInputEditIssue
  | TenantInputAddIssue
  | TenantInputRejectSplit
  | TenantInputAnswerFollowups
  | TenantInputConfirmSubmission
  | TenantInputUploadPhotoInit
  | TenantInputUploadPhotoComplete
  | TenantInputResume
  | TenantInputAbandon;

// --- Request ---

export interface OrchestratorActionRequest {
  readonly conversation_id: string | null;
  readonly action_type: ActionType;
  readonly actor: ActorType;
  readonly tenant_input: TenantInput;
  readonly idempotency_key?: string;
  readonly auth_context: AuthContext;
}

// --- Response ---

export interface UIMessage {
  readonly role: 'system' | 'agent' | 'tenant';
  readonly content: string;
  readonly timestamp: string;
}

export interface QuickReply {
  readonly label: string;
  readonly value: string;
  readonly action_type?: ActionType;
}

export interface UIDirective {
  readonly messages?: readonly UIMessage[];
  readonly quick_replies?: readonly QuickReply[];
  readonly forms?: readonly Record<string, unknown>[];
  readonly upload_prompts?: readonly Record<string, unknown>[];
}

export interface ConversationSnapshot {
  readonly conversation_id: string;
  readonly state: string;
  readonly unit_id?: string | null;
  readonly issues?: readonly Record<string, unknown>[];
  readonly pinned_versions: PinnedVersions;
  readonly created_at?: string;
  readonly last_activity_at?: string;
}

export interface Artifact {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly hash: string;
  readonly created_at: string;
  readonly presented_to_tenant: boolean;
}

export interface SideEffect {
  readonly effect_type: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly idempotency_key?: string;
}

export interface ActionError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export interface OrchestratorActionResponse {
  readonly conversation_snapshot: ConversationSnapshot;
  readonly ui_directive: UIDirective;
  readonly artifacts: readonly Artifact[];
  readonly pending_side_effects: readonly SideEffect[];
  readonly errors: readonly ActionError[];
}
