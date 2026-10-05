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
  appendAudit, attachIssueRef, auditFor, auditLog, auditSince, getUserByHandle, resolveLabosUser, insertFeedback, listFeedback,
  listSyncSources, listUsers, listVehicles, recentAudit,
} from './repo';
export { fileFeedback, type FeedbackCommand } from './service';
export {
  createMcpToken, createSyncToken, findMcpToken, hashToken, listMcpTokens, looksLikeToken, maySyncScope, revokeMcpToken, TOKEN_SCOPES, TokenRefused,
  type McpToken, type NewToken, type TokenScope, type TokenState,
} from './mcp-tokens';
