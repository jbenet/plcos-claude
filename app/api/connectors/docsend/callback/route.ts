import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/** Connect DocSend, step two (docs/32-docsend.md §4 E): the state against its cookie, then the code exchanged. Admins only. */
export const GET = withRoute('app/api/connectors/docsend/callback/route.ts#GET', async (request, _context, user) => {
  const { settingsReady } = await import('@/lib/settings/store');
  const { publicUrl } = await import('@/lib/settings/setup');
  const { finishDocsendConnect } = await import('@/lib/connectors/docsend/signin');
  await settingsReady().catch(() => undefined);
  return finishDocsendConnect(user, publicUrl(request.headers), request);
});
