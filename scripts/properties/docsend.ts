/**
 * DocSend, read only, through its MCP server (docs/32-docsend.md), on invented data only:
 *   - no tool outside the read allowlist leaves the client, whatever name is asked for;
 *   - the access token appears in nothing the client throws;
 *   - JSON and server-sent-event answers both parse;
 *   - the sign-in never fetches a host that is not DocSend's or Dropbox's, finds metadata by challenge too, and says why it failed;
 *   - the first read takes every page, a second read stops at the last complete one and adds nothing;
 *   - viewers match an LP by email, our team's visits are marked and never returned, an unknown viewer stays null;
 *   - a visit's vehicle follows its data room's mapping, and visitsFor returns time per page and an as-of time.
 */
import { withDb } from '../../lib/db';
import { migrate } from '../../lib/db/migrate';
import { signInReturnsToLoopback, startConnect } from '../../lib/connectors/docsend/connection';
import { finishDocsendFromPaste } from '../../lib/connectors/docsend/signin';
import { docsendClient, NotSignedIn, parseAnswer, type McpTransport } from '../../lib/connectors/docsend/mcp';
import { allowedUrl, discover, DocsendSignInError, readScopes, register, type OAuthTransport } from '../../lib/connectors/docsend/oauth';
import { normalizeVisit, syncDocsend, visitKey } from '../../lib/connectors/docsend/sync';
import { DocsendRefused, READ_TOOLS } from '../../lib/connectors/docsend/tools';
import { setSpaceVehicle, visitsFor } from '../../modules/docsend';
import { openTestDb } from './database';
import type { Check } from './harness';

const TOKEN = 'INVENTED-docsend-access-token-0123456789';
const WRITE_TOOLS = ['create_space', 'create_space_folder', 'create_space_group', 'create_space_link', 'update_space', 'update_space_group',
  'update_space_link', 'set_space_permission_visibility', 'rename_space_content', 'move_space_content', 'request_space_upload',
  'upload_file_to_space', 'read_document', 'list_space_events', 'tools/list'];

const ROOM = 7001;
/** Five invented visits, newest first, two to a page. */
const VISITS = [
  { at: '2026-10-13T12:00:00Z', email: 'ada@lp-one.example', ms: 61_000, pages: [[1, 30], [2, 25], [3, 6], [4, 0]] },
  { at: '2026-10-12T12:00:00Z', email: 'someone@team.example', ms: 5_000, pages: [[1, 5]] },
  { at: '2026-10-10T12:00:00Z', email: 'Ada@LP-one.example', ms: 120_000, pages: [[1, 40], [2, 40], [3, 30], [4, 10]] },
  { at: '2026-10-01T12:00:00Z', email: 'stranger@unknown.example', ms: 9_000, pages: [[1, 9]] },
  { at: '2026-09-20T12:00:00Z', email: 'ada@lp-one.example', ms: 30_000, pages: [[1, 30]] },
].map((v) => ({
  visit_created_at: v.at, time_spent_viewing_ms: v.ms, link_name: 'Invented link', document_name: 'Invented memo', document_id: 9001,
  contact_email: v.email, contact_name: null, space_id: ROOM, space_name: 'Invented data room',
  page_views: v.pages.map(([p, s]) => ({ page_number: String(p), time_on_page: s })),
  percentage_viewed: Math.round(100 * v.pages.filter(([, s]) => s! > 0).length / 4), unique_pages_viewed: v.pages.filter(([, s]) => s! > 0).length, total_pages_count: 4,
}));

