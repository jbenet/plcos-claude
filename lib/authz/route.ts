import { readFileSync } from 'node:fs';
import type { AppUser } from '@/lib/auth';
import { requireMutationOrigin, requireMutationProfile, MutationGuardError } from '@/lib/mutation-policy';
import { routeRules, type RouteId } from './route-rules';
import { AuthorizationError, requireCan } from './index';

/** One boundary per handler. Feedback deliberately journals without a roster/DB lookup. */
export function withRoute(name: RouteId, handler: (request: Request, context: any, user: AppUser) => Promise<Response> | Response) {
  // MCP authenticates by its own bearer token (lib/mcp/server.ts) and authorizes per tool call; the
  // envelope rides in the context. No cookie, so no origin rule: a cross-site Origin is refused there.
  if (routeRules[name] === 'mcp') {
    return async (request: Request): Promise<Response> => {
      const { mcpGuard } = await import('@/lib/mcp/server');
      const guard = await mcpGuard(request);
      if ('response' in guard) return guard.response;
      return handler(request, guard, guard.env.principal);
    };
  }
  // The outreach API (docs/27) authenticates by the same bearer token and authorizes per operation, in
  // lib/outreach/http.ts. No cookie is read, so no cookie origin rule: CORS is checked there.
  if (routeRules[name] === 'outreach') {
    return async (request: Request, context?: any): Promise<Response> => handler(request, context, undefined as never);
  }
  // Cloud sync (docs/deploy/railway.md §6–§7): the same bearer token, carrying the endpoint's scope
  // (lib/sync/scopes.ts), checked with its owner's current access before the handler runs. No cookie; any
  // browser Origin is refused there.
  const sync = routeRules[name];
  if (sync === 'sync:snapshot' || sync === 'sync:push' || sync === 'sync:admin') {
    return async (request: Request): Promise<Response> => {
      const { syncGuard } = await import('@/lib/sync/auth');
      const guard = await syncGuard(request, sync === 'sync:snapshot' ? 'snapshot' : sync === 'sync:admin' ? (name.startsWith('app/api/sync/jobs/') ? 'jobs' : name.startsWith('app/api/sync/feedback/') ? 'feedback' : name.startsWith('app/api/sync/entity-type/') ? 'identity' : name.startsWith('app/api/sync/astra/') ? 'astra' : 'vehicles') : 'push');
      if ('response' in guard) return guard.response;
      return handler(request, guard, guard.caller.user);
    };
  }
  return async (request: Request, context?: any): Promise<Response> => {
    try {
      const policy = routeRules[name];
      if (!policy) throw new AuthorizationError();
      try {
        if (policy === 'mcp' || policy === 'outreach' || policy === 'sync:snapshot' || policy === 'sync:push' || policy === 'sync:admin') throw new AuthorizationError();
        if (policy === 'feedback' || policy === 'session' || policy === 'public') {
          // Session selection bootstraps identity; its handler validates the selected active user.
          // Feedback reporter identity is resolved only by the post-response ingester.
          // Public handlers (Google sign-in, /setup) run before anyone is signed in and check for themselves.
          // Every POST here must come from this server's own page: a cross-site POST is refused.
          if (name.endsWith('#POST')) { requireMutationOrigin(request); requireMutationProfile(); }
          return await handler(request, context, undefined as never);
        }
        if (/\#(?:POST|PUT|PATCH|DELETE)$/.test(name)) {
          const { mutationRouteGuard } = await import('@/lib/mutation-guard');
          const guard = await mutationRouteGuard(request);
          if ('response' in guard) return guard.response;
          requireCan(guard.user, policy);
          return await handler(request, context, guard.user);
        }
        const { currentUser } = await import('@/lib/auth');
        const user = await currentUser();
        requireCan(user, policy);
        return await handler(request, context, user);
      } catch (error) {
        if (error instanceof MutationGuardError) return Response.json({ error: error.message }, { status: error.status });
        throw error;
      }
    } catch (error) {
      if (error instanceof AuthorizationError) return Response.json({ error: error.message }, { status: 403 });
      throw error;
    }
  };
}
let imageCommit: string | null | undefined;
/** The commit a deployed image was built from (.image-commit, written by the Dockerfile), or null elsewhere. */
function builtFrom(): string | null {
  if (imageCommit !== undefined) return imageCommit;
  try {
    const text = readFileSync(`${process.cwd()}/.image-commit`, 'utf8').trim();
    imageCommit = /^[0-9a-f]{7,40}$/.test(text) ? text.slice(0, 12) : null;
  } catch { imageCommit = null; }
  return imageCommit;
}
/**
 * Fixed, DB-free liveness, with no application data. On a deployed image it also names the commit it was built
 * from, so `scripts/ship.sh --deploy` can tell when Railway is serving what it pushed (5 Oct 2026). While import
 * workers this server started are running it counts them (`importing`), so a deploy can wait rather than restart
 * the server under them (7 Oct 2026). A count only, read from lib/import-jobs/server.ts's handle set.
 */
export function healthRoute(): Response;
export function healthRoute(request: Request): Response | Promise<Response>;
export function healthRoute(request?: Request): Response | Promise<Response> {
  // ?affinity=1: the Affinity requests this server sent per day and endpoint, the last 14 days. Counts and
  // endpoint templates only, to watch the key's daily budget (Juan, 8 Oct 2026: under 300 a day). The plain
  // check stays synchronous and never touches the database.
  if (request && new URL(request.url).searchParams.get('affinity') === '1') return affinityUsage();
  const commit = builtFrom();
  const importing = (globalThis as { __importChildren?: Set<string> }).__importChildren?.size ?? 0;
  return Response.json({ ok: true, ...(commit ? { commit } : {}), ...(importing ? { importing } : {}) });
}

async function affinityUsage(): Promise<Response> {
  try {
    const { dailyRequests } = await import('@/modules/sources');
    const rows = await dailyRequests('affinity', 14);
    const days = new Map<string, { day: string; total: number; byEndpoint: Record<string, number> }>();
    for (const r of rows) {
      const d = days.get(r.day) ?? { day: r.day, total: 0, byEndpoint: {} };
      d.total += r.n;
      d.byEndpoint[r.endpoint] = r.n;
      days.set(r.day, d);
    }
    return Response.json({ affinity: [...days.values()] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Affinity usage is unavailable.' }, { status: 503 });
  }
}
