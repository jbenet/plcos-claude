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
  activeAdminCount, activeUsersByEmail, deleteSettingRow, ensureAdmin, raiseSessionEpoch, readSettingRows, sessionUser,
  upsertSettingRow, type SettingRow,
} from './settings';
export { addPerson, listPeople, PeopleRefused, setPersonActive, updateAddresses, updatePerson, type Access, type NewPerson, type Person } from './people';
export { createVehicle, VehicleRefused, writeVehicle } from './vehicles';
export {
  checkNewVehicle, EXEMPTIONS, slugFromName, slugProblem, VEHICLE_KINDS, VEHICLE_PHASES, type Exemption, type NewVehicle, type VehicleRowInput,
} from './client';
export { deletePersonSecret, readPersonSecret, writePersonSecret } from './person-secrets';
export {
  AddressClash, AddressInvalid, addressClashes, addressesOf, allAddresses, normalizeAddressSet, ownerOfAddress, setAddresses,
  type AddressKind, type AddressSet, type UserAddress,
} from './addresses';
export {
  createMcpToken, findMcpToken, hashToken, listMcpTokens, looksLikeToken, revokeMcpToken, TokenRefused, type McpToken, type NewToken, type TokenState,
} from './mcp-tokens';
