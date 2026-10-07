import type { Policy } from '@/lib/mcp/tools';

/**
 * The cloud sync scopes (docs/deploy/railway.md §6–§7), in the same model as the outreach scopes
 * (lib/outreach/scopes.ts): they ride in an MCP token's `tools`, and each endpoint declares a policy the
 * way an MCP tool does (lib/mcp/tools.ts), checked by the same `allowed`. A sync token carries its scope
 * and nothing else, so it lists no MCP tool and opens no outreach op; an MCP or outreach token carries
 * no sync scope, so it opens neither endpoint.
 *
 * Who may hold each scope is data too, checked when a token is made (modules/platform/mcp-tokens.ts) and
 * again on every use against the owner's access then (lib/sync/auth.ts): a snapshot is the whole database,
 * so Admins only; a push hands the server finished research to import, so a Team member or an Admin.
 */
export const SYNC_SNAPSHOT = 'sync:snapshot';
export const SYNC_PUSH = 'sync:push';
/**
 * The broad Admin scope (Juan, 7 Oct 2026: "something w/ very broad perms", after "i really want you to be able to
 * do this. i dont want to do this stuff myself"). Admins only. It opens every endpoint here (pull, push, the
 * cloud ledger) and every Admin-by-token endpoint, such as adding a vehicle; a new Admin endpoint takes this scope
 * rather than a scope of its own. It is not the MCP tools or the outreach desk, and no endpoint under it sends,
 * decides a ticket or moves money: those stay with a person (AGENTS.md, Agent rules; invariant 3).
 */
export const SYNC_ADMIN = 'sync:admin';
export const SYNC_SCOPES = [SYNC_SNAPSHOT, SYNC_PUSH, SYNC_ADMIN] as const;
export type SyncScopeName = (typeof SYNC_SCOPES)[number];

export interface Endpoint { name: string; route: string; policy: Policy; grant: readonly ('admin' | 'team' | 'viewer')[] }
export const SYNC_ENDPOINTS: Record<'snapshot' | 'push' | 'vehicles' | 'jobs', Endpoint> = {
  snapshot: { name: 'sync_snapshot', route: 'GET /api/sync/snapshot', grant: ['admin'],
    policy: { risk: 'read', scopes: [SYNC_SNAPSHOT], ticket: 'none', approval: false } },
  // It writes research files the normal import then maps, through the importer's own validators: guarded writes.
  push: { name: 'sync_push', route: 'POST /api/sync/push', grant: ['admin', 'team'],
    policy: { risk: 'write-guarded', scopes: [SYNC_PUSH], ticket: 'none', approval: false } },
  // Adds a vehicle through the same createVehicle the Settings → Vehicles form calls, so its checks hold: Admin only.
  vehicles: { name: 'vehicle_create', route: 'POST /api/sync/vehicles', grant: ['admin'],
    policy: { risk: 'write-guarded', scopes: [SYNC_ADMIN], ticket: 'none', approval: false } },
  // Queues the jobs Developer → Enrichment's buttons queue (research export, findings import), as the token's owner.
  jobs: { name: 'import_job', route: 'POST|GET /api/sync/jobs', grant: ['admin'],
    policy: { risk: 'write-guarded', scopes: [SYNC_ADMIN], ticket: 'none', approval: false } },
};

/** The scopes a token's entries carry: the Admin scope carries every sync scope. */
export function heldScopes(tools: readonly string[]): Set<string> {
  return new Set(tools.includes(SYNC_ADMIN) ? [...tools, ...SYNC_SCOPES] : tools);
}

/** Why `owner` may not hold these token entries, or null. Only the sync scopes carry a grant rule here. */
export function grantRefusal(owner: { access: string }, tools: readonly string[]): string | null {
  if (tools.includes(SYNC_ADMIN) && owner.access !== 'admin') return `Only an Admin can make a ${SYNC_ADMIN} token.`;
  for (const e of Object.values(SYNC_ENDPOINTS)) {
    if (e.policy.scopes.some((s) => tools.includes(s)) && !(e.grant as readonly string[]).includes(owner.access)) {
      return e.grant.length === 1 ? `Only an Admin can make a ${e.policy.scopes[0]} token.` : `Only a Team member or an Admin can make a ${e.policy.scopes[0]} token.`;
    }
  }
  return null;
}
