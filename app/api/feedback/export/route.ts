import { timingSafeEqual } from 'node:crypto';
import { withRoute } from '@/lib/authz/route';
import { issues } from '@/lib/issues';

export const GET = withRoute('app/api/feedback/export/route.ts#GET', async function(req: Request) {
  const token = process.env.FEEDBACK_EXPORT_TOKEN;
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
