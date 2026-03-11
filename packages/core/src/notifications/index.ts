export type {
  NotificationRepository,
  NotificationPreferenceStore,
  SmsSender,
  NotificationListFilters,
} from './types.js';
export {
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
} from './in-memory-notification-store.js';
export { buildWoCreatedNotificationEvent } from './event-builder.js';
export type { WoCreatedNotificationInput } from './event-builder.js';
export { NotificationService } from './notification-service.js';
export type {
  NotificationServiceDeps,
  NotifyWoCreatedInput,
  NotifyResult,
} from './notification-service.js';
export { MockSmsSender } from './mock-sms-sender.js';
export {
  updateNotificationPreferences,
  grantSmsConsent,
  revokeSmsConsent,
} from './preference-service.js';
export type {
  UpdatePrefsInput,
  GrantSmsConsentInput,
  RevokeSmsConsentInput,
} from './preference-service.js';
