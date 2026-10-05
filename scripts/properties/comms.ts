/**
 * The comms trace and who needs a ticket (Juan, 5 Oct 2026; docs/27 §5–§7), on invented data:
 *   - a person's draft or send path never requires a SEND or INTRO_ASK ticket (asks, materials, links);
 *   - an autonomous call without an approved ticket is refused (a made ask, a material, an MCP link);
 *   - outreach_link_message is idempotent and creates no outreach state (outreach-writes.ts has the REST half);
 *   - comms_ingest is idempotent by Message-ID, writes nothing else, and is de-duplicated with Affinity's records;
 *   - a restriction is always surfaced (the queue's checks, the trace tool never drops it);
 *   - the merge is stable: the same records in any order give the same trace, and merging again changes nothing.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Touchpoint } from '../../modules/meetings';
import type { CommsLink, CommsMessage } from '../../lib/comms/trace';
import type { Check, Db } from './harness';
import { fixtures } from './outreach-api';

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };

const touch = (o: Partial<Touchpoint> & { touchpointId: string }): Touchpoint => ({
  entityId: 'e1', entityName: 'Invented LP', vehicleId: null, vehicleName: null, channel: 'email', kind: null, on: null, scheduledFor: null,
  direction: null, ownerName: 'Invented Juan', attendees: [], summary: null, read: null, readByName: null, source: 'affinity', sourceRef: null,
  viaOrganization: null, viaContact: null, about: null, aboutVehicles: [], aboutBasis: null, aboutBy: null, groupSize: 1, ...o,
});
const message = (o: Partial<CommsMessage> & { messageId: string; sentAt: Date }): CommsMessage => ({
  hasMessageId: true, gmailId: `g-${o.messageId}`, threadId: 't1', direction: 'theirs', from: 'ana@invented.example', to: ['juan@invented.example'], cc: [],
  subject: 'Invented: the deck', entityId: 'e1', entityName: 'Invented LP', viaOrganization: null, viaContact: null, pursuitId: null, vehicleId: null,
  vehicleName: null, about: null, aboutVehicles: [], aboutBasis: null, team: ['Invented Juan'], mailboxOf: 'Invented Juan', ...o,
});

export async function commsProperties(check: Check, db: Db) {
  const { mergeTrace, traceState } = await import('../../lib/comms/trace');

  // ── The merge, pure ──────────────────────────────────────────────────────────────────
  const d = (s: string) => new Date(s);
  const touches = [
    touch({ touchpointId: 'a1', on: d('2026-10-01T00:00:00Z'), direction: 'theirs', attendees: ['Invented Juan'], sourceRef: 'interaction:email:1:person:1' }),
    touch({ touchpointId: 'a2', on: d('2026-10-02T00:00:00Z'), direction: 'ours', attendees: [], ownerName: 'Not on the team', sourceRef: 'interaction:email:2:person:1' }),
    touch({ touchpointId: 'm1', channel: 'meeting', on: d('2026-09-20T00:00:00Z'), direction: 'both', sourceRef: 'interaction:meeting:3:person:1' }),
    touch({ touchpointId: 'u1', source: 'us', on: d('2026-09-25T12:00:00Z'), direction: 'ours' }),
  ];
  const messages = [
    message({ messageId: 'x1@invented', sentAt: d('2026-10-01T15:04:00Z') }),
    message({ messageId: 'x2@invented', sentAt: d('2026-10-02T09:00:00Z'), direction: 'ours', from: 'juan@invented.example', to: ['ana@invented.example'], team: ['Invented Juan'] }),
    message({ messageId: 'x3@invented', sentAt: d('2026-10-03T08:00:00Z'), subject: 'Re: Invented: the deck' }),
    // The same message from a second mailbox, without a Message-ID: one row.
    message({ messageId: 'gmail:other-box', hasMessageId: false, sentAt: d('2026-10-03T08:00:30Z'), subject: 'Re: Invented: the deck', mailboxOf: 'Invented Mara' }),
  ];
  const links: CommsLink[] = [
    { messageId: 'x2@invented', sentAt: d('2026-10-02T09:00:00Z'), direction: 'ours', subject: null, pursuitId: 'p1', ticketId: null, linkedByName: 'Invented Juan', autonomous: false, linkedAt: d('2026-10-02T09:01:00Z') },
    { messageId: 'never@invented', sentAt: d('2026-10-03T10:00:00Z'), direction: 'ours', subject: null, pursuitId: 'p1', ticketId: null, linkedByName: 'Invented Juan', autonomous: true, linkedAt: d('2026-10-03T10:01:00Z') },
  ];
  const now = d('2026-10-04T00:00:00Z');
  const m = mergeTrace(touches, messages, links, now);
  const shape = (x: ReturnType<typeof mergeTrace>) => JSON.stringify({ t: x.touches.map((t) => t.touchpointId), s: [...x.sameAs].sort(), f: x.flags });
  const shuffled = mergeTrace([...touches].reverse(), [messages[2]!, messages[0]!, messages[3]!, messages[1]!], [...links].reverse(), now);
  const again = mergeTrace(m.touches, messages, links, now);
  const st = traceState(m, now);
  check('Comms trace: the merge is stable — the same records in any order give the same trace, and merging the merged trace again changes nothing',
    shape(m) === shape(shuffled) && shape(m) === shape(again),
    `${shape(m).slice(0, 160)} | shuffled ${shape(shuffled) === shape(m) ? 'same' : 'DIFFERENT'} | again ${shape(again) === shape(m) ? 'same' : 'DIFFERENT'}`);
  check('Comms trace: a Gmail message Affinity also has is one row — matched by date and participants (medium) or date alone (low), said with its confidence; two mailboxes\' copies are one; an unmatched one is its own row',
    m.touches.length === 5 && (m.sameAs.get('a1') ?? [])[0]?.confidence === 'medium' && (m.sameAs.get('a2') ?? [])[0]?.confidence === 'low'
    && m.touches.some((t) => t.touchpointId === 'gmail:x3@invented') && !m.touches.some((t) => t.touchpointId.includes('other-box'))
    && (m.sameAs.get('gmail:x3@invented') ?? [])[0]?.ref === 'gmail:other-box',
    `${m.touches.length} rows: ${m.touches.map((t) => t.touchpointId).join(', ')}; a1 ${JSON.stringify(m.sameAs.get('a1'))}; a2 ${m.sameAs.get('a2')?.[0]?.confidence}`);
  check('Comms trace: who owes a reply and who holds the thread come from the trace; a link the trace has not shown, an agent send with no ticket, and an email logged here that the mail does not show are flagged',
    st.owes?.by === 'us' && st.owes.since.toISOString() === '2026-10-03T08:00:00.000Z' && st.thread?.holder === 'Invented Juan' && st.thread.messages === 3
    && m.flags.some((f) => f.kind === 'linked_not_in_trace' && f.ref === 'never@invented') && m.flags.some((f) => f.kind === 'agent_send_without_ticket')
    && m.flags.some((f) => f.kind === 'logged_not_in_trace' && f.ref === 'u1') && !m.flags.some((f) => f.ref === 'x2@invented'),
    `owes ${st.owes?.by} since ${st.owes?.since.toISOString()}; thread held by ${st.thread?.holder}, ${st.thread?.messages} messages; flags ${m.flags.map((f) => `${f.kind}:${f.ref}`).join(', ')}`);
  // Without any Gmail message there is no coverage to judge a logged email against.
  check('Comms trace: with no Gmail message for an LP, nothing logged here is flagged — an absence the trace does not cover says nothing',
    mergeTrace(touches, [], [], now).flags.length === 0, `${mergeTrace(touches, [], [], now).flags.length} flags`);

  // ── A person's path needs no ticket; an autonomous one fails closed ───────────────────
  const { proposeAsk, makeAsk } = await import('../../modules/coordination');
  const { requestSend, recordSend } = await import('../../modules/content');
  const { AUTONOMOUS, PERSON, TicketRequired, ticketNeeded } = await import('../../modules/governance');
  const { juan, fund, user, token, entity, pursuit } = await fixtures(db);
  const target = await entity('Invented Comms Target', 'person');
  const connector = await entity('Invented Comms Connector', 'person');
  const asked = await proposeAsk(juan.id, { entityId: target, entityName: 'Invented Comms Target', connectorId: connector, connectorName: 'Invented Comms Connector',
    vehicleId: fund.id, vehicleName: 'fund', purpose: 'Invented', carries: 'Invented' });
  let personMade = 'ok';
  try { await makeAsk(juan.id, asked.askId, null, 'email', { reason: 'props' }); } catch (e) { personMade = e instanceof Error ? e.message : String(e); }
  const agentAsk = await proposeAsk(juan.id, { entityId: await entity('Invented Comms Target 2', 'person'), entityName: 'Invented Comms Target 2', connectorId: connector,
    connectorName: 'Invented Comms Connector', vehicleId: fund.id, vehicleName: 'fund', purpose: 'Invented', carries: 'Invented' }, AUTONOMOUS);
  let agentRefused = false;
  try { await makeAsk(juan.id, agentAsk.askId, null, 'email', { reason: 'props' }, AUTONOMOUS); } catch (e) { agentRefused = e instanceof TicketRequired; }
  // A material a person may send: the first approved, unflagged asset whose wrap passes for some vehicle.
  const assets = await db.query<{ asset_id: string }>(`select a.asset_id::text from content.asset a where a.status = 'approved'
    and not exists (select 1 from content.refresh_flag f where f.asset_id = a.asset_id and f.cleared_at is null) order by a.title`);
  const sendable = await db.query<{ id: string; kind: string }>(`select id::text, kind::text from platform.vehicle where kind in ('fund', 'spv') order by sort_order`);
  let material = 'no material passes the wrap for any vehicle in the seed';
  search: for (const a of assets) for (const v of sendable) {
    const instrument = v.kind === 'spv' ? 'spv' : 'lp_commitment';
    const cleared = await requestSend(juan.id, { assetId: a.asset_id, entityId: target, vehicleId: v.id, instrument });
    if (!cleared.check.allowed) continue;
    await recordSend(juan.id, cleared.sendId, null);
    const sent = await db.one<{ status: string }>('select status::text from content.send where send_id = $1', [cleared.sendId]);
    const agentSend = await requestSend(juan.id, { assetId: a.asset_id, entityId: target, vehicleId: v.id, instrument }, AUTONOMOUS);
    let agentSendRefused = false;
    try { await recordSend(juan.id, agentSend.sendId, null, AUTONOMOUS); } catch (e) { agentSendRefused = e instanceof TicketRequired; }
    material = cleared.ticketId === null && sent?.status === 'sent' && agentSend.ticketId !== null && agentSendRefused ? 'ok'
      : `person ticket ${cleared.ticketId}, status ${sent?.status}; agent ticket ${agentSend.ticketId}, refused ${agentSendRefused}`;
    break search;
  }
  check('Who needs a ticket: a person proposes and makes an ask and clears and sends a material with no SEND or INTRO_ASK ticket; an autonomous agent is refused without one; MONEY, STAGE and ALLOCATION_EXCEPTION are unchanged',
    asked.ticketId === null && personMade === 'ok' && agentAsk.ticketId !== null && agentRefused && material === 'ok'
    && !ticketNeeded('SEND', PERSON) && !ticketNeeded('INTRO_ASK', PERSON) && ticketNeeded('SEND', AUTONOMOUS)
    && (['MONEY', 'STAGE', 'ALLOCATION_EXCEPTION'] as const).every((k) => ticketNeeded(k, PERSON)),
    `person ask ticket ${asked.ticketId}, made: ${personMade.slice(0, 80)}; agent ask ticket ${Boolean(agentAsk.ticketId)}, made without approval refused: ${agentRefused}; material: ${material}`);

  // ── comms_ingest and comms_trace over MCP ─────────────────────────────────────────────
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { POST } = await import('../../app/api/mcp/route');
  resetWindows();
  const connect = async (secret: string) => {
    const c = new Client({ name: 'props-comms', version: '0' });
    await c.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3119/api/mcp'), {
      fetch: (u, init) => POST(new Request(u, init)), requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }));
    return c;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown>, meta: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args, _meta: meta })) as Result;
    const text = r.content.map((x) => x.text).join('\n');
    let data: any = null;
    try { data = JSON.parse(text).data; } catch { /* a refusal is plain text */ }
    return { error: r.isError ? text : null, data, text };
  };
  const writer = await connect(await token(juan, [OUTREACH_READ, OUTREACH_WRITE]));
  const reader = await connect(await token(juan, [OUTREACH_READ]));
  const juanEmail = (juan.email || 'juan@example.invalid').toLowerCase();
  const lp = await entity('Invented Comms Person', 'person');
  const p = await pursuit(lp, fund.id, 'connecting');
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('props:comms', 'Invented record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'lena@invented-comms.example', 'props:comms', current_date, 'medium')`, [lp]);
  // Affinity already has the email of 1 Oct from them, with Juan on it (no subject, no Message-ID: what Affinity keeps).
  await db.query(`insert into meetings.meeting (entity_id, channel, direction, held_on, owner_id, attendees, source, source_ref, about, about_vehicles, about_by)
    values ($1, 'email', 'theirs', '2026-10-01', $2, $3, 'affinity', 'interaction:email:props-1:person:1', 'other', '{}', 'rule')`, [lp, juan.id, [juan.name]]);
  const counts = async () => db.one<{ m: number; u: number; t: number; s: string; o: number }>(`select (select count(*)::int from meetings.meeting) m, (select count(*)::int from strategy.pursuit_update) u,
    (select count(*)::int from governance.approval_ticket) t, (select status::text from strategy.pursuit where pursuit_id = $1) s, (select count(*)::int from email.outreach_send) o`, [p]);
  const before = await counts();
  const batch = { messages: [
    { messageId: '<Props-1@Invented-Comms.example>', gmailMessageId: 'g-props-1', threadId: 'th-props', date: '2026-10-01T16:20:00Z', direction: 'received',
      from: 'lena@invented-comms.example', to: [juanEmail], subject: 'Invented: questions on the fund' },
    { messageId: '<props-2@invented-comms.example>', gmailMessageId: 'g-props-2', threadId: 'th-props', date: '2026-10-02T09:00:00Z', direction: 'sent',
      from: juanEmail, to: ['lena@invented-comms.example'], subject: 'Re: Invented: questions on the fund', pursuitId: p },
    { messageId: '<props-3@invented-comms.example>', gmailMessageId: 'g-props-3', date: '2026-10-02T10:00:00Z', direction: 'received',
      from: 'nobody@invented-unknown.example', to: [juanEmail], subject: 'Invented: unrelated' },
  ] };
  const i1 = await call(writer, 'comms_ingest', batch);
  const i2 = await call(writer, 'comms_ingest', batch);
  const roIngest = await call(reader, 'comms_ingest', batch);
  const after = await counts();
  const rows = await db.query<{ id: string; seen: number }>(`select message_id id, cardinality(seen_by) seen from email.comms_message where message_id like 'props-%@invented-comms.example' order by 1`);
  check('comms_ingest: idempotent by Message-ID (case and brackets aside); a message with nobody on record is not kept; it writes nothing else — no touchpoint, update, ticket, status or send; it needs outreach:write',
    !i1.error && i1.data?.new === 2 && i1.data.unmatched === 1 && i2.data?.new === 0 && i2.data.already === 2 && rows.length === 2 && rows[0]!.id === 'props-1@invented-comms.example'
    && JSON.stringify(before) === JSON.stringify(after) && /outreach:write/.test(roIngest.error ?? ''),
    `first ${JSON.stringify(i1.data ?? i1.error)?.slice(0, 120)}; again ${i2.data?.already} already; rows ${rows.map((r) => r.id).join(',')}; before ${JSON.stringify(before)} after ${JSON.stringify(after)}; read token: ${roIngest.error?.slice(0, 60)}`);

  const trace = await call(reader, 'comms_trace', { pursuitId: p });
  const emails = (trace.data?.items ?? []).filter((x: { kind: string }) => x.kind === 'email');
  const oct1 = emails.filter((x: { at: string }) => x.at.startsWith('2026-10-01'));
  check('comms_trace: one row per message — the Gmail message Affinity also has is merged with it, labelled by source and confidence; last touch and who owes a reply come from the trace',
    !trace.error && oct1.length === 1 && oct1[0].source === 'affinity' && oct1[0].sameAs?.[0]?.source === 'gmail' && oct1[0].sameAs[0].confidence === 'medium'
    && emails.some((x: { source: string; at: string }) => x.source === 'gmail' && x.at.startsWith('2026-10-02')) && trace.data.state.owes?.by === 'them'
    && trace.data.state.thread?.holder === juan.name && /Gmail message/.test(JSON.stringify(trace.text)),
    `${emails.length} emails: ${emails.map((x: { at: string; source: string; sameAs: unknown[] }) => `${x.at.slice(0, 10)} ${x.source}${x.sameAs.length ? '+' : ''}`).join(', ')}; owes ${trace.data?.state?.owes?.by}; holder ${trace.data?.state?.thread?.holder}${trace.error ? `; ${trace.error}` : ''}`);

  // ── An autonomous MCP call is refused a send link without an approved ticket; a person's is not ──
  const link = { pursuitId: p, gmailMessageId: 'g-props-4', messageId: '<props-4@invented-comms.example>', date: new Date().toISOString(), direction: 'sent',
    from: juanEmail, to: ['lena@invented-comms.example'], subject: 'Invented: the deck' };
  const auto = await call(writer, 'outreach_link_message', link, { autonomous: true });
  const human = await call(writer, 'outreach_link_message', link);
  const humanAgain = await call(writer, 'outreach_link_message', link);
  const autoAudit = await db.one<{ a: boolean }>(`select (detail->>'autonomous')::boolean a from platform.audit_log where action = 'mcp.call' and detail->>'tool' = 'outreach_link_message' and detail->>'outcome' = 'refused' order by id desc limit 1`);
  check('outreach_link_message over MCP: a call marked autonomous is refused without an approved ticket (and its audit says autonomous); the same link from a person is accepted, once',
    Boolean(auto.error) && /autonomous send needs an approved/i.test(auto.error ?? '') && autoAudit?.a === true && human.data?.linked === true && humanAgain.data?.already === true,
    `autonomous: ${auto.error?.slice(0, 80) ?? 'ALLOWED'}; audited autonomous ${autoAudit?.a}; person: ${human.data?.linked ?? human.error}; again ${humanAgain.data?.already ? 'already' : 'WROTE'}`);

  // ── A restriction is always surfaced ─────────────────────────────────────────────────
  const barredLp = await entity('Invented Comms Barred', 'person');
  const barredP = await pursuit(barredLp, fund.id, 'selected');
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'channel', 'Invented: not by email', $2)`, [barredLp, juan.id]);
  const q = await call(reader, 'outreach_queue', { vehicle: fund.slug, pursuitId: barredP });
  const r = q.data?.rows?.[0]?.checks?.find((c: { rule: string }) => c.rule === 'restriction');
  const viewer = await user('comms-viewer', 'viewer', null);
  const { outreachQueue } = await import('../../lib/outreach/reads');
  const { actAs } = await import('../../lib/auth/acting');
  const vr = (await actAs(viewer, () => outreachQueue(viewer, { vehicle: fund.slug, pursuitId: barredP }))).data.rows[0] as { checks: Array<{ rule: string; ok: boolean; detail: string }> } | undefined;
  const vRestriction = vr?.checks.find((c) => c.rule === 'restriction');
  check('Restrictions are always surfaced: the queue row carries the restriction as a failing, blocking check — with its words for those who may read them, and still flagged, reason withheld, for those who may not',
    r?.ok === false && r.blocking === true && /not by email/i.test(r.detail) && q.data.rows[0].bucket === 'held'
    && vRestriction?.ok === false && !/not by email/i.test(vRestriction.detail) && /restriction is on file/i.test(vRestriction.detail),
    `GP: ${JSON.stringify(r)?.slice(0, 100)}; viewer: ${JSON.stringify(vRestriction)?.slice(0, 100)}`);
  for (const c of [writer, reader]) await c.close();
}
