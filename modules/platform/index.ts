/**
 * The platform module's only public surface. Other modules import from here, never from
 * repo.ts and never across schemas in SQL.
 */
export type {
  AppUser, AuditEntry, Feedback, FeedbackInput, FeedbackKind, FeedbackPriority,
  FeedbackStatus, SourceSync, SyncStatus, Vehicle, VehicleKind,
} from './types';
export type { AuditRow, FeedbackRow } from './repo';
export {
  appendAudit, attachIssueRef, auditFor, auditLog, auditSince, getUserByHandle, insertFeedback, listFeedback,
  listSyncSources, listUsers, listVehicles, recentAudit,
} from './repo';
export { fileFeedback, type FeedbackCommand } from './service';