/** An invented DocSend MCP server: answers initialize, the notification, and the two read tools, paged. */
function scripted(opts: { status?: number; sse?: boolean } = {}) {
  const calls: Array<{ method: string; tool?: string; args?: Record<string, unknown>; auth: string }> = [];
  const transport: McpTransport = {
    kind: 'scripted',
    async post(body, headers) {
      const m = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      calls.push({ method: m.method, tool: m.params?.name, args: m.params?.arguments, auth: headers.authorization ?? '' });
      const reply = (result: unknown, status = opts.status ?? 200) => {
        const json = JSON.stringify({ jsonrpc: '2.0', id: m.id, result });
        const sse = opts.sse && m.method === 'tools/call';
        return { status, headers: new Headers({ 'content-type': sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'invented-session' }),
          text: async () => (sse ? `event: message\ndata: ${json}\n\n` : json) };
      };
      if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'invented' } });
      if (m.method === 'notifications/initialized') return { status: 202, headers: new Headers(), text: async () => '' };
      if (m.params?.name === 'list_spaces') return reply({ structuredContent: { pageInfo: { hasNextPage: false, cursor: null }, spaces: [{ id: ROOM, name: 'Invented data room' }] } });
      if (m.params?.name === 'list_visits') {
        const at = Number(m.params.arguments?.cursor ?? 0), size = 2;
        const page = VISITS.slice(at, at + size);
        const more = at + size < VISITS.length;
        return reply({ content: [{ type: 'text', text: JSON.stringify({ pageInfo: { hasNextPage: more, cursor: more ? String(at + size) : null }, visits: page }) }] });
      }
      return reply({ isError: true, content: [{ type: 'text', text: 'unknown tool' }] });
    },
  };
  return { transport, calls };
}

