/**
 * The mail desk's second round (docs/27 §4–§4b, 5 Oct 2026), through the real REST and MCP handlers, on invented data:
 *   - route hops and introducers carry their entityId (routes_to, routes_through);
 *   - an address on a hop shows only where the reader reads addresses (R2) on the vehicle; a Viewer gets none, a
 *     user outside the vehicle gets no route at all, and a licensed (Dakota) address reaches no one;
 *   - top_connectors counts only open LPs on a vehicle the caller may read, and only recommended routes;
 *   - REST and MCP route answers are equal;
 *   - passed LPs come back only with includePassed, marked passed;
 *   - paging with nextCursor returns every row exactly once, by REST and by MCP, with an explicit default limit;
 *   - an MCP error carries the REST status in _meta.status;
 *   - the close track carries signedOn, closedOn and outstanding.
 * Two invented vehicles keep the route planning small; they are left historical at the end.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

type Result = { isError?: boolean; content: Array<{ type: string; text: string }>; _meta?: Record<string, unknown> };

export async function outreachDeskProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ } = await import('../../lib/outreach/scopes');
  const { READ_TOOLS } = await import('../../lib/mcp/tools');
  const { config } = await import('../../config/deployment');
  const { POST } = await import('../../app/api/mcp/route');
  resetWindows();
  const rest = await outreachClient();
  const { juan, user, token, entity, pursuit } = await fixtures(db);
  // Every client is closed at the end: an open one may reach the handler later, after the database is gone.
  const clients: Client[] = [];
  const connect = async (secret: string) => {
    const client = new Client({ name: 'props-juanmail-v2', version: '0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3119/api/mcp'), {
      fetch: (u, init) => POST(new Request(u, init)), requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }));
    return client;
  };
  const mcp = async (c: Client, name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as Result;
    const text = r.content.map((x) => x.text).join('\n');
    let data: any = null;
    try { data = JSON.parse(text).data; } catch { /* a refusal is plain text */ }
    return { error: r.isError ? text : null, status: r._meta?.status ?? null, data, text };
  };

  // ── Fixtures: two invented vehicles, a connector with an address, LPs on each ─────────────
  const vehicle = async (slug: string) => (await db.one<{ id: string; slug: string }>(`insert into platform.vehicle (slug, name, kind, exemption, sort_order)
    values ($1, $2, 'fund', '506(c)', 900) on conflict (slug) do update set phase = 'active' returning id::text, slug`, [slug, `Invented ${slug}`]))!;
  const V1 = await vehicle('invented-desk-one'), V2 = await vehicle('invented-desk-two');
  let juanE = (await db.one<{ id: string }>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where source = 'app_user' and source_id = 'juan'`))?.id;
  if (!juanE) {
    juanE = await entity('Invented Desk Juan', 'person');
    await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('app_user', 'juan', $1, 'props')`, [juanE]);
  }
  const connector = await entity('Invented Desk Connector', 'person');
  const shy = await entity('Invented Desk Second Hop', 'person');
  const lp1 = await entity('Invented Desk LP One'), lp2 = await entity('Invented Desk LP Two'), lp3 = await entity('Invented Desk LP Passed');
  const lpRestricted = await entity('Invented Desk LP Restricted');
  const edge = (a: string, b: string, tier = 'B') => db.query(`insert into network.edge (from_entity, to_entity, kind, tier, evidence, valid_from)
    values ($1, $2, 'colleague', $3::network.evidence_tier, '[{"note":"Invented desk tie","source":"https://example.org/invented-desk","as_of":"2026-09-01"}]'::jsonb, '2026-01-01')`, [a, b, tier]);
  await edge(juanE, connector);
  for (const lp of [lp1, lp2, lp3, lpRestricted]) await edge(connector, lp);
  await edge(connector, shy, 'C'); await edge(shy, lp1, 'C');
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body) values
    ('props-desk-research', 'Invented research note', 'fixture', 'public', current_date, 'weak', 'Invented', ''),
    ('props-desk-licensed', 'Invented licensed record', 'fixture', 'dakota', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values
    ($1, 'email', 'connector@invented-desk.example', 'props-desk-research', current_date, 'medium'),
    ($2, 'email', 'licensed-only@invented-desk.example', 'props-desk-licensed', current_date, 'medium')`, [connector, shy]);
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'INVENTED_DESK_R4_REASON', $2)`, [lpRestricted, juan.id]);
  const p1 = await pursuit(lp1, V1.id, 'selected'), p3 = await pursuit(lp3, V1.id, 'passed'), pR = await pursuit(lpRestricted, V1.id, 'selected');
  const p2 = await pursuit(lp2, V2.id, 'selected');
  // More open rows on V1 for paging, and a close track with a signature on one of them.
  const extra: string[] = [];
  for (let i = 0; i < 6; i++) extra.push(await pursuit(await entity(`Invented Desk Paging Org ${i}`), V1.id, i % 2 ? 'discussing' : 'new'));
  const xp = await db.one<{ id: string }>(`insert into pipeline.exposure (entity_id, vehicle_id, owner_id, instrument, track, amount) values ($1, $2, $3, 'lp_commitment', 'soft', 250000)
    returning exposure_id::text id`, [lp1, V1.id, juan.id]);
  await db.query(`insert into pipeline.commitment_event (exposure_id, step, occurred_on, source, recorded_by) values ($1, 'signed', '2026-09-30', 'us', $2)`, [xp!.id, juan.id]);

  const gpOne = await user('desk-gp-one', 'team', [V1.id]);
  const gpTwo = await user('desk-gp-two', 'team', [V2.id]);
  const viewer = await user('desk-viewer', 'viewer', null);
  const tools = [...READ_TOOLS, OUTREACH_READ];
  const [juanTok, oneTok, twoTok, viewerTok] = [await token(juan, tools), await token(gpOne, tools), await token(gpTwo, tools), await token(viewer, tools)];
  const juanMcp = await connect(juanTok), oneMcp = await connect(oneTok);

  try {
    // ── Hop ids ─────────────────────────────────────────────────────────────────────────
    const to = await rest(juanTok, 'routes-to', { entityId: lp1, vehicle: V1.slug });
    type Hop = { entityId: string; name: string; tier: string; doNotApproach: boolean; contact?: { email: string; source: string; confirmedAt: string | null } | null };
    type Route = { from: string; fromEntityId: string | null; hops: Hop[]; introducer: Hop | null; verdict: string };
    const routes = (to.json?.data?.routes ?? []) as Route[];
    const viaConnector = routes.find((r) => r.hops.length === 2 && r.hops[0]!.entityId === connector);
    const through = await rest(juanTok, 'routes-through', { entityId: connector });
    const tData = through.json?.data;
    check('Outreach desk: every route hop and introducer carries its entityId (routes_to, routes_through)',
      to.status === 200 && routes.length > 0 && routes.every((r) => r.hops.every((h) => typeof h.entityId === 'string' && h.entityId.length === 36))
      && viaConnector?.fromEntityId === juanE && viaConnector.hops[1]!.entityId === lp1 && viaConnector.introducer?.entityId === connector
      && through.status === 200 && tData?.nodeId === connector && (tData.bestRouteToNode?.hops ?? []).every((h: Hop) => typeof h.entityId === 'string')
      && tData.bestRouteToNode?.fromEntityId === juanE,
      `${to.status}: ${routes.length} routes; via the connector: from ${viaConnector?.fromEntityId === juanE ? 'Juan' : viaConnector?.fromEntityId}, introducer ${viaConnector?.introducer?.entityId === connector ? 'the connector' : viaConnector?.introducer?.entityId}; through: ${through.status}, node ${tData?.nodeId === connector ? 'ok' : tData?.nodeId}`);

    // ── Address redaction ──────────────────────────────────────────────────────────────
    const viewerTo = await rest(viewerTok, 'routes-to', { entityId: lp1, vehicle: V1.slug });
    const viewerThrough = await rest(viewerTok, 'routes-through', { entityId: connector });
    const outside = await rest(twoTok, 'routes-to', { entityId: lp1, vehicle: V1.slug });
    const outsideMcp = await mcp(await connect(twoTok), 'routes_to', { targetId: lp1, vehicle: V1.slug });
    const connectorHop = viaConnector?.hops[0];
    const shyHop = routes.flatMap((r) => r.hops).find((h) => h.entityId === shy);
    const viewerText = viewerTo.text + viewerThrough.text;
    check('Outreach desk: a hop\'s address shows only where addresses are readable — never to a Viewer or a user outside the vehicle, and a licensed address to no one',
      connectorHop?.contact?.email === 'connector@invented-desk.example' && connectorHop.contact.source === 'research' && to.json.data.addresses === 'shown'
      && (!shyHop || shyHop.contact === null) && !to.text.includes('licensed-only@') && !through.text.includes('licensed-only@')
      && viewerTo.status === 200 && !viewerText.includes('@invented-desk.example') && /withheld/i.test(viewerTo.json?.data?.addresses ?? '')
      && (viewerTo.json?.data?.routes ?? []).every((r: Route) => r.hops.every((h) => !('contact' in h)))
      && outside.status === 404 && !outside.text.includes('@invented-desk') && outsideMcp.status === 404 && !outsideMcp.text.includes('@invented-desk'),
      `Juan: ${connectorHop?.contact?.email ?? 'NO ADDRESS'} (${connectorHop?.contact?.source}); licensed ${/licensed-only@/.test(to.text + through.text) ? 'LEAKED' : 'absent'}; `
      + `viewer: ${viewerTo.status}, addresses ${/@invented-desk/.test(viewerText) ? 'LEAKED' : 'withheld'}; outside the vehicle: ${outside.status}/${outsideMcp.status}`);

    // ── top_connectors: only the LPs the caller reads ─────────────────────────────────
    type Conn = { entityId: string; name: string; lps: number; bestScore: number | null; examplePursuitIds: string[]; doNotApproach: boolean; contact?: unknown };
    const one = await rest(oneTok, 'connectors', { vehicle: V1.slug });
    const two = await rest(oneTok, 'connectors', { vehicle: V2.slug });
    const oneM = await mcp(oneMcp, 'top_connectors', { vehicle: V1.slug });
    const c1 = (one.json?.data?.connectors ?? []).find((c: Conn) => c.entityId === connector) as Conn | undefined;
    const readable = new Set([p1, ...extra]);
    check('Outreach desk: top_connectors counts only open LPs on a vehicle the caller reads, through recommended routes',
      one.status === 200 && one.json.data.complete === true && c1 !== undefined && c1.lps === 1 && c1.examplePursuitIds.join() === p1
      && (one.json.data.connectors as Conn[]).every((c) => c.examplePursuitIds.every((id) => readable.has(id)))
      && !one.text.includes(p2) && !one.text.includes(p3) && !one.text.includes(pR)
      && typeof c1.bestScore === 'number' && one.json.data.lpsOpen === 2 + extra.length
      && two.status === 404 && oneM.status === null && JSON.stringify(oneM.data) === JSON.stringify(one.json.data),
      `${one.status}: the connector reaches ${c1?.lps} LP(s) (${c1?.examplePursuitIds?.join() === p1 ? 'the open one on V1' : c1?.examplePursuitIds?.join()}), best ${c1?.bestScore}; `
      + `another vehicle's ${two.status}; the passed and restricted LPs ${[p2, p3, pR].some((id) => one.text.includes(id)) ? 'COUNTED' : 'not counted'}; MCP equal: ${JSON.stringify(oneM.data) === JSON.stringify(one.json?.data)}`);

    // ── REST and MCP route answers are equal ───────────────────────────────────────────
    const toM = await mcp(juanMcp, 'routes_to', { targetId: lp1, vehicle: V1.slug });
    const throughM = await mcp(juanMcp, 'routes_through', { nodeId: connector });
    check('Outreach desk: REST routes-to and routes-through answer exactly what the MCP tools answer',
      JSON.stringify(toM.data) === JSON.stringify(to.json.data) && JSON.stringify(throughM.data) === JSON.stringify(tData) && to.json.tool === 'routes_to' && through.json.tool === 'routes_through',
      `routes_to equal: ${JSON.stringify(toM.data) === JSON.stringify(to.json.data)}; routes_through equal: ${JSON.stringify(throughM.data) === JSON.stringify(tData)}`);

    // ── includePassed ──────────────────────────────────────────────────────────────────
    type Row = { pursuitId: string; passed: boolean; bucket: string; status: { value: string }; closeTrack: Record<string, unknown> | null };
    const plain = await rest(oneTok, 'queue', { vehicle: V1.slug, limit: '500' });
    const withPassed = await rest(oneTok, 'queue', { vehicle: V1.slug, limit: '500', includePassed: '1' });
    const passedOnly = await rest(oneTok, 'queue', { vehicle: V1.slug, bucket: 'passed' });
    const passedM = await mcp(oneMcp, 'outreach_queue', { vehicle: V1.slug, includePassed: true, pursuitId: p3 });
    const pr = (withPassed.json?.data?.rows ?? []).find((r: Row) => r.pursuitId === p3) as Row | undefined;
    check('Outreach desk: passed LPs come back only with includePassed, each marked passed, by REST and MCP',
      plain.status === 200 && !(plain.json.data.rows as Row[]).some((r) => r.pursuitId === p3 || r.passed) && plain.json.data.counts.passed === undefined
      && pr?.passed === true && pr.bucket === 'passed' && pr.status.value === 'passed' && withPassed.json.data.total === plain.json.data.total + 1
      && (withPassed.json.data.rows as Row[]).filter((r) => r.pursuitId !== p3).every((r) => r.passed === false) && withPassed.json.data.counts.passed === 1
      && passedOnly.status === 400 && passedM.data?.rows?.length === 1 && passedM.data.rows[0].passed === true,
      `default: ${plain.json?.data?.total} rows, passed ${(plain.json?.data?.rows ?? []).some((r: Row) => r.pursuitId === p3) ? 'INCLUDED' : 'left out'}; includePassed: ${withPassed.json?.data?.total}, the passed row ${pr ? `marked ${pr.passed}, bucket ${pr.bucket}` : 'MISSING'}; bucket=passed alone: ${passedOnly.status}; MCP: ${passedM.data?.rows?.[0]?.passed}`);

    // ── Paging: every row exactly once ─────────────────────────────────────────────────
    const all = (plain.json.data.rows as Row[]).map((r) => r.pursuitId);
    const walk = async (page: (cursor: string | null) => Promise<any>) => {
      const seen: string[] = []; let cursor: string | null = null, pages = 0, totals = new Set<number>();
      do {
        const d = await page(cursor);
        seen.push(...(d?.rows ?? []).map((r: Row) => r.pursuitId)); totals.add(d?.total);
        cursor = d?.nextCursor ?? null; pages++;
      } while (cursor && pages < 50);
      return { seen, pages, totals: [...totals] };
    };
    const byRest = await walk(async (c) => (await rest(oneTok, 'queue', { vehicle: V1.slug, limit: '3', ...(c ? { cursor: c } : {}) })).json?.data);
    const byMcp = await walk(async (c) => (await mcp(oneMcp, 'outreach_queue', { vehicle: V1.slug, limit: 3, ...(c ? { cursor: c } : {}) })).data);
    const once = (s: string[]) => s.length === all.length && new Set(s).size === s.length && all.every((id) => s.includes(id));
    const dflt = await rest(oneTok, 'queue', { vehicle: V1.slug });
    const bad = await rest(oneTok, 'queue', { vehicle: V1.slug, cursor: plain.json.data.cursor });
    const other = byRest.pages > 1 ? await rest(oneTok, 'queue', { vehicle: V1.slug, bucket: 'invite', cursor: (await rest(oneTok, 'queue', { vehicle: V1.slug, limit: '3' })).json.data.nextCursor }) : null;
    const both = await rest(oneTok, 'queue', { vehicle: V1.slug, offset: '0', cursor: 'x' });
    const tooMany = await rest(oneTok, 'queue', { vehicle: V1.slug, limit: String(config.outreach.maxQueueRows + 1) });
    check('Outreach desk: paging with nextCursor returns every row exactly once, by REST and MCP; the default limit is explicit; a foreign cursor is refused',
      all.length === 2 + extra.length && once(byRest.seen) && once(byMcp.seen) && byRest.pages === Math.ceil(all.length / 3) && byRest.totals.join() === String(all.length)
      && byMcp.seen.join() === byRest.seen.join() && dflt.json?.data?.limit === config.outreach.defaultQueueRows && config.outreach.defaultQueueRows === 25
      && dflt.json.data.nextCursor === null && bad.status === 400 && other?.status === 400 && both.status === 400 && tooMany.status === 400 && config.outreach.maxQueueRows === 500,
      `${all.length} rows; REST: ${byRest.seen.length} seen over ${byRest.pages} pages (${new Set(byRest.seen).size} distinct); MCP: ${byMcp.seen.length} (same order ${byMcp.seen.join() === byRest.seen.join()}); `
      + `default limit ${dflt.json?.data?.limit}; the polling cursor as a page cursor: ${bad.status}; another query's: ${other?.status}; with offset: ${both.status}; over ${config.outreach.maxQueueRows}: ${tooMany.status}`);

    // Over MCP a page must fit the response limit: the demo's whole queue at limit 500 is cut to fit, and
    // nextCursor carries on from the last row sent, so the pages still cover every row once.
    const wholeRest = (await rest(juanTok, 'queue', { vehicle: 'all', limit: '500' })).json?.data;
    const bigPages: number[] = []; let held = false;
    const wholeMcp = await walk(async (c) => {
      const d = (await mcp(juanMcp, 'outreach_queue', { vehicle: 'all', limit: 500, ...(c ? { cursor: c } : {}) })).data;
      bigPages.push(d?.rows?.length ?? 0); held ||= typeof d?.heldBack === 'string';
      return d;
    });
    const wholeIds = (wholeRest?.rows ?? []).map((r: Row) => r.pursuitId) as string[];
    check('Outreach desk: over MCP a large page is cut to fit the size limit and nextCursor continues from the last row sent — nothing skipped, nothing twice',
      wholeIds.length === wholeRest?.total && wholeMcp.seen.length === wholeIds.length && new Set(wholeMcp.seen).size === wholeIds.length
      && wholeMcp.seen.join() === wholeIds.join() && (wholeMcp.pages === 1 || held),
      `REST: ${wholeIds.length} rows in one answer; MCP: ${wholeMcp.seen.length} rows over ${wholeMcp.pages} page(s) of ${bigPages.join(', ')}${held ? ', held back to fit' : ''}`);

    // ── MCP errors carry the REST status ──────────────────────────────────────────────
    const invalid = await mcp(oneMcp, 'outreach_queue', { vehicle: V1.slug, limit: 0 });
    const notYours = await mcp(oneMcp, 'outreach_queue', { vehicle: V2.slug });
    const noScope = await mcp(await connect(await token(gpOne, [...READ_TOOLS])), 'outreach_queue', { vehicle: V1.slug });
    const badCursor = await mcp(oneMcp, 'outreach_queue', { vehicle: V1.slug, cursor: 'not-a-cursor' });
    const restOf = async (q: Record<string, string>) => (await rest(oneTok, 'queue', q)).status;
    check('Outreach desk: an MCP error result carries the status REST answers for the same refusal, in _meta.status',
      Boolean(invalid.error && notYours.error && noScope.error) && invalid.status === 400 && notYours.status === 404 && notYours.status === await restOf({ vehicle: V2.slug })
      && noScope.status === 403 && badCursor.status === 400 && badCursor.status === await restOf({ vehicle: V1.slug, cursor: 'not-a-cursor' }),
      `invalid: ${invalid.status}; another vehicle: ${notYours.status}; no scope: ${noScope.status}; a bad cursor: ${badCursor.status}`);

    // ── Close-track dates ─────────────────────────────────────────────────────────────
    const ct = ((await rest(oneTok, 'queue', { vehicle: V1.slug, pursuitId: p1 })).json?.data?.rows?.[0] as Row | undefined)?.closeTrack;
    const vct = ((await rest(viewerTok, 'queue', { vehicle: V1.slug, pursuitId: p1 })).json?.data?.rows?.[0] as Row | undefined)?.closeTrack;
    check('Outreach desk: the close track carries signedOn, closedOn and outstanding from the close module; called stays null; outstanding is an amount (R1)',
      ct?.state === 'signed' && ct.signedOn === '2026-09-30' && ct.closedOn === null && ct.outstanding === null && ct.called === null
      && vct?.signedOn === '2026-09-30' && vct.amount === null && vct.outstanding === null,
      `state ${ct?.state}, signedOn ${ct?.signedOn}, closedOn ${ct?.closedOn}, outstanding ${ct?.outstanding}; a viewer: amount ${vct?.amount}`);
  } finally {
    for (const c of clients) await c.close();
    // Invented vehicles are left historical, so later properties that read the raising vehicles do not meet them.
    await db.query(`update platform.vehicle set phase = 'historical' where id = any($1::uuid[])`, [[V1.id, V2.id]]);
  }
}
