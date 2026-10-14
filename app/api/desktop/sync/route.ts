import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * The desktop app's sync down (docs/31 §3, lib/desktop/sync.ts): `op=state`, `op=rows` and `op=keys`. Admins only,
 * as the whole-database snapshot is: the copy holds every table. Read-only.
 */
export const GET = withRoute('app/api/desktop/sync/route.ts#GET', async (request) => {
  const { syncKeys, syncRows, syncState } = await import('@/lib/desktop/sync');
  const p = new URL(request.url).searchParams;
  const headers = { 'cache-control': 'no-store', 'content-type': 'application/json' };
  const cursor = (): string[] | null => {
    const raw = p.get('after');
    if (!raw) return null;
    try { const a = JSON.parse(raw) as unknown; return Array.isArray(a) && a.every((x) => typeof x === 'string') ? a as string[] : null; } catch { return null; }
  };
  const op = p.get('op');
  if (op === 'state') {
    const { builtFrom } = await import('@/lib/authz/route');
    const s = await syncState();
    return new Response(JSON.stringify({ ok: true, commit: builtFrom(), ...s }), { headers });
  }
  if (op === 'rows') {
    const r = await syncRows(p.get('t') ?? '', p.get('since'), cursor(), Number(p.get('limit') ?? 2000));
    if (!r.ok) return new Response(JSON.stringify(r), { status: 404, headers });
    // The rows are spliced in as the database wrote them, never parsed and re-encoded here.
    return new Response(`{"ok":true,"horizon":${JSON.stringify(r.horizon)},"n":${r.n},"next":${JSON.stringify(r.next)},"count":${JSON.stringify(r.count)},"rows":${r.rowsJson}}`, { headers });
  }
  if (op === 'keys') {
    const r = await syncKeys(p.get('t') ?? '', cursor(), Number(p.get('limit') ?? 20000));
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 404, headers });
  }
  return new Response(JSON.stringify({ ok: false, error: 'op must be state, rows or keys.' }), { status: 400, headers });
});
