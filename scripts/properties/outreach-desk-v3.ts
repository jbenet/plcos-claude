/**
 * The mail desk's third round (docs/27 §4a–§4c, §5, 5 Oct 2026), through the real REST and MCP handlers, on invented data:
 *   - every route carries askFirst, the first hop past the team member, on 1-, 2- and 3-hop routes; introducer is unchanged;
 *   - top_connectors counts first-hop and deeper appearances, flags reachableDirectly, and ranks first hops only on request;
 *   - a connector's target list (top_connectors with entityId) is complete, ordered by score, paged once through, and
 *     reads only LPs the caller may read;
 *   - asksThisQuarter and lastAsk come from the recorded asks and the mail trace, and count only this calendar quarter;
 *   - one message linked to several LPs is all-or-nothing and authorized per LP; an autonomous send about several LPs
 *     is refused, since an approval covers one email about one LP;
 *   - the close track's signedCount counts the signatures recorded for the commitment.
 * Two invented vehicles keep the route planning small; they are left historical at the end.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

type Result = { isError?: boolean; content: Array<{ type: string; text: string }>; _meta?: Record<string, unknown> };

export async function outreachDeskV3Properties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { READ_TOOLS } = await import('../../lib/mcp/tools');
  const { quarterStart } = await import('../../lib/outreach/connectors');
  const { decideTicket } = await import('../../modules/governance');
  const { POST } = await import('../../app/api/mcp/route');
  resetWindows();
  const rest = await outreachClient();
  const { juan, fund, user, token, entity, pursuit } = await fixtures(db);
  const clients: Client[] = [];
  const connect = async (secret: string) => {
    const client = new Client({ name: 'props-juanmail-v3', version: '0' });
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

  // ── Fixtures: two invented vehicles, a chain of connectors, LPs one, two and three hops away ─────
  const vehicle = async (slug: string) => (await db.one<{ id: string; slug: string }>(`insert into platform.vehicle (slug, name, kind, exemption, sort_order)
    values ($1, $2, 'fund', '506(c)', 901) on conflict (slug) do update set phase = 'active' returning id::text, slug`, [slug, `Invented ${slug}`]))!;
  const V1 = await vehicle('invented-desk-v3-one'), V2 = await vehicle('invented-desk-v3-two');
  let juanE = (await db.one<{ id: string }>(`select identity.canonical_entity_id(entity_id)::text id from identity.source_record where source = 'app_user' and source_id = 'juan'`))?.id;
  if (!juanE) {
    juanE = await entity('Invented Desk V3 Juan', 'person');
    await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('app_user', 'juan', $1, 'props')`, [juanE]);
  }
  const first = await entity('Invented V3 First Hop', 'person'), second = await entity('Invented V3 Second Hop', 'person');
  const near = await entity('Invented V3 LP Near'), deep = await entity('Invented V3 LP Deep'), direct = await entity('Invented V3 LP Direct');
  const passedLp = await entity('Invented V3 LP Passed'), otherLp = await entity('Invented V3 LP Other Vehicle');
  const edge = (a: string, b: string) => db.query(`insert into network.edge (from_entity, to_entity, kind, tier, evidence, valid_from)
    values ($1, $2, 'colleague', 'B'::network.evidence_tier, '[{"note":"Invented v3 desk tie","source":"https://example.org/invented-desk-v3","as_of":"2026-09-01"}]'::jsonb, '2026-01-01')`, [a, b]);
  await edge(juanE, first); await edge(juanE, direct);
  await edge(first, near); await edge(first, second); await edge(second, deep);
  await edge(first, passedLp); await edge(first, otherLp);
  const pNear = await pursuit(near, V1.id, 'selected'), pDeep = await pursuit(deep, V1.id, 'discussing'), pDirect = await pursuit(direct, V1.id, 'new');
  const pPassed = await pursuit(passedLp, V1.id, 'passed'), pOther = await pursuit(otherLp, V2.id, 'selected');
  // An organisation on routes (7 Oct 2026): the team and an LP share it, and through it the team reaches a person who
  // knows another LP. It links people; it is never a connector, and the person past it is the first hop.
  const firm = await entity('Invented V3 Shared Firm'), pastFirm = await entity('Invented V3 Past The Firm', 'person');
  const viaFirm = await entity('Invented V3 LP Via Firm'), viaPerson = await entity('Invented V3 LP Via Firm Person');
  await edge(juanE, firm); await edge(firm, viaFirm); await edge(firm, pastFirm); await edge(pastFirm, viaPerson);
  await pursuit(viaFirm, V1.id, 'selected'); await pursuit(viaPerson, V1.id, 'selected');

  // Asks to the first hop: one made this quarter, one last quarter (answered), one proposed and never made; none to the second.
  const q0 = quarterStart(new Date());
  const thisQuarter = new Date(Math.max(q0.getTime() + 60_000, Date.now() - 3_600_000));
  const lastQuarter = new Date(q0.getTime() - 10 * 86_400_000);
  const ask = (at: Date | null, status: string, outcome: string | null) => db.query(`insert into coordination.ask (entity_id, connector_id, vehicle_id, status, owner_id, purpose, made_at, outcome)
    values ($1, $2, $3, $4::coordination.ask_status, $5, 'Invented v3 ask', $6, $7::coordination.ask_outcome)`, [near, first, V1.id, status, juan.id, at, outcome]);
  await ask(thisQuarter, 'made', null); await ask(lastQuarter, 'answered', 'opted_in'); await ask(null, 'proposed', null);
  // Their reply after this quarter's ask, as juanmail reported it.
  await db.query(`insert into email.comms_message (message_id, has_message_id, sent_at, direction, from_addr, to_addrs, entity_ids, mailbox_of)
    values ('<props-v3-reply@invented.example>', true, $1, 'theirs', 'first@invented-v3.example', array['juan@example.invalid'], array[$2]::uuid[], $3)`,
  [new Date(thisQuarter.getTime() + 60_000), first, juan.id]);

  // The close track: two signatures on the near LP's commitment, none on the deep one's.
  const exposure = async (e: string) => (await db.one<{ id: string }>(`insert into pipeline.exposure (entity_id, vehicle_id, owner_id, instrument, track, amount)
    values ($1, $2, $3, 'lp_commitment', 'soft', 100000) returning exposure_id::text id`, [e, V1.id, juan.id]))!.id;
  const xNear = await exposure(near); await exposure(deep);
  await db.query(`insert into pipeline.commitment_event (exposure_id, step, occurred_on, reason, source, recorded_by) values
    ($1, 'signed', '2026-09-01', null, 'us', $2), ($1, 'resigned', '2026-09-20', 'Invented: the entity changed', 'us', $2)`, [xNear, juan.id]);

  const gpOne = await user('desk-v3-gp-one', 'team', [V1.id]);
  const gpTwo = await user('desk-v3-gp-two', 'team', [V2.id]);
  const reads = [...READ_TOOLS, OUTREACH_READ];
  const [juanTok, oneTok, twoTok] = [await token(juan, reads), await token(gpOne, reads), await token(gpTwo, reads)];
  const oneMcp = await connect(oneTok);

  try {
    // ── askFirst on 1-, 2- and 3-hop routes ───────────────────────────────────────────────
    type Person = { entityId: string; name: string; doNotApproach: boolean; direct?: boolean };
    type Route = { fromEntityId: string | null; hops: Person[]; introducer: Person | null; askFirst: Person | null };
    const routesOf = async (target: string) => ((await rest(juanTok, 'routes-to', { entityId: target, vehicle: V1.slug })).json?.data?.routes ?? []) as Route[];
    const [rDirect, rNear, rDeep] = [await routesOf(direct), await routesOf(near), await routesOf(deep)];
    const one = rDirect.find((r) => r.hops.length === 1 && r.fromEntityId === juanE);
    const two = rNear.find((r) => r.hops.length === 2 && r.fromEntityId === juanE);
    const three = rDeep.find((r) => r.hops.length === 3 && r.fromEntityId === juanE);
    const all = [...rDirect, ...rNear, ...rDeep];
    const lpRoutes = (await rest(juanTok, 'routes-through', { entityId: first })).json?.data?.bestRouteToNode as Route | undefined;
    check('Outreach desk v3: askFirst is the first hop past the team member on 1-, 2- and 3-hop routes; the introducer is still the last person before the target',
      Boolean(one && two && three) && all.every((r) => r.askFirst?.entityId === r.hops[0]?.entityId && r.askFirst?.entityId !== r.fromEntityId)
      && one!.askFirst?.entityId === direct && one!.askFirst?.direct === true && one!.introducer === null
      && two!.askFirst?.entityId === first && two!.askFirst?.direct === false && two!.introducer?.entityId === first
      && three!.askFirst?.entityId === first && three!.introducer?.entityId === second && three!.hops[1]!.entityId === second
      && lpRoutes?.askFirst?.entityId === first,
      `1 hop: askFirst ${one?.askFirst?.entityId === direct ? 'the LP (direct)' : one?.askFirst?.name ?? 'NONE'}; 2 hops: ${two?.askFirst?.name ?? 'NONE'} / introducer ${two?.introducer?.name}; `
      + `3 hops: askFirst ${three?.askFirst?.name ?? 'NONE'}, introducer ${three?.introducer?.name}; ${all.length} routes, all hops[0]: ${all.every((r) => r.askFirst?.entityId === r.hops[0]?.entityId)}; through: ${lpRoutes?.askFirst?.name ?? 'none'}`);

    // ── top_connectors: first hop or deeper, reachableDirectly, firstHopOnly ─────────────────
    type Conn = { entityId: string; lps: number; asFirstHop: number; asDeeperHop: number; reachableDirectly: boolean; asksThisQuarter: number | null;
      lastAsk: { on: string; replied: boolean | null; basis: string } | null; examplePursuitIds: string[]; intros?: import("../../lib/outreach/connectors").IntroHistory["intros"] };
    const listed = await rest(oneTok, 'connectors', { vehicle: V1.slug });
    const firstOnly = await rest(oneTok, 'connectors', { vehicle: V1.slug, firstHopOnly: '1' });
    const firstOnlyMcp = await mcp(oneMcp, 'top_connectors', { vehicle: V1.slug, firstHopOnly: true });
    const find = (d: any, id: string) => ((d?.connectors ?? []) as Conn[]).find((c) => c.entityId === id);
    const cA = find(listed.json?.data, first), cB = find(listed.json?.data, second);
    const fA = find(firstOnly.json?.data, first), fB = find(firstOnly.json?.data, second);
    check('Outreach desk v3: top_connectors counts each connector\'s routes as first hop or deeper, lists one the team cannot reach directly flagged reachableDirectly: false, and firstHopOnly=1 ranks first-hop appearances only',
      listed.status === 200 && cA?.asFirstHop === 2 && cA.asDeeperHop === 0 && cA.reachableDirectly === true && cA.lps === 2
      && cB?.asFirstHop === 0 && cB.asDeeperHop === 1 && cB.reachableDirectly === false && cB.lps === 1
      && firstOnly.status === 200 && firstOnly.json.data.firstHopOnly === true && fA?.lps === 2 && fB === undefined
      && ((firstOnly.json.data.connectors ?? []) as Conn[]).every((c) => c.asFirstHop > 0 && c.reachableDirectly)
      && JSON.stringify(firstOnlyMcp.data) === JSON.stringify(firstOnly.json.data),
      `${listed.status}: first hop ${cA?.asFirstHop}/${cA?.asDeeperHop} (direct ${cA?.reachableDirectly}, ${cA?.lps} LPs); second ${cB?.asFirstHop}/${cB?.asDeeperHop} (direct ${cB?.reachableDirectly}); `
      + `firstHopOnly: ${firstOnly.status}, second ${fB ? 'LISTED' : 'left out'}, first ${fA?.lps} LPs; MCP equal ${JSON.stringify(firstOnlyMcp.data) === JSON.stringify(firstOnly.json?.data)}`);

    const pf = find(listed.json?.data, pastFirm), pfFirst = find(firstOnly.json?.data, pastFirm);
    check('Outreach desk v3: an organisation on a route (a shared firm, the fund itself) is never listed as a connector; the first person past it is the first hop; a connector says the hop that caps their best route',
      listed.status === 200 && find(listed.json.data, firm) === undefined && find(firstOnly.json?.data, firm) === undefined
      && pf?.lps === 1 && pf.asFirstHop === 1 && pf.reachableDirectly === true && pfFirst?.lps === 1
      // The hop that caps their best route's score is said: here every hop is a colleague tie, worked together.
      && (cA as any)?.bestWeakestHop?.kind === 'worked_together' && typeof (cA as any)?.bestWeakestHop?.warmth === 'number',
      `firm listed: ${find(listed.json?.data, firm) ? 'YES' : 'no'} (first-hop only: ${find(firstOnly.json?.data, firm) ? 'YES' : 'no'}); `
      + `the person past it: ${pf ? `${pf.lps} LP, first hop ${pf.asFirstHop}, direct ${pf.reachableDirectly}` : 'NOT LISTED'}, first-hop only ${pfFirst?.lps ?? 'not listed'}; `
      + `weakest hop ${JSON.stringify((cA as any)?.bestWeakestHop)}`);

    // ── A connector's targets: complete, ordered, paged once, authorized ──────────────────────
    type Target = { pursuitId: string; score: number | null; position: string };
    const targets = await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: first, limit: '500' });
    const tRows = (targets.json?.data?.rows ?? []) as Target[];
    const deeper = await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: second });
    const deeperFirst = await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: second, firstHopOnly: '1' });
    const seen: string[] = []; let cursor: string | null = null, pages = 0;
    do {
      const d: any = (await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: first, limit: '1', ...(cursor ? { cursor } : {}) })).json?.data;
      seen.push(...((d?.rows ?? []) as Target[]).map((r) => r.pursuitId)); cursor = d?.nextCursor ?? null; pages++;
    } while (cursor && pages < 10);
    const byMcp = await mcp(oneMcp, 'top_connectors', { vehicle: V1.slug, entityId: first, limit: 500 });
    const outside = await rest(twoTok, 'connectors', { vehicle: V1.slug, entityId: first });
    const theirs = await rest(twoTok, 'connectors', { vehicle: V2.slug, entityId: first });
    const foreign = await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: second, cursor: (await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: first, limit: '1' })).json?.data?.nextCursor ?? 'x' });
    const ids = tRows.map((r) => r.pursuitId);
    const ordered = tRows.every((r, i) => i === 0 || (tRows[i - 1]!.score ?? -1) >= (r.score ?? -1));
    check('Outreach desk v3: a connector\'s targets (connectors?entityId=) list every open LP they reach on the vehicle and no other, ordered by route score, paged once through by cursor, and only on a vehicle the caller reads',
      targets.status === 200 && targets.json.data.complete === true && ids.length === 2 && ids.includes(pNear) && ids.includes(pDeep)
      && ![pDirect, pPassed, pOther].some((id) => targets.text.includes(id)) && ordered && tRows.every((r) => typeof r.score === 'number')
      && targets.json.data.total === 2 && tRows.find((r) => r.pursuitId === pDeep)?.position === 'first'
      && deeper.status === 200 && (deeper.json.data.rows as Target[]).map((r) => r.pursuitId).join() === pDeep && deeper.json.data.rows[0].position === 'deeper'
      && deeperFirst.json?.data?.rows?.length === 0
      && seen.join() === ids.join() && pages === 2 && JSON.stringify(byMcp.data) === JSON.stringify(targets.json.data)
      && outside.status === 404 && !outside.text.includes(pNear) && theirs.status === 200 && (theirs.json.data.rows as Target[]).map((r) => r.pursuitId).join() === pOther
      && foreign.status === 400,
      `${targets.status}: ${ids.length} rows (${ids.includes(pNear) && ids.includes(pDeep) ? 'near and deep' : ids.join()}), ordered ${ordered}, total ${targets.json?.data?.total}; `
      + `the second hop's: ${(deeper.json?.data?.rows ?? []).length} (${deeper.json?.data?.rows?.[0]?.position}), first-hop only ${deeperFirst.json?.data?.rows?.length}; paged ${seen.length} over ${pages}; MCP equal ${JSON.stringify(byMcp.data) === JSON.stringify(targets.json?.data)}; `
      + `another vehicle's GP: ${outside.status}, on theirs ${theirs.status}; another query's cursor ${foreign.status}`);

    // ── Kept plans and ifChanged (7 Oct 2026) ───────────────────────────────────────────────
    const kept = await rest(oneTok, 'connectors', { vehicle: V1.slug });
    const version = kept.json?.data?.version as string | null | undefined;
    const same = await rest(oneTok, 'connectors', { vehicle: V1.slug, ifChanged: version ?? 'none' });
    const other = await rest(oneTok, 'connectors', { vehicle: V1.slug, ifChanged: 'not-this-one' });
    const keptTargets = await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: first, limit: '500' });
    const sameTargets = await rest(oneTok, 'connectors', { vehicle: V1.slug, entityId: first, limit: '500', ifChanged: keptTargets.json?.data?.version ?? 'none' });
    // A write to a table the plan reads moves the revision: planned again, and an answer that says the same keeps its version.
    await db.query(`update platform.vehicle set sort_order = sort_order where id = $1`, [V2.id]);
    const replanned = await rest(oneTok, 'connectors', { vehicle: V1.slug, ifChanged: version ?? 'none' });
    check('Outreach desk v3: a complete top_connectors answer carries a version; passed back as ifChanged, the same answer is { unchanged: true } (connectors and one connector\'s targets), another version gets the full answer, and after a write the plan is made again and still matches',
      kept.status === 200 && kept.json.data.complete === true && typeof version === 'string' && version.length > 8
      && same.status === 200 && same.json.data.unchanged === true && same.json.data.version === version && !('connectors' in same.json.data)
      && other.status === 200 && other.json.data.version === version && Array.isArray(other.json.data.connectors)
      && JSON.stringify({ ...other.json.data }) === JSON.stringify(kept.json.data)
      && sameTargets.status === 200 && sameTargets.json.data.unchanged === true && !('rows' in sameTargets.json.data)
      && replanned.status === 200 && replanned.json.data.unchanged === true,
      `version ${version ?? 'NONE'}; same: ${same.status} ${JSON.stringify(same.json?.data)}; other: ${other.status} ${other.json?.data?.version === version ? 'same version' : 'DIFFERENT'}; `
      + `targets: ${JSON.stringify(sameTargets.json?.data)}; after a write: ${JSON.stringify(replanned.json?.data)?.slice(0, 120)}`);

    // ── Shared reads in a long plan, and the daily route warm-up (7 Oct 2026) ─────────────────────
    const { withReadMemo } = await import('../../lib/db/read-memo');
    const { dayDecision } = await import('../../lib/route-day-warm');
    const { getDb } = await import('../../lib/db');
    const live = await getDb();
    const revisionSql = 'select revision::text from network.read_revision where singleton';
    const inside = await withReadMemo(async () => {
      const before = (await live.one<{ revision: string }>(revisionSql))!.revision;
      await db.query(`update platform.vehicle set sort_order = sort_order where id = $1`, [V2.id]);
      const after = (await live.one<{ revision: string }>(revisionSql))!.revision;
      const other = await live.query<{ n: number }>('select count(*)::int n from platform.vehicle');
      return { before, after, other: other.length };
    });
    const liveAfter = (await live.one<{ revision: string }>(revisionSql))!.revision;
    check('Outreach desk v3: inside a long plan a revision read is shared (it reads as at the plan\'s start), outside it reads live; the route warm-up runs when the day changes, never at the first look',
      inside.before === inside.after && liveAfter !== inside.before && inside.other === 1
      && dayDecision(null, '2026-10-07') === 'record' && dayDecision('2026-10-07', '2026-10-07') === 'wait' && dayDecision('2026-10-07', '2026-10-08') === 'warm',
      `inside: ${inside.before} then ${inside.after}; outside after the write: ${liveAfter}; day decisions ${dayDecision(null, 'd')}/${dayDecision('d', 'd')}/${dayDecision('d', 'e')}`);

    // ── The light contacts read (7 Oct 2026) ───────────────────────────────────────────────
    const personLp = await entity('Invented V3 LP Person', 'person');
    const pPerson = await pursuit(personLp, V1.id, 'discussing');
    await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body) values
      ('props-desk-v3-research', 'Invented research note', 'fixture', 'public', current_date, 'weak', 'Invented', '') on conflict do nothing`);
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'person@invented-v3.example', 'props-desk-v3-research', current_date, 'medium')`, [personLp]);
    type CRow = { pursuitId: string; vehicle: string; entity: { id: string; name: string; kind: string }; status: { value: string; label: string }; passed: boolean; contacts: Array<{ email: string }> };
    const light = await rest(oneTok, 'contacts', { vehicle: V1.slug });
    const lRows = (light.json?.data?.rows ?? []) as CRow[];
    const lIds = lRows.map((r) => r.pursuitId);
    const withPassed = await rest(oneTok, 'contacts', { vehicle: V1.slug, includePassed: '1' });
    const passedRow = ((withPassed.json?.data?.rows ?? []) as CRow[]).find((r) => r.pursuitId === pPassed);
    const everyOne = await rest(oneTok, 'contacts', { vehicle: 'all' });
    const lightMcp = await mcp(oneMcp, 'outreach_contacts', { vehicle: V1.slug });
    const lVersion = light.json?.data?.version as string | undefined;
    const lCursor = light.json?.data?.cursor as string | undefined;
    const lSame = await rest(oneTok, 'contacts', { vehicle: V1.slug, ifChanged: lVersion ?? 'none' });
    const lQuiet = await rest(oneTok, 'contacts', { vehicle: V1.slug, updatedSince: lCursor ?? '' });
    await db.query(`update strategy.pursuit set status = 'discussing', status_set_at = now() where pursuit_id = $1`, [pDirect]);
    const lMoved = await rest(oneTok, 'contacts', { vehicle: V1.slug, ifChanged: lVersion ?? 'none' });
    const lSince = await rest(oneTok, 'contacts', { vehicle: V1.slug, updatedSince: lCursor ?? '' });
    const lOutside = await rest(twoTok, 'contacts', { vehicle: V1.slug });
    const proposeStill = await rest(oneTok, 'contacts', {}, { method: 'POST', body: {} });
    const personRow = lRows.find((r) => r.pursuitId === pPerson);
    check('Outreach desk v3: GET contacts answers every open LP on the vehicle in one page with only pursuit, name, kind, status (with its label), passed and the addresses on file; passed LPs only with includePassed; vehicle=all keeps to the vehicles the token reads; MCP says the same; ifChanged with the version is { unchanged: true }; after a status change the version moves and updatedSince keeps only that row; another vehicle\'s reader is refused; POST contacts still proposes an address',
      light.status === 200 && [pNear, pDeep, pDirect, pPerson].every((p) => lIds.includes(p)) && !lIds.includes(pPassed) && !lIds.includes(pOther)
      && light.json.data.total === lRows.length && light.json.data.nextOffset === null
      && lRows.every((r) => Object.keys(r).sort().join() === 'contacts,entity,passed,pursuitId,status,vehicle' && r.passed === false && r.vehicle === V1.slug && typeof r.status.label === 'string')
      && personRow?.entity.kind === 'person' && personRow.contacts.some((c) => c.email === 'person@invented-v3.example')
      && passedRow?.passed === true && passedRow.status.value === 'passed'
      && everyOne.status === 200 && ((everyOne.json.data.rows ?? []) as CRow[]).every((r) => r.vehicle === V1.slug)
      && JSON.stringify(lightMcp.data?.rows) === JSON.stringify(lRows) && lightMcp.data?.version === lVersion
      && typeof lVersion === 'string' && lSame.status === 200 && lSame.json.data.unchanged === true && lSame.json.data.version === lVersion && !('rows' in lSame.json.data)
      && lQuiet.status === 200 && lQuiet.json.data.rows.length === 0
      && lMoved.status === 200 && lMoved.json.data.version !== lVersion && Array.isArray(lMoved.json.data.rows)
      && lSince.status === 200 && (lSince.json.data.rows as CRow[]).map((r) => r.pursuitId).join() === pDirect
      && lOutside.status === 404 && !lOutside.text.includes(pNear) && proposeStill.status !== 405 && proposeStill.status !== 404,
      `${light.status}: ${lRows.length} rows (passed in ${lIds.includes(pPassed)}), keys ${lRows[0] ? Object.keys(lRows[0]).sort().join() : 'none'}; person ${JSON.stringify(personRow?.contacts)}; with passed ${passedRow?.passed}; `
      + `all: ${everyOne.status} ${((everyOne.json?.data?.rows ?? []) as CRow[]).map((r) => r.vehicle).filter((v, i, a) => a.indexOf(v) === i).join()}; MCP equal ${JSON.stringify(lightMcp.data?.rows) === JSON.stringify(lRows)}${lightMcp.error ? ` (${lightMcp.error.slice(0, 120)})` : ''}; `
      + `same ${JSON.stringify(lSame.json?.data)}; quiet ${lQuiet.json?.data?.rows?.length}; moved ${lMoved.json?.data?.version === lVersion ? 'SAME VERSION' : 'new version'}; since ${(lSince.json?.data?.rows ?? []).length} rows; outside ${lOutside.status}; POST ${proposeStill.status}`);

    // ── Affinity's own addresses (7 Oct 2026: contacts were empty on every queue row) ─────────────
    const affLp = await entity('Invented V3 LP Affinity Person', 'person');
    const pAff = await pursuit(affLp, V1.id, 'selected');
    await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('affinity', 'person:990001', $1, 'props')`, [affLp]);
    for (const [at, primary] of [['2026-09-01', 'old@invented-affinity.example'], ['2026-10-01', 'primary@invented-affinity.example']] as const) {
      await db.query(`insert into sources.raw_record (source, kind, source_id, payload_hash, payload, fetched_at) values ('affinity', 'person', '990001', $1, $2::jsonb, $3)`,
        [`props-v3-aff-${at}`, JSON.stringify({ id: 990001, type: 'external', firstName: 'Invented', primaryEmailAddress: primary, emailAddresses: [primary, 'second@invented-affinity.example', 'not an address'] }), at]);
    }
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'Second@invented-affinity.example', 'props-desk-v3-research', current_date, 'medium')`, [affLp]);
    const affRow = ((await rest(oneTok, 'contacts', { vehicle: V1.slug })).json?.data?.rows ?? []).find((r: { pursuitId: string }) => r.pursuitId === pAff);
    const affOutside = ((await rest(twoTok, 'queue', { vehicle: V2.slug })).text ?? '');
    const affEmails = (affRow?.contacts ?? []).map((c: { email: string; source: string }) => `${c.email}:${c.source}`);
    check('Outreach desk v3: an LP\'s addresses include the ones Affinity holds for the person (latest record, primary first, after any claim, the same address once, source affinity, unconfirmed); never a malformed one',
      affEmails.join() === 'Second@invented-affinity.example:research,primary@invented-affinity.example:affinity'
      && (affRow?.contacts ?? []).every((c: { confirmedAt: string | null }) => c.confirmedAt === null) && !affOutside.includes('invented-affinity'),
      `${JSON.stringify(affEmails)}`);

    // ── Reply owed: a written message from them, unanswered (7 Oct 2026) ────────────────────────
    const { replyOwedFrom } = await import('../../lib/outreach/reads');
    const tp = (on: string, channel: string, direction: string, extra: Record<string, unknown> = {}) => ({ on: new Date(on), channel, direction, groupSize: 2, ...extra }) as never;
    const owedCases = {
      meetingLast: replyOwedFrom([tp('2026-09-01', 'email', 'ours'), tp('2026-09-10', 'meeting', 'both')]),
      theirEmail: replyOwedFrom([tp('2026-09-01', 'email', 'ours'), tp('2026-09-05', 'email', 'theirs')]),
      answered: replyOwedFrom([tp('2026-09-05', 'email', 'theirs'), tp('2026-09-06', 'email', 'ours')]),
      metAfter: replyOwedFrom([tp('2026-09-05', 'email', 'theirs'), tp('2026-09-07', 'call', 'both')]),
      autoReply: replyOwedFrom([tp('2026-09-05', 'email', 'theirs', { aboutBasis: 'Automatic reply: out of office' })]),
      firm: replyOwedFrom([tp('2026-09-05', 'email', 'theirs', { viaOrganization: 'Invented Firm' })]),
      list: replyOwedFrom([tp('2026-09-01', 'email', 'ours'), tp('2026-09-05', 'email', 'theirs', { groupSize: 3 })]),
      update: replyOwedFrom([tp('2026-09-05', 'email', 'theirs', { groupSize: 1, aboutBasis: 'a company\'s update to its investors (“newsletter”)' })]),
      listThenOwn: replyOwedFrom([tp('2026-09-05', 'email', 'theirs'), tp('2026-09-08', 'email', 'theirs', { groupSize: 6 })]),
    };
    check('Outreach desk v3: a reply is owed when their latest email or message came after anything of ours (a message, or a meeting or call together); a meeting is never their unanswered message, nor an automatic reply, their firm\'s mail, a message to a list of three or more of our parties, or a company\'s update to its investors',
      owedCases.meetingLast === null && owedCases.theirEmail?.since === '2026-09-05' && owedCases.answered === null && owedCases.metAfter === null
      && owedCases.autoReply === null && owedCases.firm === null && owedCases.list === null && owedCases.update === null
      && owedCases.listThenOwn?.since === '2026-09-05', JSON.stringify(owedCases));

    // ── Ask history ───────────────────────────────────────────────────────────────────────
    const lastOn = thisQuarter.toISOString().slice(0, 10);
    check('Outreach desk v3: asksThisQuarter counts the intro asks made to that person this calendar quarter (not last quarter\'s, not one never made), and lastAsk says when and whether they replied, from the mail trace',
      cA?.asksThisQuarter === 1 && cA.lastAsk?.on === lastOn && cA.lastAsk.replied === true && /trace/i.test(cA.lastAsk.basis)
      && cB?.asksThisQuarter === 0 && cB.lastAsk === null && find(targets.json?.data ? { connectors: [targets.json.data.connector] } : null, first)?.asksThisQuarter === 1,
      `first hop: ${cA?.asksThisQuarter} this quarter, last ${cA?.lastAsk?.on} (replied ${cA?.lastAsk?.replied}, ${cA?.lastAsk?.basis}); second: ${cB?.asksThisQuarter}, last ${JSON.stringify(cB?.lastAsk)}`);

    // ── Intro outcomes per connector (JuanMail, 7 Oct 2026) ─────────────────────────────────
    check('Outreach desk v3: a connector row says how many intro asks were made through them (made ones only, all time), which of those LPs are now Committed, and the last one (who, when, days to the first meeting since, or null)',
      cA?.intros?.made === 2 && cA.intros.committed.length === 0 && cA.intros.last?.name === 'Invented V3 LP Near' && cA.intros.last.on === lastOn
        && cA.intros.last.daysToMeeting === null && cA.intros.last.pursuitId === pNear && cB?.intros?.made === 0 && cB.intros.last === null,
      `${JSON.stringify(cA?.intros)} / ${JSON.stringify(cB?.intros)}`);

    // ── One message, several LPs ───────────────────────────────────────────────────────────
    const rw = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
    const oneRw = await token(gpOne, [OUTREACH_READ, OUTREACH_WRITE]);
    const post = (op: string, body: unknown, secret = rw) => rest(secret, op, {}, { method: 'POST', body });
    const agent = (op: string, body: unknown) => rest(rw, op, {}, { method: 'POST', body, headers: { 'x-autonomous': '1' } });
    const m = [] as string[];
    for (let i = 1; i <= 5; i++) m.push(await pursuit(await entity(`Invented V3 Multi ${i}`), fund.id, 'selected'));
    let n = 0;
    const to = ['partner@invented-v3.example'];
    const msg = (pursuitIds: string[], extra: Record<string, unknown> = {}) => ({ pursuitIds, gmailMessageId: `gmail-v3-${++n}`, messageId: `<props-v3-multi-${n}@invented.example>`,
      date: new Date().toISOString(), direction: 'sent', from: juan.email || 'juan@example.invalid', to, subject: 'Invented: three of ours', ...extra });
    // The link's key is the Message-ID without its brackets, lower-cased (lib/comms/trace.ts normalizeMessageId).
    const rowsFor = async (messageId: string) => db.query<{ p: string; t: string | null }>(`select pursuit_id::text p, ticket_id::text t from email.message_link
      where message_id = $1 order by pursuit_id`, [messageId.replace(/^<|>$/g, '').toLowerCase()]);
    const three3 = msg([m[0]!, m[1]!, m[2]!]);
    const l1 = await post('link', three3), l2 = await post('link', three3);
    const wider = await post('link', { ...three3, pursuitIds: [m[0]!, m[1]!, m[3]!] });
    const r3 = await rowsFor(three3.messageId);
    const mixed = msg([pNear, m[0]!]);
    const notAll = await post('link', mixed, oneRw);
    const mixedRows = await rowsFor(mixed.messageId);
    const theirOwn = await post('link', msg([pNear]), oneRw);
    const both = await post('link', { ...msg([m[0]!]), pursuitId: m[0]! });
    check('Outreach desk v3: one message linked to several LPs (pursuitIds) is one link per LP in one transaction — again is "already", a different set is refused, and an LP the caller may not change refuses them all',
      l1.status === 200 && l1.json.data.linked === true && l1.json.data.links?.length === 3 && r3.length === 3 && r3.every((r) => r.t === null)
      && l2.json?.data?.already === true && wider.status === 409 && (await rowsFor(three3.messageId)).length === 3
      && notAll.status === 404 && mixedRows.length === 0 && theirOwn.status === 200 && both.status === 400,
      `person: ${l1.status} (${l1.json?.data?.links?.length ?? l1.json?.error} links), again ${l2.json?.data?.already ? 'already' : 'WROTE'}, another set ${wider.status}; `
      + `a GP on another vehicle naming one of theirs and one not: ${notAll.status}, ${mixedRows.length} rows; theirs alone ${theirOwn.status}; pursuitId with pursuitIds ${both.status}`);

    // Autonomous: an approval covers one email about one LP, so an agent's send about several is refused, even with an
    // approved ticket for each; nothing is linked and no ticket is used. Each LP's own email still links under its ticket.
    const ticket = async (p: string) => {
      const t = await agent('tickets', { kind: 'SEND', pursuitId: p, scope: { recipients: to, purpose: 'invite' } });
      const id = t.json?.data?.ticketId as string | undefined;
      if (id) await decideTicket(juan.id, id, 'approve', 'props');
      return id ?? '';
    };
    const [t0, t1] = [await ticket(m[3]!), await ticket(m[4]!)];
    const used = async () => (await db.query<{ t: string }>(`select ticket_id::text t from email.outreach_send where ticket_id = any($1::uuid[]) and sent_at is not null`, [[t0, t1]])).map((r) => r.t);
    const auto = msg([m[3]!, m[4]!]);
    const a1 = await agent('link', auto);
    const a1Rows = await rowsFor(auto.messageId), usedAfter = await used();
    const withTicket = await agent('link', { ...msg([m[3]!]), ticketId: t0 });
    const received = await agent('link', msg([m[3]!, m[4]!], { direction: 'received', from: to[0], to: [juan.email || 'juan@example.invalid'] }));
    // A person's message about both: linked to each, with no ticket used — each approval stays for its own email.
    const personBoth = msg([m[3]!, m[4]!]);
    const p1 = await post('link', personBoth);
    const pRows = await rowsFor(personBoth.messageId), usedAfterPerson = await used();
    const single = await agent('link', { ...msg([]), pursuitIds: undefined, pursuitId: m[3]!, ticketId: t0 });
    check('Outreach desk v3: an autonomous send about several LPs is refused (409) even with an approved ticket for each — nothing linked, no ticket used; a person\'s links to each and uses none; one LP\'s own email still links under its ticket',
      Boolean(t0 && t1) && a1.status === 409 && /several LPs/.test(a1.json?.error ?? '') && a1Rows.length === 0 && usedAfter.length === 0
      && withTicket.status === 400 && received.status === 200
      && p1.status === 200 && pRows.length === 2 && pRows.every((r) => r.t === null) && usedAfterPerson.length === 0
      && single.status === 200 && single.json.data.ticketUsed === true && (await used()).join() === t0,
      `tickets ${[t0, t1].filter(Boolean).length}/2; agent, both LPs: ${a1.status}, ${a1Rows.length} rows, ${usedAfter.length} tickets used; with ticketId: ${withTicket.status}; agent, a received message: ${received.status}; `
      + `person, both: ${p1.status}, ${pRows.length} rows, ${usedAfterPerson.length} tickets used; agent, one LP under its ticket: ${single.status}${single.json?.error ? ` (${single.json.error})` : ''}`);

    // ── signedCount ────────────────────────────────────────────────────────────────────────
    const ct = async (p: string) => ((await rest(oneTok, 'queue', { vehicle: V1.slug, pursuitId: p })).json?.data?.rows?.[0] as { closeTrack: Record<string, unknown> | null } | undefined)?.closeTrack;
    const [cNear, cDeep, cDirect] = [await ct(pNear), await ct(pDeep), await ct(pDirect)];
    check('Outreach desk v3: the close track\'s signedCount is how many times documents were signed for the commitment (signed and re-signed), 0 when none is recorded',
      cNear?.signedCount === 2 && cNear.signedOn === '2026-09-20' && cDeep?.signedCount === 0 && cDeep.signedOn === null && cDirect === null,
      `two signatures: ${cNear?.signedCount} (last ${cNear?.signedOn}); none: ${cDeep?.signedCount}; no commitment: ${cDirect === null ? 'no close track' : JSON.stringify(cDirect)}`);
  } finally {
    for (const c of clients) await c.close();
    await db.query(`update platform.vehicle set phase = 'historical' where id = any($1::uuid[])`, [[V1.id, V2.id]]);
  }
}
