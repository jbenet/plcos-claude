import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LinearTransport } from './client';
import { QUERIES } from './queries';

/**
 * A fake Linear for the demo and the properties: invented records from fixtures/linear/, answered
 * through the same client and the same allowlist, with cursor pages and rate-limit headers. It
 * answers queries only; anything else is a 400, as a real server would refuse an unknown operation.
 */
export type Workspace = Record<string, Array<Record<string, unknown>>>;

export function loadWorkspace(dir = join(process.cwd(), 'fixtures', 'linear')): Workspace {
  return JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')) as Workspace;
}

export interface FixtureOptions {
  workspace?: Workspace;
  /** Answer the first N requests with a 429 (to exercise backoff). */
  limitFirst?: number;
  requestsLeft?: number;
  /** Seen bodies, for properties that inspect what left the client. */
  sent?: string[];
  now?: () => number;
}

export function fixtureTransport(opts: FixtureOptions = {}): LinearTransport {
  const ws = opts.workspace ?? loadWorkspace();
  let n = 0;
  const now = opts.now ?? (() => Date.now());
  const headers = () => new Headers({
    'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-remaining': String(opts.requestsLeft ?? 2400),
    'x-ratelimit-requests-reset': String(now() + 3_000), 'x-ratelimit-complexity-limit': '3000000',
    'x-ratelimit-complexity-remaining': '2990000', 'x-ratelimit-complexity-reset': String(now() + 3_000),
  });
  const answer = (status: number, body: unknown) => ({ status, headers: headers(), text: async () => JSON.stringify(body) });
  return {
    kind: 'fixture',
    async post(body) {
      opts.sent?.push(body);
      n++;
      if (opts.limitFirst && n <= opts.limitFirst) return answer(429, { errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] });
      const { operationName, variables } = JSON.parse(body) as { operationName: string; variables: { first?: number; after?: string | null; filter?: { updatedAt?: { gt?: string } } | null } };
      const q = Object.hasOwn(QUERIES, operationName) ? QUERIES[operationName] : undefined;
      if (!q) return answer(400, { errors: [{ message: 'Unknown operation' }] });
      if (!q.root) return answer(200, { data: { viewer: { id: 'demo-viewer' }, teams: { nodes: (ws.teams ?? []).map((t) => ({ id: t.id })) } } });
      const since = variables.filter?.updatedAt?.gt;
      const all = (ws[q.entity!] ?? []).filter((r) => !since || String(r.updatedAt) > since);
      const start = variables.after ? Number(variables.after) : 0;
      const first = Math.max(1, Math.min(250, variables.first ?? 50));
      const nodes = all.slice(start, start + first);
      const more = start + first < all.length;
      return answer(200, { data: { [q.root]: { nodes, pageInfo: { hasNextPage: more, endCursor: more ? String(start + first) : null } } } });
    },
  };
}
