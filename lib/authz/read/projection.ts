import { can, type Principal } from '@/lib/authz';

/** Deliberately allowlisted DTO: adding a column to a source record cannot widen a reader's access. */
export interface PipelineIdentity {
  id: string; entityId: string; name: string; vehicleId: string; vehicle: string;
  owner: string; status: string; restricted: boolean;
}
export interface NoteIdentity { id: string; entityId: string; author: string | null; at: string }
export function projectPipeline(user: Principal, rows: readonly PipelineIdentity[], notes: readonly NoteIdentity[] = []) {
  const visible = rows.filter(row => can(user, 'read', { vehicle: row.vehicleId }));
  const entities = new Set(visible.map(row => row.entityId));
  return {
    rows: visible.map(row => ({ id: row.id, entityId: row.entityId, name: row.name,
      vehicleId: row.vehicleId, vehicle: row.vehicle, owner: row.owner, status: row.status, restricted: row.restricted })),
    notes: notes.filter(note => entities.has(note.entityId)).map(note => ({ id: note.id, entityId: note.entityId, author: note.author, at: note.at })),
    outsideScope: rows.length - visible.length,
    // Cross-vehicle presence stays visible without exposing status, amounts or words.
    overlaps: rows.filter(row => entities.has(row.entityId) && !can(user, 'read', { vehicle: row.vehicleId }))
      .map(row => ({ entityId: row.entityId, vehicle: row.vehicle, owner: row.owner, restricted: row.restricted })),
  };
}
export function needsScopedProjection(user: Principal): boolean {
  return user.access === 'viewer' || (user.access !== 'admin' && user.vehicles !== null);
}
