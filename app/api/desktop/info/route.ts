import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * What the desktop app needs to know about this server and who it is signed in as (docs/31): the build it runs, how
 * it names its cookies, and the person. The app reads it after pairing and whenever the server may have deployed.
 */
export const GET = withRoute('app/api/desktop/info/route.ts#GET', async (request, _context, user) => {
  const { builtFrom } = await import('@/lib/authz/route');
  const { config } = await import('@/config/deployment');
  const { publicUrl } = await import('@/lib/settings/setup');
  const base = publicUrl(request.headers);
  return Response.json({
    ok: true,
    commit: builtFrom() ?? process.env.GIT_COMMIT?.slice(0, 12) ?? null,
    provider: config.auth.provider,
    profile: config.data.profile,
    copy: config.data.copyTakenAt,
    cookiePrefix: config.data.cookiePrefix,
    secure: base.startsWith('https://'),
    user: { id: user.id, handle: user.handle, name: user.name, access: user.access },
  }, { headers: { 'cache-control': 'no-store' } });
  // The person and the build, no vehicle's records: anyone who may read one of their vehicles.
}, (_request, user) => ({ vehicle: user?.vehicles ?? null }));
