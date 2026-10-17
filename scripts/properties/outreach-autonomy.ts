/**
 * Autonomy and the agent-only gates at send time (red team, 17 Oct 2026; rule 3, docs/27 §10 item 6), through the real
 * REST handler, on invented data:
 *   - a token marked autonomous (Preferences' opt-in, `mode:autonomous`) is autonomous on every call without the header;
 *     an unmarked token is unchanged — a person's call, autonomous only when the call says so;
 *   - a firm do-not-contact recorded after an approval refuses the autonomous send to that person at record time, and
 *     ending tickets for it reaches what barredRecipients bars (a firm's people, an Affinity address, an intro's connector);
 *   - every autonomous SEND clears the send gate, attachment or not: a grants funder with no invitation is refused;
 *   - the queue's wrap check reads the instrument the LP holds on the vehicle, as its materials do.
 */
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

export async function outreachAutonomyProperties(check: Check, db: Db) {
  const { resetWindows, envelopeFor, AUTONOMOUS_MARK } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { decideTicket, expireOutreachTicketsFor } = await import('../../modules/governance');
  resetWindows();
  const call = await outreachClient();
  const { juan, fund, token, entity, pursuit } = await fixtures(db);
  const plain = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
  const marked = await token(juan, [OUTREACH_READ, OUTREACH_WRITE, AUTONOMOUS_MARK]);
  const post = (op: string, body: unknown, secret = plain) => call(secret, op, {}, { method: 'POST', body });
  const agent = (op: string, body: unknown, secret = plain) => call(secret, op, {}, { method: 'POST', body, headers: { 'x-autonomous': '1' } });
  const sendBody = (pursuitId: string, recipients: string[]) => ({ kind: 'SEND', pursuitId, scope: { recipients, purpose: 'invite' } });
  let n = 0;
  const msg = (pursuitId: string, to: string[], extra: Record<string, unknown> = {}) => ({ pursuitId, gmailMessageId: `gmail-autonomy-${++n}`,
    messageId: `<props-autonomy-${n}@invented.example>`, date: new Date(Date.now() + 1000).toISOString(), direction: 'sent',
    from: juan.email || 'juan@example.invalid', to, subject: 'Invented invitation', ...extra });

  // ── A marked token is autonomous without the header; an unmarked one is unchanged ──────────
  const rows = await db.query<{ tools: string[]; token_id: string }>(`select tools, token_id::text from platform.mcp_token where user_id = $1 order by created_at desc limit 2`, [juan.id]);
  const markedRow = rows.find((r) => r.tools.includes(AUTONOMOUS_MARK)), plainRow = rows.find((r) => !r.tools.includes(AUTONOMOUS_MARK));
  const asToken = (r: { tools: string[]; token_id: string }) => ({ tokenId: r.token_id, userId: juan.id, label: 'x', prefix: 'x', tools: r.tools, vehicles: null, callsPerDay: 1,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), lastUsedAt: null, lastUsedFrom: null, revokedAt: null }) as never;
  const lpA = await pursuit(await entity('Invented Autonomy Marked Org'), fund.id, 'selected');
  const byMarked = await post('tickets', sendBody(lpA, ['a@invented-autonomy.example']), marked);
  const byPlain = await post('tickets', sendBody(lpA, ['a@invented-autonomy.example']), plain);
  const plainAgent = await agent('tickets', sendBody(lpA, ['b@invented-autonomy.example']), plain);
  const markedLink = await post('link', msg(lpA, ['c@invented-autonomy.example']), marked);
  const plainLink = await post('link', msg(lpA, ['c@invented-autonomy.example']), plain);
  check('Autonomy: a token marked autonomous is autonomous on every call without the header (a SEND opens a ticket, an unticketed send is refused); an unmarked token stays a person\'s unless the call says otherwise',
    Boolean(markedRow && plainRow) && envelopeFor(asToken(markedRow!), juan).autonomous === true && envelopeFor(asToken(plainRow!), juan).autonomous === false
    && byMarked.status === 200 && typeof byMarked.json?.data?.ticketId === 'string' && byPlain.status === 200 && byPlain.json?.data?.opened === false
    && plainAgent.status === 200 && typeof plainAgent.json?.data?.ticketId === 'string'
    && markedLink.status === 409 && /autonomous send needs/i.test(markedLink.json?.error ?? '') && plainLink.status === 200,
    `marked ticket ${byMarked.status} ${byMarked.json?.data?.ticketId ? 'opened' : byMarked.json?.error ?? 'NONE'}; plain ${byPlain.status} opened ${byPlain.json?.data?.opened}; plain+header ${plainAgent.status}; marked link ${markedLink.status}; plain link ${plainLink.status}${plainLink.json?.error ? ` (${plainLink.json.error})` : ''}`);

  // ── A firm DNC after the approval refuses the autonomous send, and ends the ticket ──────────
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('affinity:props-autonomy', 'Invented record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  const dncPerson = await entity('Invented Autonomy DNC Person', 'person');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'dnc@invented-autonomy.example', 'affinity:props-autonomy', current_date, 'medium')`, [dncPerson]);
  const lpD = await pursuit(dncPerson, fund.id, 'selected');
  const tD = (await agent('tickets', sendBody(lpD, ['dnc@invented-autonomy.example']))).json?.data?.ticketId as string | undefined;
  if (tD) await decideTicket(juan.id, tD, 'approve', 'props');
  // Recorded after the approval, by a path that ends nothing itself (a person on the LP page, a seed).
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'Invented: do not approach', $2)`, [dncPerson, juan.id]);
  const afterDnc = await agent('link', msg(lpD, ['dnc@invented-autonomy.example'], { ticketId: tD }));
  const stillUnused = await db.one<{ unused: boolean }>('select sent_at is null unused from email.outreach_send where ticket_id = $1', [tD ?? null]);
  const endedD = await expireOutreachTicketsFor(db, dncPerson);
  const expiredD = await db.one<{ gone: boolean }>('select expires_at <= now() gone from governance.approval_ticket where id = $1', [tD ?? null]);
  check('Autonomy: a firm do-not-contact recorded after the approval refuses the autonomous record of the send to that person, leaves the ticket unused, and ending tickets for it expires that one',
    Boolean(tD) && afterDnc.status === 409 && /restriction/i.test(afterDnc.json?.error ?? '') && stillUnused?.unused === true && endedD >= 1 && expiredD?.gone === true,
    `ticket ${tD ? 'opened' : 'NONE'}; link after ${afterDnc.status} ${afterDnc.json?.error?.slice(0, 80) ?? ''}; unused ${stillUnused?.unused}; ended ${endedD}, expired ${expiredD?.gone}`);

  // The same matching as barredRecipients: a firm's restriction reaches its person's Affinity address, on another LP's ticket.
  const firm = await entity('Invented Autonomy Restricted Firm');
  const staff = await entity('Invented Autonomy Firm Staff', 'person');
  await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, source, as_of, certainty, is_primary) values ($1, $2, 'staff', 'Invented', 'fixture', now(), 'inferred', true)`, [staff, firm]);
  await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by) values ('affinity', 'person:77005511', $1, 'rule:fixture') on conflict do nothing`, [staff]);
  await db.query(`insert into sources.raw_record (source, kind, source_id, payload_hash, payload) values ('affinity', 'person', '77005511', 'props-autonomy-staff', $1) on conflict do nothing`,
    [JSON.stringify({ id: 77005511, firstName: 'Invented', lastName: 'Staff', primaryEmailAddress: 'staff@invented-autonomy-firm.example', emailAddresses: ['staff@invented-autonomy-firm.example'] })]);
  const lpF = await pursuit(await entity('Invented Autonomy Other LP'), fund.id, 'selected');
  const tF = (await agent('tickets', sendBody(lpF, ['Staff@Invented-Autonomy-Firm.example']))).json?.data?.ticketId as string | undefined;
  if (tF) await decideTicket(juan.id, tF, 'approve', 'props');
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'Invented: firm declines contact', $2)`, [firm, juan.id]);
  const firmLink = await agent('link', msg(lpF, ['staff@invented-autonomy-firm.example'], { ticketId: tF }));
  const endedF = await expireOutreachTicketsFor(db, firm);
  const expiredF = await db.one<{ gone: boolean }>('select expires_at <= now() gone from governance.approval_ticket where id = $1', [tF ?? null]);
  check('Autonomy: a firm\'s restriction refuses an autonomous send to its person\'s Affinity address on another LP\'s ticket, and ending tickets for the firm expires it',
    Boolean(tF) && firmLink.status === 409 && /restriction/i.test(firmLink.json?.error ?? '') && endedF >= 1 && expiredF?.gone === true,
    `ticket ${tF ? 'opened' : 'NONE'}; link ${firmLink.status} ${firmLink.json?.error?.slice(0, 80) ?? ''}; ended ${endedF}, expired ${expiredF?.gone}`);
  await db.query(`delete from sources.raw_record where source = 'affinity' and payload_hash = 'props-autonomy-staff'`);
  await db.query(`delete from identity.source_record where source = 'affinity' and source_id = 'person:77005511'`);

  // ── Every autonomous SEND clears the send gate: a grants funder needs an invitation ──────────
  const grants = await db.one<{ id: string }>(`select id::text from platform.vehicle where kind = 'grant_rail' order by sort_order limit 1`);
  if (!grants) {
    check('Autonomy: a plain autonomous SEND to a grants funder with no invitation is refused (no grants rail in the seed: skipped)', true, 'no grant_rail vehicle');
  } else {
    const funderE = await entity('Invented Autonomy Funder');
    const lpG = await pursuit(funderE, grants.id, 'selected');
    const funder = (await db.one<{ id: string }>(`insert into grants.funder (entity_id, programme, status) values ($1, 'Invented autonomy programme', 'sourced') returning funder_id::text id`, [funderE]))!.id;
    const noInvite = await agent('tickets', sendBody(lpG, ['grants@invented-funder.example']));
    const personAsks = await post('tickets', sendBody(lpG, ['grants@invented-funder.example']));
    await db.query(`update grants.funder set status = 'invited', invitation_ref = 'invented-autonomy-ref', invited_on = current_date where funder_id = $1`, [funder]);
    const invited = await agent('tickets', sendBody(lpG, ['grants@invented-funder.example']));
    await db.query(`delete from grants.funder where funder_id = $1`, [funder]);
    // The desk's queue covers fund and SPV vehicles only, so past the gate a grants-rail SEND still ends at "not in the
    // queue"; what this checks is that the invitation, not the attachment, decides the gate.
    check('Autonomy: a plain autonomous SEND (no attachment) to a grants funder with no invitation is refused by the grants gate; with an invitation on file the gate passes it; a person\'s request is not gated',
      noInvite.status === 409 && /invitation/i.test(noInvite.json?.error ?? '') && !/invitation/i.test(invited.json?.error ?? '') && personAsks.status !== 409,
      `no invitation ${noInvite.status} ${noInvite.json?.error?.slice(0, 80) ?? ''}; invited ${invited.status} ${invited.json?.error?.slice(0, 80) ?? 'ok'}; person ${personAsks.status}`);
  }

  // ── The queue's wrap check follows the held instrument ───────────────────────────────────────
  const { checkWrap } = await import('../../modules/content');
  const v = (await db.one<{ exemption: string }>('select exemption from platform.vehicle where id = $1', [fund.id]))!;
  const covered = async (i: string) => (await checkWrap({ exemption: v.exemption, instrument: i, audience: 'lp_memo', permittedUse: 'internal' })).rule !== null;
  const base = await covered('lp_commitment');
  let other = 'direct';
  for (const i of ['spv', 'grant', 'pri', 'mri', 'direct']) if ((await covered(i)) !== base) { other = i; break; }
  const holder = await entity('Invented Autonomy Holder Org');
  const lpH = await pursuit(holder, fund.id, 'discussing');
  await db.query(`insert into pipeline.exposure (entity_id, vehicle_id, owner_id, instrument, track, amount) values ($1, $2, $3, $4::pipeline.instrument, 'soft', 1000)`, [holder, fund.id, juan.id, other]);
  const lpPlain = await pursuit(await entity('Invented Autonomy No Holding Org'), fund.id, 'discussing');
  const wrapOf = async (pid: string) => ((await call(plain, 'queue', { vehicle: fund.slug, pursuitId: pid })).json?.data?.rows?.[0]?.checks ?? [])
    .find((c: { rule: string }) => c.rule === 'wrap') as { ok: boolean; agentOnly?: boolean; detail: string } | undefined;
  const heldWrap = await wrapOf(lpH), plainWrap = await wrapOf(lpPlain);
  const otherCovered = await covered(other);
  check('Autonomy: the queue\'s wrap check reads the instrument the LP holds on the vehicle (as its materials do), not the vehicle kind\'s',
    !!heldWrap && heldWrap.detail.includes(`× ${other}`) && heldWrap.ok === otherCovered && heldWrap.agentOnly === !otherCovered
    && !!plainWrap && plainWrap.detail.includes('× lp_commitment') && plainWrap.ok === base,
    `held ${other} (covered ${otherCovered}): ${JSON.stringify(heldWrap)?.slice(0, 140)}; none (covered ${base}): ${JSON.stringify(plainWrap)?.slice(0, 100)}`);
}
