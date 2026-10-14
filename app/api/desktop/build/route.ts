import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * This server's own build, for the desktop app's local copy (docs/31 §1, §3): a gzipped tar of the app as it runs
 * here (its source, its .next) without node_modules, Next's cache or the data root. The local copy must run the
 * identical build, or the server actions it forwards would not match. Admins only: the build carries its server
 * actions' encryption key. One at a time.
 */
export const GET = withRoute('app/api/desktop/build/route.ts#GET', async () => {
  const { buildResponse } = await import('@/lib/desktop/build');
  return buildResponse();
});
