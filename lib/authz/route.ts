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
  return async (request: Request, context?: any): Promise<Response> => {
    try {
      const policy = routeRules[name];
      if (!policy) throw new AuthorizationError();
      try {
        if (policy === 'mcp' || policy === 'outreach') throw new AuthorizationError();
        if (policy === 'feedback' || policy === 'session') {
          // Session selection bootstraps identity; its handler validates the selected active user.
          // Feedback reporter identity is resolved only by the post-response ingester.
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
/** Fixed, DB-free liveness, with no application data. */
export function healthRoute() { return Response.json({ ok: true }); }
