/**
 * The outreach API's write path (docs/27-outreach-api.md §3–5), through the real route handler, on invented
 * data: the update box's own service, once per key; since 5 Oct 2026 a ticket only for an autonomous call — a
 * person's asks for one and gets the checks back, nothing opened — opened for a person to approve and never
 * approved by the desk; an autonomous send linked only against an approved, unexpired, unused ticket for that LP
 * and those recipients, once; advisory fund-before-SPV recorded with a dated follow-up; a restriction refuses an
 * agent and is surfaced to a person; contacts keep their source and never overwrite another source's address.
 */
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

export async function outreachWriteProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { decideTicket } = await import('../../modules/governance');
  resetWindows();
  const call = await outreachClient();
  const { juan, fund, spv, token, entity, pursuit } = await fixtures(db);
  const rw = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
  const ro = await token(juan, [OUTREACH_READ]);
  const desk = (await db.one<{ id: string; active: boolean }>(`select id::text, active from platform.app_user where handle = 'mail-desk'`))!;
  const post = (op: string, body: unknown, secret = rw) => call(secret, op, {}, { method: 'POST', body });
  // An autonomous call: no person in the loop (X-Autonomous: 1). Only these need, or open, a ticket.
  const agent = (op: string, body: unknown, secret = rw) => call(secret, op, {}, { method: 'POST', body, headers: { 'x-autonomous': '1' } });
  const today = new Date().toISOString().slice(0, 10);

  // ── update ────────────────────────────────────────────────────────────────────────────
  const lp = await entity('Invented Outreach Writer Org');
  const onFund = await pursuit(lp, fund.id, 'connecting');
  const body = { pursuitId: onFund, words: 'Call today: they are thinking $1M-2M. Next: send the deck.', idempotencyKey: 'props-desk-update-1',
    applied: { status: { to: 'discussing' }, touch: { channel: 'call', on: today }, nextStep: { step: 'Send the deck' }, indicated: { low: 1e6, high: 2e6 } } };
  const u1 = await post('update', body), u2 = await post('update', body), uRo = await post('update', { ...body, idempotencyKey: 'props-desk-update-2' }, ro);
  const after = await db.one<{ status: string; updates: number; ind: number; touches: number }>(`select p.status::text,
    (select count(*)::int from strategy.pursuit_update where pursuit_id = p.pursuit_id) updates,
    (select count(*)::int from pipeline.indication where pursuit_id = p.pursuit_id) ind,
    (select count(*)::int from meetings.meeting where pursuit_id = p.pursuit_id) touches from strategy.pursuit p where p.pursuit_id = $1`, [onFund]);
  check('Outreach writes: /update is the update box\'s own service — status, touchpoint, next step and indicated amount in one, once per key; a read token cannot',
    u1.status === 200 && u1.json.data.created === true && u2.status === 200 && u2.json.data.created === false && uRo.status === 403
    && after?.status === 'discussing' && after.updates === 1 && after.ind === 1 && after.touches === 1 && u1.json.data.applied.indicated?.touchpointId === u1.json.data.applied.touchpointId,
    `first ${u1.status} (created ${u1.json?.data?.created}${u1.json?.error ? `, ${u1.json.error}` : ''}), again ${u2.status} (created ${u2.json?.data?.created}), read token ${uRo.status}; status ${after?.status}, ${after?.updates} update, ${after?.ind} indication, ${after?.touches} touchpoint`);

  // An autonomous /update may tick every box (Juan, 17 Oct 2026), an amount too; its words say it was the mail desk's.
  const uAgent = await agent('update', { ...body, idempotencyKey: 'props-desk-update-agent' });
  const indAfter = await db.one<{ n: number; body: string }>(`select count(*)::int n, max(u.body) filter (where u.body like 'By the mail desk%') body
    from pipeline.indication i join strategy.pursuit_update u on u.update_id = i.update_id where i.pursuit_id = $1`, [onFund]);
  check('Outreach writes: an autonomous /update carrying an indicated amount records it, its update marked as the mail desk\'s (17 Oct 2026)',
    uAgent.status === 200 && indAfter?.n === 2 && !!indAfter.body, `autonomous ${uAgent.status}${uAgent.json?.error ? ` (${uAgent.json.error})` : ''}; ${indAfter?.n} indications`);

  // ── tickets: none for a person; opened for an agent, for a person to approve, never approved by the desk ──
  const sendBody = (pursuitId: string, extra: Record<string, unknown> = {}) =>
    ({ kind: 'SEND', pursuitId, scope: { recipients: ['Partner@Invented-Writer.example'], purpose: 'invite' }, ...extra });
  const person = await post('tickets', sendBody(onFund));
  const personTickets = await db.one<{ n: number }>('select count(*)::int n from email.outreach_send where pursuit_id = $1', [onFund]);
  const t1 = await agent('tickets', sendBody(onFund));
  const ticketId = t1.json?.data?.ticketId as string;
  const ticket = ticketId ? await db.one<{ requested_by: string; decision: string | null; kind: string }>('select requested_by::text, decision::text, kind::text from governance.approval_ticket where id = $1', [ticketId]) : null;
  const approveOp = await post('approve', { ticketId });
  let deskDecided = false;
  try { await decideTicket(desk.id, ticketId, 'approve', null); deskDecided = true; } catch { /* refused, as it must be */ }
  const stillOpen = ticketId ? await db.one<{ decision: string | null }>('select decision::text from governance.approval_ticket where id = $1', [ticketId]) : null;
  check('Outreach writes: a person asking for a ticket gets the checks back and nothing is opened (5 Oct 2026); an autonomous call\'s ticket is opened for a person to approve — requested by the inactive Mail desk actor, never approved by the desk; no API op decides one',
    person.status === 200 && person.json.data.opened === false && person.json.data.needed === false && Array.isArray(person.json.data.checks) && personTickets?.n === 0
    && t1.status === 200 && ticket?.kind === 'SEND' && ticket.decision === null && ticket.requested_by === desk.id && desk.active === false
    && approveOp.status === 404 && !deskDecided && stillOpen?.decision === null,
    `person: ${person.status} opened ${person.json?.data?.opened}, ${personTickets?.n} sends asked; agent: ${t1.status}${t1.json?.error ? ` (${t1.json.error})` : ''}; requester is the desk actor: ${ticket?.requested_by === desk.id}; /approve ${approveOp.status}; the desk actor deciding: ${deskDecided ? 'ALLOWED' : 'refused'}; still ${stillOpen?.decision ?? 'undecided'}`);

  // ── link: an autonomous send against its approved, unexpired, unused ticket, once; a person's needs none ──
  let n = 0;
  const msg = (extra: Record<string, unknown> = {}) => ({ pursuitId: onFund, gmailMessageId: `gmail-invented-${++n}`, messageId: `<props-link-${n}@invented.example>`,
    date: new Date().toISOString(), direction: 'sent', from: juan.email || 'juan@example.invalid', to: ['partner@invented-writer.example'], subject: 'Invented invitation', ...extra });
  const early = await agent('link', msg({ ticketId }));
  const unticketed = await agent('link', msg());
  if (ticketId) await decideTicket(juan.id, ticketId, 'approve', 'props');
  const outside = await agent('link', msg({ ticketId, to: ['someone-else@invented.example'] }));
  const otherLp = await pursuit(await entity('Invented Outreach Other Org'), fund.id, 'selected');
  const wrongLp = await agent('link', msg({ ticketId, pursuitId: otherLp }));
  const good = msg({ ticketId });
  const ok1 = await agent('link', good), ok2 = await agent('link', good), another = await agent('link', msg({ ticketId }));
  const row = await db.one<{ sent: boolean; gmail: string; touch: string | null }>('select sent_at is not null sent, gmail_message_id gmail, touchpoint_id::text touch from email.outreach_send where ticket_id = $1', [ticketId]);
  const t2 = await agent('tickets', sendBody(otherLp, { scope: { recipients: ['a@invented-other.example'], purpose: 'reply' } }));
  const t2id = t2.json?.data?.ticketId as string | undefined;
  if (t2id) {
    await decideTicket(juan.id, t2id, 'approve', 'props');
    await db.query(`update governance.approval_ticket set expires_at = now() - interval '1 hour' where id = $1`, [t2id]);
  }
  const expired = await agent('link', msg({ ticketId: t2id, pursuitId: otherLp, to: ['a@invented-other.example'] }));
  check('Outreach writes: an autonomous send is linked only against an approved, unexpired SEND ticket for that LP and those recipients — once, idempotent for the same message — and none without one',
    early.status === 409 && unticketed.status === 409 && outside.status === 409 && wrongLp.status === 409 && ok1.status === 200 && ok1.json.data.linked === true && ok1.json.data.ticketUsed === true
    && ok2.status === 200 && ok2.json.data.linked === false && ok2.json.data.already === true && another.status === 409
    && row?.sent === true && row.gmail === good.gmailMessageId && row.touch === null && expired.status === 409,
    `before approval ${early.status}; no ticket ${unticketed.status}; outside recipient ${outside.status}; another LP ${wrongLp.status}; linked ${ok1.status}/${ok1.json?.data?.linked}${ok1.json?.error ? ` (${ok1.json.error})` : ''}; same message again ${ok2.status}/${ok2.json?.data?.already ? 'already' : 'WROTE'}; a second message ${another.status}; expired ${expired.status}; touchpoint ${row?.touch ? 'CREATED' : 'none'}`);

  // A person links without a ticket, and nothing but the link is written: no touchpoint, status, rung or ticket.
  const before = await db.one<{ s: string; m: number; u: number; t: number }>(`select p.status::text s, (select count(*)::int from meetings.meeting where pursuit_id = p.pursuit_id) m,
    (select count(*)::int from strategy.pursuit_update where pursuit_id = p.pursuit_id) u, (select count(*)::int from governance.approval_ticket) t from strategy.pursuit p where p.pursuit_id = $1`, [onFund]);
  const pm = msg({ to: ['someone-new@invented-writer.example'] });
  const p1 = await post('link', pm), p2 = await post('link', pm);
  const theirs = await post('link', msg({ direction: 'received', from: 'partner@invented-writer.example', to: [juan.email || 'juan@example.invalid'] }));
  const after2 = await db.one<{ s: string; m: number; u: number; t: number }>(`select p.status::text s, (select count(*)::int from meetings.meeting where pursuit_id = p.pursuit_id) m,
    (select count(*)::int from strategy.pursuit_update where pursuit_id = p.pursuit_id) u, (select count(*)::int from governance.approval_ticket) t from strategy.pursuit p where p.pursuit_id = $1`, [onFund]);
  const audits = await db.one<{ n: number }>(`select count(*)::int n from platform.audit_log where action = 'outreach.message_linked' and detail->>'pursuitId' = $1`, [onFund]);
  check('Outreach writes: a person\'s link needs no ticket, is idempotent by Message-ID, and creates no outreach state — no touchpoint, status, update or ticket; each link is audited',
    p1.status === 200 && p1.json.data.linked === true && p1.json.data.ticketUsed === false && p2.json?.data?.already === true && theirs.status === 200
    && JSON.stringify(before) === JSON.stringify(after2) && audits?.n === 3,
    `person ${p1.status}${p1.json?.error ? ` (${p1.json.error})` : ''}, again ${p2.json?.data?.already ? 'already' : 'WROTE'}, received ${theirs.status}; before ${JSON.stringify(before)} after ${JSON.stringify(after2)}; ${audits?.n} link audits`);

  // ── fund before SPV: advisory, recorded with a dated follow-up ─────────────────────────
  const both = await entity('Invented Outreach Overlap Org');
  await pursuit(both, fund.id, 'discussing');
  const onSpv = await pursuit(both, spv.id, 'selected');
  const asked = await agent('tickets', sendBody(onSpv));
  const separately = await agent('tickets', sendBody(onSpv, { coordination: { choice: 'send_separately' } }));
  const both2 = await entity('Invented Outreach Waiting Org');
  await pursuit(both2, fund.id, 'committed');
  const waitP = await pursuit(both2, spv.id, 'selected');
  const wait = await agent('tickets', sendBody(waitP, { coordination: { choice: 'wait', followUpOn: '2026-12-01' } }));
  const both3 = await entity('Invented Outreach Person Overlap Org');
  await pursuit(both3, fund.id, 'discussing');
  const personSpv = await pursuit(both3, spv.id, 'selected');
  const personBoth = await post('tickets', sendBody(personSpv, { coordination: { choice: 'mention_both', followUpOn: '2026-12-02' } }));
  const overlaps = await db.query<{ choice: string; follow: string; ticket: string | null }>(`select choice, follow_up_on::text follow, ticket_id::text ticket from coordination.overlap
    where entity_id in ($1, $2, $3) order by recorded_at`, [both, both2, both3]);
  const waitSends = await db.one<{ n: number }>('select count(*)::int n from email.outreach_send where pursuit_id = $1', [waitP]);
  check('Outreach writes: fund-before-SPV is advisory — the agent says how, the SPV ticket opens (or waits); a person\'s choice is recorded too; each overlap with a dated follow-up (rule 5)',
    asked.status === 409 && /coordination\.choice/.test(asked.json?.error ?? '') && separately.status === 200 && separately.json.data.opened === true
    && wait.status === 200 && wait.json.data.opened === false && waitSends?.n === 0 && personBoth.status === 200 && personBoth.json.data.opened === false
    && overlaps.length === 3 && overlaps.every((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.follow)) && overlaps[0]!.ticket === separately.json.data.ticketId && overlaps[1]!.follow === '2026-12-01'
    && overlaps[2]!.ticket === null && overlaps[2]!.follow === '2026-12-02',
    `no choice: ${asked.status}; send separately: ${separately.status} (opened ${separately.json?.data?.opened}${separately.json?.error ? `, ${separately.json.error}` : ''}); wait: opened ${wait.json?.data?.opened}; person: ${personBoth.status}; overlaps ${overlaps.map((o) => `${o.choice}→${o.follow}`).join(', ')}`);

  // ── A restriction: refuses an agent's ticket; surfaced, in the checks, to a person ─────
  const barred = await entity('Invented Outreach Barred Org');
  const barredP = await pursuit(barred, fund.id, 'selected');
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'Invented: do not approach', $2)`, [barred, juan.id]);
  const refused = await agent('tickets', sendBody(barredP));
  const shown = await post('tickets', sendBody(barredP));
  const flag = (shown.json?.data?.checks ?? []).find((c: { rule: string }) => c.rule === 'restriction');
  const none = await db.one<{ n: number }>('select count(*)::int n from email.outreach_send where pursuit_id = $1', [barredP]);
  check('Outreach writes: a do-not-approach restriction refuses an agent\'s ticket (none opened) and is surfaced to a person as a blocking check, never skipped',
    refused.status === 409 && none?.n === 0 && shown.status === 200 && flag?.ok === false && flag.blocking === true && /do not approach/i.test(flag.detail),
    `agent ${refused.status}: ${String(refused.json?.error).slice(0, 80)}; person: ${shown.status}, restriction ${JSON.stringify(flag)?.slice(0, 120)}`);

  // ── INTRO_ASK through the routes page's own service ───────────────────────────────────
  const connector = await entity('Invented Outreach Connector', 'person');
  const introLp = await pursuit(await entity('Invented Outreach Intro Org'), fund.id, 'selected');
  const intro = await agent('tickets', { kind: 'INTRO_ASK', pursuitId: introLp, connectorId: connector, scope: { purpose: 'invite' } });
  const ask = intro.json?.data?.askId ? await db.one<{ owner: string; ticket: string; requester: string }>(`select a.owner_id::text owner, a.ticket_id::text ticket, t.requested_by::text requester
    from coordination.ask a join governance.approval_ticket t on t.id = a.ticket_id where a.ask_id = $1`, [intro.json.data.askId]) : null;
  check('Outreach writes: an agent\'s INTRO_ASK goes through the routes page\'s own service — an ask owned by the person, its ticket requested by the desk',
    intro.status === 200 && ask?.owner === juan.id && ask.requester === desk.id && ask.ticket === intro.json.data.ticketId,
    `${intro.status}${intro.json?.error ? ` (${intro.json.error})` : ''}; ask owner is the token's owner: ${ask?.owner === juan.id}; requester is the desk: ${ask?.requester === desk.id}`);

  // ── contacts ──────────────────────────────────────────────────────────────────────────
  const personE = await entity('Invented Outreach Person', 'person');
  const personP = await pursuit(personE, fund.id, 'selected');
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('affinity:props-outreach', 'Invented Affinity record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'old@invented-person.example', 'affinity:props-outreach', current_date, 'medium')`, [personE]);
  const c1 = await post('contacts', { entityId: personE, email: 'New@Invented-Person.example', source: 'gmail', confirmedBy: 'juan' });
  const c2 = await post('contacts', { entityId: personE, email: 'new@invented-person.example', source: 'gmail', confirmedBy: 'juan' });
  const cOther = await post('contacts', { entityId: personE, email: 'x@invented-person.example', source: 'gmail', confirmedBy: 'mara' });
  const claims = await db.query<{ value: string; source: string; superseded: boolean; verified: boolean }>(`select value, source, superseded_by is not null superseded, last_verified_at is not null verified
    from research.claim where entity_id = $1 order by created_at`, [personE]);
  const affinityKept = claims.find((c) => c.source === 'affinity:props-outreach');
  const gmail = claims.filter((c) => c.source === 'gmail:juan');
  check('Outreach writes: /contacts keeps the address with its source and confirmation date, never overwrites an Affinity address, and supersedes only its own earlier confirmation',
    c1.status === 200 && c1.json.data.kept?.[0]?.source === 'affinity' && c2.status === 200 && cOther.status === 403
    && affinityKept?.superseded === false && gmail.length === 2 && gmail.filter((c) => !c.superseded).length === 1 && gmail.every((c) => c.verified && c.value === 'new@invented-person.example'),
    `first ${c1.status}${c1.json?.error ? ` (${c1.json.error})` : ''} (kept ${JSON.stringify(c1.json?.data?.kept)}), again ${c2.status}, confirmed by someone else ${cOther.status}; Affinity's ${affinityKept?.superseded ? 'OVERWRITTEN' : 'kept'}; gmail claims ${gmail.length}, current ${gmail.filter((c) => !c.superseded).length}`);
  // JuanMail holds pursuit ids (7 Oct 2026): the pursuit names the LP instead of the entity; one of the two, never both.
  const byPursuit = await post('contacts', { pursuitId: personP, email: 'pursuit@invented-person.example', source: 'gmail', confirmedBy: 'juan' });
  const bothIds = await post('contacts', { pursuitId: personP, entityId: personE, email: 'both@invented-person.example', source: 'gmail', confirmedBy: 'juan' });
  const neither = await post('contacts', { email: 'neither@invented-person.example', source: 'gmail', confirmedBy: 'juan' });
  const unknownPursuit = await post('contacts', { pursuitId: '00000000-0000-4000-8000-000000000000', email: 'none@invented-person.example', source: 'gmail', confirmedBy: 'juan' });
  check('Outreach writes: /contacts takes a pursuitId in place of the entityId and records the address on that LP; both, neither or an unknown pursuit is refused',
    byPursuit.status === 200 && byPursuit.json.data.entityId === personE && bothIds.status === 400 && neither.status === 400 && unknownPursuit.status === 404,
    `pursuit ${byPursuit.status}${byPursuit.json?.error ? ` (${byPursuit.json.error})` : ''} → ${byPursuit.json?.data?.entityId === personE ? 'that LP' : 'ANOTHER'}; both ${bothIds.status}; neither ${neither.status}; unknown ${unknownPursuit.status}`);

  // Red-team pass, 14 Oct 2026: a person's link names no ticket, so it leaves an agent's open ticket for the agent's own
  // email; and an agent cannot skip a ticket by linking our own mail as received.
  const lpT = await pursuit(await entity('Invented Outreach Ticket Keeper Org'), fund.id, 'selected');
  const t3 = (await agent('tickets', sendBody(lpT, { scope: { recipients: ['keeper@invented-writer.example'], purpose: 'reply' } }))).json?.data?.ticketId as string | undefined;
  if (t3) await decideTicket(juan.id, t3, 'approve', 'props');
  const personLink = await post('link', msg({ pursuitId: lpT, to: ['keeper@invented-writer.example'] }));
  const keptOpen = await db.one<{ open: boolean }>('select sent_at is null open from email.outreach_send where ticket_id = $1', [t3]);
  const agentLink = await agent('link', msg({ pursuitId: lpT, ticketId: t3, to: ['keeper@invented-writer.example'] }));
  const disguised = juan.email ? await agent('link', msg({ pursuitId: lpT, direction: 'received', from: juan.email, to: ['keeper@invented-writer.example'] })) : null;
  // A do-not-contact recorded after the approval ends the ticket: the agent's send is no longer covered.
  const lpR = await pursuit(await entity('Invented Outreach Restricted Org'), fund.id, 'selected');
  const t4 = (await agent('tickets', sendBody(lpR, { scope: { recipients: ['restricted@invented-writer.example'], purpose: 'reply' } }))).json?.data?.ticketId as string | undefined;
  if (t4) await decideTicket(juan.id, t4, 'approve', 'props');
  const { expireOutreachTicketsFor } = await import('../../modules/governance');
  const ended = await expireOutreachTicketsFor(db, (await db.one<{ e: string }>('select entity_id::text e from strategy.pursuit where pursuit_id = $1', [lpR]))!.e);
  const afterDnc = await agent('link', msg({ pursuitId: lpR, ticketId: t4, to: ['restricted@invented-writer.example'] }));
  check('Outreach writes: a do-not-contact recorded after an approval ends that LP\'s open SEND ticket, and the agent\'s send is refused',
    Boolean(t4) && ended === 1 && afterDnc.status === 409, `ticket ${t4 ? 'opened' : 'NONE'}; ended ${ended}; agent link after ${afterDnc.status}`);
  // Rule 8 attaches to the person addressed, not only to the LP (red team, 17 Oct 2026): a restricted contact at an
  // unrestricted firm is refused to an agent, shown blocking to a person, and a restriction recorded later ends the ticket.
  const contactP = await entity('Invented Barred Contact', 'person'), laterP = await entity('Invented Later Contact', 'person');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'barred@invented-writer.example', 'affinity:props-outreach', current_date, 'medium'),
    ($2, 'email', 'later@invented-writer.example', 'affinity:props-outreach', current_date, 'medium')`, [contactP, laterP]);
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'channel', 'Invented: not by email', $2)`, [contactP, juan.id]);
  const lpC = await pursuit(await entity('Invented Outreach Contact Firm'), fund.id, 'selected');
  const toBarred = await agent('tickets', sendBody(lpC, { scope: { recipients: ['Barred@Invented-Writer.example'], purpose: 'invite' } }));
  const personSees = await post('tickets', sendBody(lpC, { scope: { recipients: ['barred@invented-writer.example'], purpose: 'invite' } }));
  const seen = (personSees.json?.data?.checks ?? []) as Array<{ rule: string; ok: boolean; blocking: boolean; detail: string }>;
  const t5 = (await agent('tickets', sendBody(lpC, { scope: { recipients: ['later@invented-writer.example'], purpose: 'invite' } }))).json?.data?.ticketId as string | undefined;
  if (t5) await decideTicket(juan.id, t5, 'approve', 'props');
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'Invented: do not approach', $2)`, [laterP, juan.id]);
  const endedLater = await expireOutreachTicketsFor(db, laterP);
  check('Outreach writes: a restricted contact at an unrestricted firm is refused to an agent and shown blocking to a person; a restriction recorded later ends a ticket addressed to them',
    toBarred.status === 409 && /restriction/i.test(toBarred.json?.error ?? '') && personSees.status === 200
      && seen.some((c) => c.rule === 'restriction' && !c.ok && c.blocking && /Invented Barred Contact/.test(c.detail)) && Boolean(t5) && endedLater === 1,
    `agent ${toBarred.status}; person sees ${JSON.stringify(seen.filter((c) => c.rule === 'restriction').map((c) => c.blocking))}; later ticket ${t5 ? 'opened' : 'NONE'}, ended ${endedLater}`);
  {
    // The Materials page's send (red team, 17 Oct 2026): the instrument is the target's, a restriction and the grants gate refuse.
    const { sendGate } = await import('../../lib/outreach/send-gate');
    const grants = await db.one<{ id: string }>(`select id::text from platform.vehicle where kind = 'grant_rail' limit 1`);
    const onFundGate = await sendGate(lpC, fund.id), onSpvGate = await sendGate(lpC, spv.id), barredGate = await sendGate(contactP, fund.id);
    const grantGateR = grants ? await sendGate(lpC, grants.id) : null;
    check('Materials: a send is checked against the LP\'s own instrument on the vehicle; a do-not-email restriction and a grants funder with no invitation refuse',
      onFundGate.instrument === 'lp_commitment' && !onFundGate.refusals.length && onSpvGate.instrument === 'spv'
        && barredGate.refusals.some((r) => /restriction/.test(r)) && (!grantGateR || (grantGateR.instrument === 'grant' && grantGateR.refusals.length > 0)),
      JSON.stringify({ fund: onFundGate, spv: onSpvGate.instrument, barred: barredGate.refusals.length, grants: grantGateR }));
  }
  check('Outreach writes: a person\'s link leaves an agent\'s approved ticket for the agent\'s own send; an agent\'s link of our own mail as received is refused',
    Boolean(t3) && personLink.status === 200 && personLink.json?.data?.ticketUsed !== true && keptOpen?.open === true && agentLink.status === 200
    && (disguised === null || disguised.status === 409),
    `ticket ${t3 ? 'opened' : 'NONE'}; person ${personLink.status} used ${personLink.json?.data?.ticketUsed}; open after ${keptOpen?.open}; agent ${agentLink.status}${agentLink.json?.error ? ` (${agentLink.json.error})` : ''}; disguised ${disguised?.status ?? 'no team address'}`);

  // Red-team pass, 17 Oct 2026. An autonomous status is the system's ('rule'), as outreach_add_lp sets it.
  const lpS = await pursuit(await entity('Invented Outreach Rule Status Org'), fund.id, 'connecting');
  const sAgent = await agent('update', { pursuitId: lpS, words: 'They replied: keen to talk.', idempotencyKey: 'props-desk-update-rule', applied: { status: { to: 'discussing' } } });
  const sRow = await db.one<{ status: string; source: string }>('select status::text, status_source source from strategy.pursuit where pursuit_id = $1', [lpS]);
  check('Outreach writes: an autonomous /update status is recorded as the system\'s (rule), so a person\'s later choice wins (17 Oct 2026)',
    sAgent.status === 200 && sRow?.status === 'discussing' && sRow.source === 'rule', `${sAgent.status}${sAgent.json?.error ? ` (${sAgent.json.error})` : ''}; ${sRow?.status} by ${sRow?.source}`);
  // An intro ask's ticket covers mail to its connector; a ticketed send names its recipients.
  const introTicket = intro.json?.data?.ticketId as string | undefined;
  if (introTicket) await decideTicket(juan.id, introTicket, 'approve', 'props');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'connector@invented-connector.example', 'affinity:props-outreach', current_date, 'medium')`, [connector]);
  const toLp = await agent('link', msg({ pursuitId: introLp, ticketId: introTicket, to: ['lp@invented-intro.example'] }));
  const noOne = await agent('link', msg({ pursuitId: introLp, ticketId: introTicket, to: [] }));
  const toConnector = await agent('link', msg({ pursuitId: introLp, ticketId: introTicket, to: ['Connector@Invented-Connector.example'] }));
  check('Outreach writes: an INTRO_ASK ticket links only mail to its connector, and no ticket is spent on a message naming no recipients (17 Oct 2026)',
    Boolean(introTicket) && toLp.status === 409 && String(toLp.json?.error).includes('connector') && noOne.status === 409 && toConnector.status === 200,
    `to the LP ${toLp.status}; no recipients ${noOne.status}; to the connector ${toConnector.status}${toConnector.json?.error ? ` (${toConnector.json.error})` : ''}`);
  // The mail desk may confirm an address and set where an LP's mail goes on its own (Juan, 17 Oct 2026).
  const cAgent = await agent('contacts', { entityId: personE, email: 'agent@invented-person.example', source: 'gmail', confirmedBy: 'juan' });
  const sendTo = await agent('contacts', { entityId: personE, email: 'agent2@invented-person.example', source: 'gmail-signature', role: 'send-to' });
  const sig = await agent('contacts', { entityId: personE, email: 'agent3@invented-person.example', source: 'gmail-signature' });
  check('Outreach writes: an autonomous /contacts may confirm an address, set where mail goes, or add one from a signature (17 Oct 2026)',
    cAgent.status === 200 && sendTo.status === 200 && sig.status === 200, `confirmed ${cAgent.status}; send-to ${sendTo.status}; signature ${sig.status}${sig.json?.error ? ` (${sig.json.error})` : ''}`);

  // Red team, 17 Oct 2026 (round 9): a restricted firm's own address, and a person who deals with us through it, are barred.
  const firmR = await entity('Invented Barred Firm'), staffR = await entity('Invented Barred Firm Staff', 'person');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'investments@invented-barred-firm.example', 'affinity:props-outreach', current_date, 'medium'),
    ($2, 'email', 'staff@invented-elsewhere.example', 'affinity:props-outreach', current_date, 'medium')`, [firmR, staffR]);
  await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, is_primary, as_of) values ($1, $2, 'staff', 'Analyst', true, current_date)`, [staffR, firmR]);
  await db.query(`insert into coordination.restriction (entity_id, scope, instruction, recorded_by) values ($1, 'blanket', 'Invented: do not approach the firm', $2)`, [firmR, juan.id]);
  const lpF = await pursuit(await entity('Invented Outreach Unrelated LP'), fund.id, 'selected');
  const toFirm = await agent('tickets', sendBody(lpF, { scope: { recipients: ['investments@invented-barred-firm.example'], purpose: 'invite' } }));
  const toStaff = await agent('tickets', sendBody(lpF, { scope: { recipients: ['staff@invented-elsewhere.example'], purpose: 'invite' } }));
  check('Outreach writes: a restricted firm\'s own address, and a person whose firm it is, are refused to an agent (rule 8, 17 Oct 2026)',
    toFirm.status === 409 && /Invented Barred Firm/.test(toFirm.json?.error ?? '') && toStaff.status === 409 && /restriction/i.test(toStaff.json?.error ?? ''),
    `firm ${toFirm.status} ${toFirm.json?.error ?? ''}; staff ${toStaff.status}`);

  // A request key replays only for its own token and the same request; an update key is the pursuit's.
  const rw2 = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
  const keyed = { entityId: personE, email: 'keyed@invented-person.example', source: 'gmail-signature', idempotencyKey: 'props-desk-key-reuse' };
  // A replay comes back from jsonb, which orders keys its own way.
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
  const sameAnswer = (a: unknown, b: unknown) => a !== undefined && JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  const k1 = await post('contacts', keyed), kSame = await post('contacts', keyed), kOther = await post('contacts', keyed, rw2);
  const kArgs = await post('contacts', { ...keyed, email: 'keyed2@invented-person.example' });
  const lpK = await pursuit(await entity('Invented Outreach Key Org'), fund.id, 'connecting');
  const upd = (pursuitId: string) => post('update', { pursuitId, words: 'Invented note.', idempotencyKey: 'props-desk-update-shared-key', applied: {} });
  const ua = await upd(lpS), ub = await upd(lpK);
  check('Outreach writes: a request key replays only to the token that used it, for the same request; an update key is per LP (17 Oct 2026)',
    k1.status === 200 && kSame.status === 200 && sameAnswer(kSame.json?.data, k1.json?.data) && kOther.status === 409 && kArgs.status === 409
      && ua.status === 200 && ub.status === 200 && ub.json?.data?.created === true && ub.json?.data?.updateId !== ua.json?.data?.updateId,
    `first ${k1.status}; same ${kSame.status} same answer ${sameAnswer(kSame.json?.data, k1.json?.data)}; other token ${kOther.status}; other args ${kArgs.status}; update ${ua.status}/${ub.status} created ${ub.json?.data?.created}`);
}
