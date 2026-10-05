import { timingSafeEqual } from 'node:crypto';
import { withRoute } from '@/lib/authz/route';
import { issues } from '@/lib/issues';
import { config } from '@/config/deployment';
import { settingsReady, settingValue } from '@/lib/settings/store';
import { FEEDBACK_EXPORT_SETTING } from './setting';

export const GET = withRoute('app/api/feedback/export/route.ts#GET', async function(req: Request) {
  // FEEDBACK_EXPORT_TOKEN when the environment has it, else the one entered in Settings → Connections.
  // The settings may not be loaded on a server's first request, which could be this one.
  await settingsReady().catch(() => undefined);
  const token = config.data.copyTakenAt ? null : settingValue(FEEDBACK_EXPORT_SETTING.key);
  if (!token) return new Response(null, { status: 404 });
  const expected = Buffer.from(`Bearer ${token}`);
  const supplied = Buffer.from(req.headers.get('authorization') ?? '');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return new Response(null, { status: 401 });
  }
  const since = new URL(req.url).searchParams.get('since') ?? '';
  const timestamp = Date.parse(since);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(since) || !Number.isFinite(timestamp)) {
    return Response.json({ error: 'Give since as an ISO timestamp with a timezone.' }, { status: 400 });
  }
  const items = (await (await issues()).list()).filter(item => Date.parse(item.created) > timestamp);
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
});
