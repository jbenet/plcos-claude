import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * The desktop app's sync down (docs/31 §3, lib/desktop/sync.ts): `op=state`, `op=rows` and `op=keys`. Admins only,
 * as the whole-database snapshot is, refused where it is refused, and audited (lib/desktop/guard.ts). The copy holds
 * every table but people's own secrets, whose ciphertext and token hashes stay here (lib/desktop/sync.ts). Read-only.
 */
export const GET = withRoute('app/api/desktop/sync/route.ts#GET', async (request, _context, user) => {
  const { auditDesktop, desktopRefusal } = await import('@/lib/desktop/guard');
  const refused = await desktopRefusal(user, 'sync');
  if (refused) return refused;
  const { syncDigest, syncKeys, syncRows, syncState } = await import('@/lib/desktop/sync');
  const p = new URL(request.url).searchParams;
  const headers = { 'cache-control': 'no-store', 'content-type': 'application/json' };
  const cursor = (name = 'after'): string[] | null => {
    const raw = p.get(name);
    if (!raw) return null;
    try { const a = JSON.parse(raw) as unknown; return Array.isArray(a) && a.every((x) => typeof x === 'string') ? a as string[] : null; } catch { return null; }
  };
  // Next does not compress route handlers. Rows are JSON, about a tenth the size gzipped, and the app is often on a
  // home connection: gzip anything big, at a fast level (about 8 ms per 2 MB).
  const gzip = /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '');
  const send = async (body: string, status = 200): Promise<Response> => {
    if (!gzip || body.length < 2048) return new Response(body, { status, headers });
    const { gzip: deflate } = await import('node:zlib');
    const { promisify } = await import('node:util');
    const zipped = await promisify(deflate)(body, { level: 1 });
    return new Response(new Uint8Array(zipped), { status, headers: { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' } });
  };
  const op = p.get('op');
  if (op === 'state') {
    const { builtFrom } = await import('@/lib/authz/route');
    const s = await syncState();
    await auditDesktop(user, 'sync', { outcome: 'ok', tables: s.tables.length });
    return send(JSON.stringify({ ok: true, commit: builtFrom() ?? process.env.GIT_COMMIT?.slice(0, 12) ?? null, ...s }));
  }
  if (op === 'rows') {
    const r = await syncRows(p.get('t') ?? '', p.get('since'), cursor(), Number(p.get('limit') ?? 2000), cursor('upto'));
    if (!r.ok) return new Response(JSON.stringify(r), { status: 404, headers });
    // The rows are spliced in as the database wrote them, never parsed and re-encoded here.
    return send(`{"ok":true,"horizon":${JSON.stringify(r.horizon)},"n":${r.n},"next":${JSON.stringify(r.next)},"count":${JSON.stringify(r.count)},"rows":${r.rowsJson}}`);
  }
  if (op === 'keys') {
    const r = await syncKeys(p.get('t') ?? '', cursor(), Number(p.get('limit') ?? 20000));
    return send(JSON.stringify(r), r.ok ? 200 : 404);
  }
  if (op === 'digest') {
    const r = await syncDigest(p.get('t') ?? '', Number(p.get('chunk') ?? 5000));
    return send(JSON.stringify(r), r.ok ? 200 : 404);
  }
  return new Response(JSON.stringify({ ok: false, error: 'op must be state, rows, keys or digest.' }), { status: 400, headers });
});
