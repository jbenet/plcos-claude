import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/** Sign in with Google, step one: PKCE and a signed state cookie, then Google (lib/auth/google-signin.ts). */
export const GET = withRoute('app/auth/google/route.ts#GET', async (request) => {
  const { startSignIn } = await import('@/lib/auth/google-signin');
  return startSignIn(request);
});
