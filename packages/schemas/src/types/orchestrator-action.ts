import type { ActionType, ActorType } from '../action-types.js';
import type { ConversationState } from '../conversation-states.js';
import type { FollowUpQuestion } from './followups.js';
import type { SplitIssue } from './issue-split.js';
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

export interface TenantInputConfirmEmergency {}

export interface TenantInputDeclineEmergency {}

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
  | TenantInputConfirmEmergency
  | TenantInputDeclineEmergency
  | TenantInputResume
  | TenantInputAbandon;

// --- Request (discriminated union) ---

interface OrchestratorActionRequestBase {
  readonly conversation_id: string | null;
  readonly actor: ActorType;
  readonly idempotency_key?: string;
  readonly request_id?: string;
  readonly auth_context: AuthContext;
}

export type OrchestratorActionRequest =
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'CREATE_CONVERSATION';
      readonly tenant_input: TenantInputCreateConversation;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'SELECT_UNIT';
      readonly tenant_input: TenantInputSelectUnit;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'SUBMIT_INITIAL_MESSAGE';
      readonly tenant_input: TenantInputSubmitInitialMessage;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'SUBMIT_ADDITIONAL_MESSAGE';
      readonly tenant_input: TenantInputSubmitAdditionalMessage;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'CONFIRM_SPLIT';
      readonly tenant_input: TenantInputConfirmSplit;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'MERGE_ISSUES';
      readonly tenant_input: TenantInputMergeIssues;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'EDIT_ISSUE';
      readonly tenant_input: TenantInputEditIssue;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'ADD_ISSUE';
      readonly tenant_input: TenantInputAddIssue;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'REJECT_SPLIT';
      readonly tenant_input: TenantInputRejectSplit;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'ANSWER_FOLLOWUPS';
      readonly tenant_input: TenantInputAnswerFollowups;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'CONFIRM_SUBMISSION';
      readonly tenant_input: TenantInputConfirmSubmission;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'UPLOAD_PHOTO_INIT';
      readonly tenant_input: TenantInputUploadPhotoInit;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'UPLOAD_PHOTO_COMPLETE';
      readonly tenant_input: TenantInputUploadPhotoComplete;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'CONFIRM_EMERGENCY';
      readonly tenant_input: TenantInputConfirmEmergency;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'DECLINE_EMERGENCY';
      readonly tenant_input: TenantInputDeclineEmergency;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'RESUME';
      readonly tenant_input: TenantInputResume;
    })
  | (OrchestratorActionRequestBase & {
      readonly action_type: 'ABANDON';
      readonly tenant_input: TenantInputAbandon;
    });

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
  readonly state: ConversationState;
  readonly unit_id?: string | null;
  readonly issues?: readonly SplitIssue[];
  readonly classification_results?: readonly Record<string, unknown>[];
  readonly pending_followup_questions?: readonly FollowUpQuestion[] | null;
  readonly confirmation_payload?: {
    readonly issues: readonly {
      readonly issue_id: string;
      readonly summary: string;
      readonly raw_excerpt: string;
      readonly classification: Record<string, string>;
      readonly confidence_by_field: Record<string, number>;
      readonly missing_fields: readonly string[];
      readonly needs_human_triage: boolean;
      readonly display_fields?: readonly {
        readonly field: string;
        readonly field_label: string;
        readonly value: string;
        readonly value_label: string;
      }[];
    }[];
  };
  readonly work_order_ids?: readonly string[];
  readonly queued_messages?: readonly string[];
  readonly risk_summary?: {
    readonly has_emergency: boolean;
    readonly highest_severity: string;
    readonly trigger_ids: readonly string[];
    readonly escalation_state: string;
  };
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
