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
}