export async function docsendProperties(check: Check) {
  {
    const some = readScopes(['openid', 'offline_access', 'spaces:read', 'spaces:write', 'visits.read', 'content_manage']);
    const none = readScopes(['all']);
    check('DocSend: sign-in asks only for read scopes (and the sign-in ones) when the server lists them apart; else all',
      some.join(' ') === 'openid offline_access spaces:read visits.read' && none.join(' ') === 'all', `${some.join(' ')} | ${none.join(' ')}`);
  }
  // ── Read only ──────────────────────────────────────────────────────────────────────────────────────
  {
    const s = scripted();
    const client = docsendClient({ transport: s.transport, token: TOKEN, minIntervalMs: 0 });
    let refused = 0;
    for (const name of WRITE_TOOLS) {
      try { await client.call(name as 'list_spaces', {}); } catch (e) { if (e instanceof DocsendRefused) refused++; }
    }
    check('DOCSEND every tool outside the read allowlist is refused before anything is sent',
      refused === WRITE_TOOLS.length && s.calls.length === 0 && READ_TOOLS.join() === 'list_spaces,list_visits',
      `${refused} of ${WRITE_TOOLS.length} refused; ${s.calls.length} requests sent.`);
  }

  // ── The token stays out of errors; both answer shapes parse ─────────────────────────────────────────
  {
    const s = scripted({ status: 401 });
    let message = '', signedOut = false;
    try { await docsendClient({ transport: s.transport, token: TOKEN, minIntervalMs: 0 }).call('list_spaces', {}); }
    catch (e) { message = `${(e as Error).message} ${(e as Error).stack ?? ''}`; signedOut = e instanceof NotSignedIn; }
    check('DOCSEND a refused sign-in is NotSignedIn and never carries the token', signedOut && !message.includes(TOKEN), message.slice(0, 120));

    const sse = scripted({ sse: true });
    const data = await docsendClient({ transport: sse.transport, token: TOKEN, minIntervalMs: 0 }).call('list_spaces', {}) as { spaces: unknown[] };
    const parsed = parseAnswer('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":true}}\n\n', 'text/event-stream', 3);
    check('DOCSEND JSON and event-stream answers both parse; the token goes as a bearer header',
      data.spaces.length === 1 && (parsed?.result as { ok?: boolean })?.ok === true && sse.calls[0]!.auth === `Bearer ${TOKEN}`,
      `${sse.calls.length} requests.`);
  }

  // ── The sign-in reaches DocSend's hosts only ────────────────────────────────────────────────────────
  {
    const fetched: string[] = [];
    const evil: OAuthTransport = async (url) => {
      fetched.push(new URL(url).hostname);
      const body = url.includes('protected-resource') ? { resource: 'https://docsend.com/mcp', authorization_servers: ['https://auth.invalid.example'] } : {};
      return { status: 200, text: async () => JSON.stringify(body) };
    };
    let refused = false;
    try { await discover(evil); } catch (e) { refused = e instanceof DocsendSignInError; }
    let plain = false;
    try { allowedUrl('http://docsend.com/oauth/token'); } catch { plain = true; }
    check('DOCSEND sign-in metadata pointing at another host is refused, and plain http too',
      refused && plain && fetched.every((h) => h === 'docsend.com'), `fetched ${[...new Set(fetched)].join(', ')}`);
  }

  // ── The sign-in finds its metadata the ways servers publish it, and says why when it cannot ─────────────
  {
    const asMeta = { authorization_endpoint: 'https://docsend.com/oauth/authorize', token_endpoint: 'https://docsend.com/oauth/token', registration_endpoint: 'https://docsend.com/oauth/register' };
    const viaChallenge: OAuthTransport = async (url, init) => {
      const u = new URL(url);
      if (init.method === 'POST' && u.pathname === '/mcp') {
        return { status: 401, text: async () => '', headers: new Headers({ 'www-authenticate': 'Bearer resource_metadata="https://docsend.com/meta/prm"' }) };
      }
      if (u.pathname === '/meta/prm') return { status: 200, text: async () => JSON.stringify({ resource: 'https://docsend.com/mcp', authorization_servers: ['https://docsend.com'] }) };
      if (u.pathname === '/.well-known/oauth-authorization-server') return { status: 200, text: async () => JSON.stringify(asMeta) };
      return { status: 404, text: async () => '' };
    };
    const meta = await discover(viaChallenge).catch(() => null);
    const nothing: OAuthTransport = async () => ({ status: 404, text: async () => '' });
    let said = '';
    try { await discover(nothing); } catch (e) { said = e instanceof Error ? e.message : ''; }

    const realFetch = globalThis.fetch;
    const hops: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      hops.push(url);
      if (url === 'https://docsend.com/a') return new Response(null, { status: 301, headers: { location: 'https://www.docsend.com/a' } });
      if (url === 'https://www.docsend.com/a') return new Response('{"ok":1}', { status: 200 });
      if (url === 'https://docsend.com/away') return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/a' } });
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as typeof fetch;
    let followed = false, away = false, down = '';
    try {
      const { httpsOAuth } = await import('../../lib/connectors/docsend/oauth');
      followed = (await httpsOAuth('https://docsend.com/a', { method: 'GET', headers: {} })).status === 200;
      try { await httpsOAuth('https://docsend.com/away', { method: 'GET', headers: {} }); } catch (e) { away = e instanceof DocsendSignInError; }
      try { await httpsOAuth('https://docsend.com/down', { method: 'GET', headers: {} }); } catch (e) { down = e instanceof DocsendSignInError ? e.message : ''; }
    } finally { globalThis.fetch = realFetch; }
    check('DOCSEND sign-in reads the metadata address from the 401 challenge, follows redirects on DocSend hosts only, and names why it failed',
      meta?.registrationEndpoint === asMeta.registration_endpoint && /404/.test(said) && followed && away && /ENOTFOUND/.test(down)
        && !hops.some((h) => h.includes('elsewhere')),
      `meta ${meta ? 'found' : 'missing'}; "${said}"; "${down}"`);

    const bodies: Array<Record<string, unknown>> = [];
    const picky = (acceptMinimal: boolean): OAuthTransport => async (_url, init) => {
      const b = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      bodies.push(b);
      if (b.grant_types || !acceptMinimal) return { status: 400, text: async () => JSON.stringify({ error: 'invalid_client_metadata', error_description: 'grant_types not allowed' }) };
      return { status: 201, text: async () => JSON.stringify({ client_id: 'invented-client' }) };
    };
    const regMeta = { ...meta!, scopes: [] };
    const retried = await register(picky(true), regMeta, 'https://app.example/cb').catch(() => null);
    let refusedWhy = '';
    try { await register(picky(false), regMeta, 'https://app.example/cb'); } catch (e) { refusedWhy = e instanceof Error ? e.message : ''; }
    check('DOCSEND a refused registration is tried once with only the required fields, and the refusal says why',
      retried === 'invented-client' && bodies.length === 4 && /invalid_client_metadata: grant_types not allowed/.test(refusedWhy),
      `${bodies.length} registrations; "${refusedWhy}"`);
  }

  // ── The sync ────────────────────────────────────────────────────────────────────────────────────────
  const db = await openTestDb();
  try {
    await migrate(db);
    const user = await db.one<{ id: string }>(`insert into platform.app_user (handle, name, initials, role, email) values ('invented-admin', 'Invented Admin', 'IA', 'admin', 'someone@team.example') returning id::text`);
    const vehicle = await db.one<{ id: string }>(`insert into platform.vehicle (slug, name, kind, exemption) values ('invented-fund', 'Invented Fund', 'fund', '506(c)') returning id::text`);
    const lp = await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name) values ('person', 'Invented LP') returning entity_id::text id`);
    await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body) values ('invented-doc', 'Invented', 'note', 'invented', '2026-10-01', 'strong', 'email', '')`);
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'person.email', 'ada@lp-one.example', 'invented-doc', '2026-10-01', 'high')`, [lp!.id]);

    const first = scripted();
    const r1 = await syncDocsend(db, { client: docsendClient({ transport: first.transport, token: TOKEN, minIntervalMs: 0 }), now: new Date('2026-10-14T00:00:00Z') });
    const visitCalls1 = first.calls.filter((c) => c.tool === 'list_visits').length;
    check('DOCSEND the first read takes every page of every data room',
      r1.connected && r1.spaces === 1 && r1.visitsRead === 5 && r1.newVisits === 5 && visitCalls1 === 3 && r1.incomplete === 0,
      `${r1.visitsRead} read, ${r1.newVisits} new, ${visitCalls1} pages.`);

    const second = scripted();
    const r2 = await syncDocsend(db, { client: docsendClient({ transport: second.transport, token: TOKEN, minIntervalMs: 0 }), now: new Date('2026-10-15T00:00:00Z') });
    const visitCalls2 = second.calls.filter((c) => c.tool === 'list_visits').length;
    check('DOCSEND a second read stops at the last complete one and adds nothing',
      r2.newVisits === 0 && visitCalls2 === 1 && r2.requests < r1.requests, `${visitCalls2} page(s), ${r2.newVisits} new.`);

    const rows = await db.query<{ viewer_email: string; entity_id: string | null; internal: boolean; vehicle_id: string | null }>('select viewer_email, entity_id::text, internal, vehicle_id::text from docsend.visit');
    const ada = rows.filter((x) => x.viewer_email === 'ada@lp-one.example');
    check('DOCSEND viewers match an LP by email, ours are marked, an unknown one stays null',
      ada.length === 3 && ada.every((x) => x.entity_id === lp!.id && !x.internal)
        && rows.find((x) => x.viewer_email === 'someone@team.example')?.internal === true
        && rows.find((x) => x.viewer_email === 'stranger@unknown.example')?.entity_id === null,
      `${rows.length} visits; ${ada.length} by the invented LP.`);

    const before = await visitsFor(vehicle!.id, db);
    await setSpaceVehicle(ROOM, vehicle!.id, user!.id, db);
    const after = await visitsFor(vehicle!.id, db);
    const top = after.visits[0];
    check('DOCSEND a data room\'s vehicle maps its visits; visitsFor leaves our team out and keeps time per page',
      before.visits.length === 0 && after.visits.length === 4 && top?.viewerEmail === 'ada@lp-one.example' && top.pageSeconds?.['3'] === 6
        && top.durationSec === 61 && top.pageCount === 4 && after.asOf?.toISOString() === '2026-10-15T00:00:00.000Z' && top.linkId === null,
      `${after.visits.length} visits, as of ${after.asOf?.toISOString()}.`);

    const refused = await syncDocsend(db, { client: docsendClient({ transport: scripted({ status: 401 }).transport, token: TOKEN, minIntervalMs: 0 }) });
    check('DOCSEND a refused sign-in ends the read as failed without failing the job, so the nightly run reaches its backup',
      refused.connected && !!refused.failed && !refused.failed.includes(TOKEN) && refused.newVisits === 0, refused.failed ?? 'no failure');

    const v = normalizeVisit({ ...VISITS[0]!, contact_email: '  ADA@lp-one.example ' });
    check('DOCSEND a visit\'s key ignores the address\'s case and spacing, so a replay is the same row',
      v?.visitId === visitKey(VISITS[0]!) && normalizeVisit({ ...VISITS[0]!, visit_created_at: 'not a date' }) === null, v?.visitId ?? 'none');

    // DocSend refuses our own callback (invalid_redirect_uri, 17 Oct 2026): the loopback address is registered instead,
    // and a pasted address is read only when it is that loopback address.
    const registered: string[] = [];
    const loopbackOnly: OAuthTransport = async (url, init) => {
      const u = new URL(url);
      if (u.pathname === '/.well-known/oauth-protected-resource/mcp') return { status: 200, text: async () => JSON.stringify({ resource: 'https://docsend.com/mcp', authorization_servers: ['https://docsend.com'] }) };
      if (u.pathname === '/.well-known/oauth-authorization-server') {
        return { status: 200, text: async () => JSON.stringify({ authorization_endpoint: 'https://docsend.com/oauth/authorize', token_endpoint: 'https://docsend.com/oauth/token', registration_endpoint: 'https://docsend.com/oauth/register' }) };
      }
      if (u.pathname === '/oauth/register') {
        const uri = (JSON.parse(init.body ?? '{}') as { redirect_uris: string[] }).redirect_uris[0]!;
        registered.push(uri);
        return uri.startsWith('http://localhost') ? { status: 201, text: async () => JSON.stringify({ client_id: 'invented-client' }) }
          : { status: 400, text: async () => JSON.stringify({ error: 'invalid_redirect_uri' }) };
      }
      return { status: 404, text: async () => '' };
    };
    const started = await withDb(db, () => startConnect(user!.id, 'https://app.example', loopbackOnly));
    const remembered = await withDb(db, () => signInReturnsToLoopback(user!.id));
    const authorize = new URL(started.url);
    const appUser = { id: user!.id } as Parameters<typeof finishDocsendFromPaste>[0];
    const wrong = await withDb(db, () => finishDocsendFromPaste(appUser, 'https://app.example', `https://elsewhere.example/callback?code=x&state=${started.state}`, null));
    const noCookie = await withDb(db, () => finishDocsendFromPaste(appUser, 'https://app.example', `http://localhost:8976/callback?code=x&state=${started.state}`, null));
    check('DOCSEND when DocSend refuses our callback, the loopback address is registered and Settings asks for the pasted address; only that address, with its own cookie, is read',
      started.pasteBack && remembered && authorize.searchParams.get('redirect_uri') === 'http://localhost:8976/callback'
        && registered[0] === 'https://app.example/api/connectors/docsend/callback' && wrong.outcome === 'pasted-wrong' && noCookie.outcome === 'expired',
      `registered ${registered.join(', ')}; ${wrong.outcome}, ${noCookie.outcome}`);
  } finally {
    await db.close();
  }
}
