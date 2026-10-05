import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/** Sign out of this browser. A POST from this origin only (withRoute refuses a cross-site one). */
export const POST = withRoute('app/auth/signout/route.ts#POST', async (request) => {
  const { signOut } = await import('@/lib/auth/google-signin');
  return signOut(request);
});
