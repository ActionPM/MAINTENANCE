/**
 * Rate limit configuration (spec §8).
 * Defaults are required for abuse/DoS protection; configurable per client.
 */
export interface RateLimitConfig {
  readonly max_messages_per_minute_per_user: number;
  readonly max_new_conversations_per_day_per_user: number;
  readonly max_photo_uploads_per_conversation: number;
  readonly max_photo_size_mb: number;
  readonly max_message_chars: number;
  readonly max_issues_per_conversation: number;
  readonly max_issue_text_chars: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  max_messages_per_minute_per_user: 10,
  max_new_conversations_per_day_per_user: 20,
  max_photo_uploads_per_conversation: 10,
  max_photo_size_mb: 10,
  max_message_chars: 8000,
  max_issues_per_conversation: 10,
  max_issue_text_chars: 500,
} as const;
