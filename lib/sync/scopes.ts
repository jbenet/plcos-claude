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
 * so Admins only; a push hands the server finished research to import, so a GP or an Admin.
 */
export const SYNC_SNAPSHOT = 'sync:snapshot';
export const SYNC_PUSH = 'sync:push';
export const SYNC_SCOPES = [SYNC_SNAPSHOT, SYNC_PUSH] as const;
export type SyncScopeName = (typeof SYNC_SCOPES)[number];

export interface Endpoint { name: string; route: string; policy: Policy; grant: readonly ('admin' | 'gp' | 'viewer')[] }
export const SYNC_ENDPOINTS: Record<'snapshot' | 'push', Endpoint> = {
  snapshot: { name: 'sync_snapshot', route: 'GET /api/sync/snapshot', grant: ['admin'],
    policy: { risk: 'read', scopes: [SYNC_SNAPSHOT], ticket: 'none', approval: false } },
  // It writes research files the normal import then maps, through the importer's own validators: guarded writes.
  push: { name: 'sync_push', route: 'POST /api/sync/push', grant: ['admin', 'gp'],
    policy: { risk: 'write-guarded', scopes: [SYNC_PUSH], ticket: 'none', approval: false } },
};

/** Why `owner` may not hold these token entries, or null. Only the sync scopes carry a grant rule here. */
export function grantRefusal(owner: { access: string }, tools: readonly string[]): string | null {
  for (const e of Object.values(SYNC_ENDPOINTS)) {
    if (e.policy.scopes.some((s) => tools.includes(s)) && !(e.grant as readonly string[]).includes(owner.access)) {
      return e.grant.length === 1 ? `Only an Admin can make a ${e.policy.scopes[0]} token.` : `Only a GP or an Admin can make a ${e.policy.scopes[0]} token.`;
    }
  }
  return null;
}
