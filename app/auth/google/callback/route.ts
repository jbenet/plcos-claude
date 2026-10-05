import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * Sign in with Google, step two: the state against its cookie, the code exchanged, and only a verified
 * Workspace address on the roster admitted (lib/auth/google-signin.ts). Every refusal is audit-logged.
 */
export const GET = withRoute('app/auth/google/callback/route.ts#GET', async (request) => {
  const { finishSignIn } = await import('@/lib/auth/google-signin');
  return finishSignIn(request);
});
