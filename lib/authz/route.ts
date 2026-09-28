import type { AppUser } from '@/lib/auth';
import { requireMutationOrigin, requireMutationProfile, MutationGuardError } from '@/lib/mutation-policy';
import { routeRules, type RouteId } from './route-rules';
import { AuthorizationError, requireCan } from './index';

/** One boundary per handler. Feedback deliberately journals without a roster/DB lookup. */
export function withRoute(name: RouteId, handler: (request: Request, context: any, user: AppUser) => Promise<Response> | Response) {
  return async (request: Request, context?: any): Promise<Response> => {
    try {
      const policy = routeRules[name];
      if (!policy) throw new AuthorizationError();
      try {
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
