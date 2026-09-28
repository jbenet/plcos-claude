/** Server-independent policy. Unknown roles/actions and unresolved scopes fail closed. */
export type Role = 'admin' | 'gp' | 'viewer';
export type FieldClass = 'R1' | 'R2' | 'R3' | 'R4';
export type Action = 'read' | 'mutate' | 'admin' | 'approve' | 'feedback' | 'session';
export interface Principal {
  access: Role;
  /** null explicitly means all vehicles; [] means no vehicles. */
  vehicles: readonly string[] | null;
  approves?: readonly string[];
}
export interface Scope { vehicle?: string | readonly string[] | null; fieldClass?: FieldClass; ticketKind?: string }
export function can(user: Principal | null | undefined, action: Action, scope: Scope = {}): boolean {
  if (!user || !['admin', 'gp', 'viewer'].includes(user.access)) return false;
  if (!['read', 'mutate', 'admin', 'approve', 'feedback', 'session'].includes(action)) return false;
  if (scope.fieldClass && !['R1', 'R2', 'R3', 'R4'].includes(scope.fieldClass)) return false;
  if (user.vehicles !== null && !Array.isArray(user.vehicles)) return false;
  if (scope.fieldClass === 'R3' && user.access !== 'admin') return false;
  if (scope.fieldClass && user.access === 'viewer') return false;
  if (action === 'feedback' || action === 'session') return true;
  if (user.access === 'admin') return true;
  if (action === 'admin') return false;
  const vehicles = typeof scope.vehicle === 'string' ? [scope.vehicle] : scope.vehicle;
  // A global read/write requires all-vehicle access. Never treat omitted scope as a wildcard.
  if (user.vehicles !== null && (!vehicles?.length || !vehicles.every(v => user.vehicles!.includes(v)))) return false;
  if (action === 'read') return true;
  if (user.access === 'viewer') return false;
  if (action === 'approve') return !!scope.ticketKind && ['STAGE', 'INTRO_ASK', 'SEND'].includes(scope.ticketKind) && !!user.approves?.includes(scope.ticketKind);
  return action === 'mutate';
}
export class AuthorizationError extends Error {
  constructor() { super('You do not have access to this action or vehicle.'); this.name = 'AuthorizationError'; }
}
export function requireCan(user: Principal | null | undefined, action: Action, scope: Scope = {}): void {
  if (!can(user, action, scope)) throw new AuthorizationError();
}
