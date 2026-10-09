/**
 * Mail actions (Juan, 9 Oct 2026; docs/29-mail-actions.md), on invented data:
 *   - suggest() is pure and conservative: a status only forward, never to Committed, only on the LP's own words; an amount
 *     is an indication, suggested only when it differs; a connector's offer is a next step;
 *   - outreach_record_signals keeps readings idempotently, resolves people by address, changes no status, update,
 *     indication or ticket, needs outreach:write, and answers outreach_update payloads that work as they are, once;
 *   - outreach_signals and outreach_insights read them back, by vehicle access, summed by topic;
 *   - outreach_propose_contact keeps a signature's phone and title as medium-confidence claims, the newest reading
 *     superseding this mailbox's older one, another source's value kept; a "gmail" source needs confirmedBy;
 *   - a Gmail reply from the LP records "LP opted in" through Reconciliation; a reply from someone else on the thread does not.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Check, Db } from './harness';
import { fixtures } from './outreach-api';

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> };

export async function mailActionProperties(check: Check, db: Db) {
  const { suggest } = await import('../../lib/outreach/signals');

  // ── suggest(), pure ──────────────────────────────────────────────────────────────────
  const base = { pursuitId: 'p1', indicated: null, role: 'lp' as const, summary: 'Invented', amount: null, followUpOn: null,
    messageAt: new Date('2026-10-09T12:00:00Z'), messageKey: 'm1@invented', direction: 'theirs' as const, entityName: 'Invented LP' };
  const kinds = (xs: ReturnType<typeof suggest>) => xs.map((x) => `${x.kind}:${JSON.stringify(x.update.applied)}`).join(' | ');
  const q1 = suggest({ ...base, status: 'connecting', kind: 'question' });
  const q2 = suggest({ ...base, status: 'discussing', kind: 'question' });
  const ind = suggest({ ...base, status: 'discussing', kind: 'soft_commit', amount: { low: 2e6, high: 3e6 } });
  const same = suggest({ ...base, status: 'discussing', kind: 'indication', amount: { low: 2e6, high: 3e6 }, indicated: { low: 2e6, high: 3e6 } });
  const dec = suggest({ ...base, status: 'discussing', kind: 'decline' });
  const decCommitted = suggest({ ...base, status: 'committed', kind: 'decline' });
  const ours = suggest({ ...base, status: 'selected', kind: 'interest', direction: 'ours' });
  const conn = suggest({ ...base, status: 'selected', role: 'connector', kind: 'intro_offer' });
  const connInterest = suggest({ ...base, status: 'selected', role: 'connector', kind: 'interest' });
  const all = [q1, q2, ind, same, dec, ours, conn, connInterest].flat();
  check('Mail suggestions: a status only forward (to Discussing on their engaging, to Passed on their decline, never from Committed, never to Committed), only on the LP\'s own words; an amount only when it differs, as an indication; a connector\'s offer is a next step; each a ready update with its own key',
    kinds(q1).startsWith('status:{"status":{"to":"discussing"}}') && q1.some((x) => x.kind === 'next_step')
    && !q2.some((x) => x.kind === 'status') && ind.some((x) => x.kind === 'indicated' && (x.update.applied.indicated as { low: number; high: number }).high === 3e6)
    && !same.some((x) => x.kind === 'indicated') && dec.length === 1 && (dec[0]!.update.applied.status as { to: string }).to === 'passed'
    && decCommitted.length === 0 && ours.length === 0 && conn.length === 1 && conn[0]!.kind === 'next_step' && connInterest.length === 0
    && !all.some((x) => JSON.stringify(x.update.applied).includes('committed'))
    && [q1, ind, dec, conn].every((xs) => new Set(xs.map((x) => x.update.idempotencyKey)).size === xs.length),
    `connecting+question: ${kinds(q1)}; discussing+question: ${kinds(q2)}; soft commit: ${kinds(ind)}; same amount: ${kinds(same)}; decline: ${kinds(dec)}; committed+decline: ${decCommitted.length}; ours: ${ours.length}; connector offer: ${kinds(conn)}`);

  // ── Over MCP ──────────────────────────────────────────────────────────────────────────
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { POST } = await import('../../app/api/mcp/route');
  resetWindows();
  const connect = async (secret: string) => {
    const c = new Client({ name: 'props-mail', version: '0' });
    await c.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3119/api/mcp'), {
      fetch: (u, init) => POST(new Request(u, init)), requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }));
    return c;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as Result;
    const text = r.content.map((x) => x.text).join('\n');
    let data: any = null;
    try { data = JSON.parse(text).data; } catch { /* a refusal is plain text */ }
    return { error: r.isError ? text : null, data, text };
  };
  const { juan, fund, spv, user, token, entity, pursuit } = await fixtures(db);
  const writer = await connect(await token(juan, [OUTREACH_READ, OUTREACH_WRITE]));
  const reader = await connect(await token(juan, [OUTREACH_READ]));
  const juanEmail = (juan.email || 'juan@example.invalid').toLowerCase();

  const lp = await entity('Invented Mail LP', 'person');
  const p = await pursuit(lp, fund.id, 'connecting');
  const friend = await entity('Invented Mail Connector', 'person');
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('props:mail', 'Invented record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values
    ($1, 'email', 'iris@invented-mail.example', 'props:mail', current_date, 'medium'),
    ($2, 'email', 'otto@invented-mail.example', 'props:mail', current_date, 'medium'),
    ($1, 'phone', '+1 415 555 0000', 'props:mail', '2026-01-01', 'medium')`, [lp, friend]);
  const state = async () => db.one<{ s: string; u: number; i: number; t: number }>(`select (select status::text from strategy.pursuit where pursuit_id = $1) s,
    (select count(*)::int from strategy.pursuit_update) u, (select count(*)::int from pipeline.indication) i, (select count(*)::int from governance.approval_ticket) t`, [p]);
  const before = await state();
  const msg = { messageId: '<Mail-1@Invented-Mail.example>', gmailMessageId: 'g-mail-1', threadId: 'th-mail', date: '2026-10-08T10:00:00Z', direction: 'received' };
  const args = { message: msg, readBy: 'rules', signals: [
    { pursuitId: p, role: 'lp', kind: 'indication', amount: { low: 2000000, high: 3000000 }, summary: 'Thinking $2-3M, subject to IC.', confidence: 'high' },
    { pursuitId: p, role: 'lp', kind: 'question', topic: 'Fees', summary: 'Asked whether fees step down.', confidence: 'medium' },
    { email: 'otto@invented-mail.example', role: 'connector', kind: 'intro_offer', pursuitId: p, summary: 'Offered to introduce a colleague.', confidence: 'medium' },
    { email: 'nobody@invented-unknown.example', role: 'other', kind: 'other', summary: 'Unknown sender.', confidence: 'low' },
  ] };
  const r1 = await call(writer, 'outreach_record_signals', args);
  const r2 = await call(writer, 'outreach_record_signals', args);
  const ro = await call(reader, 'outreach_record_signals', args);
  const after = await state();
  const stored = await db.one<{ n: number }>(`select count(*)::int n from email.mail_signal where message_id = 'mail-1@invented-mail.example'`);
  const sugg = (r1.data?.suggestions ?? []) as Array<{ kind: string; update: Record<string, unknown> }>;
  check('outreach_record_signals: readings kept once per message, person, kind and LP (a repeat replaces, never adds); a person found by address; an unknown address unmatched; nothing else changes — status, updates, indications, tickets; a read token is refused',
    !r1.error && r1.data.recorded.length === 3 && r1.data.recorded.every((x: { new: boolean }) => x.new) && r1.data.unmatched.length === 1
    && r1.data.recorded.some((x: { entityId: string; role: string }) => x.entityId === friend && x.role === 'connector')
    && r2.data?.recorded.every((x: { new: boolean }) => !x.new) && stored?.n === 3
    && JSON.stringify(before) === JSON.stringify(after) && /outreach:write/.test(ro.error ?? ''),
    `first ${JSON.stringify(r1.data?.recorded?.map((x: { kind: string; new: boolean }) => `${x.kind}:${x.new}`) ?? r1.error)}; unmatched ${r1.data?.unmatched?.length}; again new ${r2.data?.recorded?.filter((x: { new: boolean }) => x.new).length}; stored ${stored?.n}; before ${JSON.stringify(before)} after ${JSON.stringify(after)}; read token: ${ro.error?.slice(0, 60)}`);

  const status = sugg.find((x) => x.kind === 'status');
  const applied = status ? await call(writer, 'outreach_update', status.update) : null;
  const again = status ? await call(writer, 'outreach_update', status.update) : null;
  const indicated = sugg.find((x) => x.kind === 'indicated');
  const appliedInd = indicated ? await call(writer, 'outreach_update', indicated.update) : null;
  const now = await state();
  check('Mail suggestions work as they are: the status suggestion, sent to outreach_update unchanged, moves the LP to Discussing once (a second click changes nothing); the indicated amount is recorded as an indication, not soft money',
    !!status && !applied?.error && now?.s === 'discussing' && again?.data?.created === false && !!indicated && !appliedInd?.error && now.i === before!.i + 1,
    `suggestions ${sugg.map((x) => x.kind).join(',')}; applied ${applied?.error ?? applied?.data?.created}; again created ${again?.data?.created}; status ${now?.s}; indications +${(now?.i ?? 0) - (before?.i ?? 0)}`);

  const read = await call(reader, 'outreach_signals', { pursuitId: p });
  const gpSpv = await user('mail-gp-spv', 'team', [spv.id]);
  const spvReader = await connect(await token(gpSpv, [OUTREACH_READ]));
  const other = await call(spvReader, 'outreach_signals', { pursuitId: p });
  const ins = await call(reader, 'outreach_insights', { vehicle: fund.slug });
  const fees = ins.data?.kinds?.find((k: { kind: string }) => k.kind === 'question')?.topics?.find((t: { topic: string }) => t.topic === 'fees');
  const book = await call(reader, 'outreach_playbook', {});
  check('Reading what the mail says: one LP\'s signals newest first for its vehicle\'s reader, refused to a GP on another vehicle; a vehicle\'s insights summed by kind and topic (case aside) with examples; the playbook returned as markdown',
    !read.error && read.data.signals.length === 3 && read.data.signals.some((x: { summary: string }) => /fees step down/.test(x.summary))
    && /No such LP/.test(other.error ?? '') && ins.data?.signals === 3 && fees?.signals === 1 && fees.examples.length === 1
    && ins.data.indicatedInMail?.low === 2000000 && /# Mail actions/.test(book.data?.text ?? ''),
    `signals ${read.data?.signals?.length ?? read.error}; other GP: ${other.error?.slice(0, 40) ?? 'READ'}; insights ${ins.data?.signals ?? ins.error}, fees ${fees?.signals}; indicated ${JSON.stringify(ins.data?.indicatedInMail)}; playbook ${book.data?.text?.length ?? book.error}`);

  // ── Contact details from a signature ─────────────────────────────────────────────────
  const c1 = await call(writer, 'outreach_propose_contact', { entityId: lp, phone: '+1 415 555 0101', title: 'Partner', source: 'gmail-signature', seenOn: '2026-10-01', messageId: msg.messageId });
  const c2 = await call(writer, 'outreach_propose_contact', { entityId: lp, phone: '+1 415 555 0102', source: 'gmail-signature', seenOn: '2026-10-09' });
  const noConfirm = await call(writer, 'outreach_propose_contact', { entityId: lp, email: 'iris2@invented-mail.example', source: 'gmail' });
  const bad = await call(writer, 'outreach_propose_contact', { entityId: lp, phone: 'call me maybe', source: 'gmail-signature' });
  const phones = await db.query<{ value: string; confidence: string; current: boolean; source: string }>(`select value, confidence::text, superseded_by is null current, source
    from research.claim where entity_id = $1 and field = 'phone' order by created_at`, [lp]);
  const contacts = await call(reader, 'outreach_contacts', { vehicle: fund.slug, details: true });
  const row = contacts.data?.rows?.find((x: { pursuitId: string }) => x.pursuitId === p);
  const det = row?.contacts?.[0]?.details;
  check('Contact details: a signature\'s phone and title are kept as medium-confidence claims dated by the message; a newer reading supersedes this mailbox\'s older one; another source\'s phone is kept; a "gmail" source needs confirmedBy; a phone that is not one is refused; outreach_contacts?details shows the newest',
    !c1.error && !c2.error && c1.data.claims.length === 2 && c2.data.claims[0].kept === 1 && /confirmedBy/.test(noConfirm.error ?? '') && !!bad.error
    && phones.length === 3 && phones.filter((x) => x.current).map((x) => x.value).sort().join(',') === '+1 415 555 0000,+1 415 555 0102'
    && phones.filter((x) => /^gmail-signature/.test(x.source)).every((x) => x.confidence === 'medium')
    && det?.phone?.value === '+1 415 555 0102' && det.phone.source === 'gmail-signature' && det.phone.confirmed === false && det?.title?.value === 'Partner',
    `c1 ${JSON.stringify(c1.data?.claims?.map((x: { field: string }) => x.field) ?? c1.error)}; c2 kept ${c2.data?.claims?.[0]?.kept}; no confirm: ${noConfirm.error?.slice(0, 50)}; bad: ${bad.error?.slice(0, 40)}; phones ${phones.map((x) => `${x.value}${x.current ? '' : ' (old)'}`).join(', ')}; details ${JSON.stringify(det)?.slice(0, 160)}`);

  // ── A Gmail reply from the LP records "LP opted in" ───────────────────────────────────
  const rung = async (id: string) => (await db.query<{ rung: string }>(`select rung::text from strategy.ladder_event where pursuit_id = $1 order by rung`, [id])).map((r) => r.rung).join('+') || null;
  const lp2 = await entity('Invented Mail LP Two', 'person');
  const p2 = await pursuit(lp2, fund.id, 'connecting');
  const lp3 = await entity('Invented Mail LP Three', 'person');
  const p3 = await pursuit(lp3, fund.id, 'connecting');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values
    ($1, 'email', 'vera@invented-mail.example', 'props:mail', current_date, 'medium'),
    ($2, 'email', 'wade@invented-mail.example', 'props:mail', current_date, 'medium')`, [lp2, lp3]);
  const rungsBefore = [await rung(p2), await rung(p3)];
  const ing = await call(writer, 'comms_ingest', { messages: [
    // From the LP herself, about the fund.
    { messageId: '<mail-2@invented-mail.example>', gmailMessageId: 'g-mail-2', date: new Date(Date.now() - 3_600_000).toISOString(), direction: 'received',
      from: 'vera@invented-mail.example', to: [juanEmail], subject: 'Re: the fund', pursuitId: p2 },
    // From the connector, with LP Three only copied: not a reply from LP Three.
    { messageId: '<mail-3@invented-mail.example>', gmailMessageId: 'g-mail-3', date: new Date(Date.now() - 3_600_000).toISOString(), direction: 'received',
      from: 'otto@invented-mail.example', to: [juanEmail], cc: ['wade@invented-mail.example'], subject: 'Re: the fund', pursuitId: p3 },
  ] });
  const rungsAfter = [await rung(p2), await rung(p3)];
  const ladder = await db.one<{ by: string; ref: string }>(`select u.handle by, l.evidence_ref ref from strategy.ladder_event l join platform.app_user u on u.id = l.recorded_by
    where l.pursuit_id = $1 and l.rung = 'target_opted_in' order by l.created_at desc limit 1`, [p2]);
  check('A Gmail reply from the LP is a reply on file: comms_ingest has Reconciliation record "LP opted in" on it, by Reconciliation, citing the message; a message from someone else that only copied an LP records nothing for that LP',
    !ing.error && ing.data.reconciled >= 2 && /target_opted_in/.test(rungsAfter[0] ?? '') && rungsAfter[1] === rungsBefore[1] && /mail-2@invented-mail\.example/.test(ladder?.ref ?? ''),
    `ingest ${JSON.stringify(ing.data ?? ing.error)?.slice(0, 120)}; rungs before ${rungsBefore.join(',')} after ${rungsAfter.join(',')}; ladder ${JSON.stringify(ladder)}`);

  for (const c of [writer, reader, spvReader]) await c.close();
}
