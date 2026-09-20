/**
 * The platform module's only public surface. Other modules import from here, never from
 * repo.ts and never across schemas in SQL.
 */
export type {
  AppUser, AuditEntry, Feedback, FeedbackInput, FeedbackKind, FeedbackPriority,
  FeedbackStatus, SourceSync, SyncStatus, Vehicle, VehicleKind,
} from './types';
export {
  appendAudit, attachIssueRef, getUserByHandle, insertFeedback, listSyncSources,
  listUsers, listVehicles, recentAudit,
} from './repo';
export { fileFeedback, type FeedbackCommand } from './service';
