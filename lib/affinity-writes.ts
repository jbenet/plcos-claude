import { z } from 'zod';
import { getDb } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { appendAudit, type AppUser } from '@/modules/platform';
import { checkParties } from '@/lib/outreach/parties';

/**
 * Affinity writes, batched for a person's approval (Juan, 14 Oct 2026: "C, also notes" — PLC OS adds the people he
 * emailed who are missing from Affinity, and a note of the mail Affinity's sync did not capture, approved per batch).
 *
 *   - JuanMail proposes (outreach_propose_affinity_writes): an address, the name and firm its headers gave, and the
 *     mail sent (date, subject, thread id; never a body). Each item is planned against PLC OS's copy of Affinity:
 *     internal → skip; Affinity already has an email with them on or after the last send → skip; a person with that
 *     address → a note on them; nobody → create the person, then the note.
 *   - Items gather in the one open batch. Proposing an address again merges its mail into the open item.
 *   - Only an admin, in Approvals, decides the batch: the checked items are written, the rest rejected. Nothing reaches
 *     Affinity before that. A batch is capped at config.affinity.writeBatchMaxCalls requests.
 *   - Deciding and writing live in lib/affinity-writes-decide.ts, which nothing in lib/mcp or lib/outreach may reach.
 *   - Writing happens after the decision is committed, one item at a time, each item's outcome saved as it lands, so a
 *     failure halfway leaves an exact record and never a second person for one address.
 */

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');
const message = z.object({
  at: z.string().datetime({ offset: true }),
  subject: z.string().max(300).optional(),
  gmailThreadId: z.string().max(100).regex(/^[\w-]+$/).optional(),
}).strict();

export const MAX_WRITE_ITEMS = 200;
export const proposeInput = z.object({
  items: z.array(z.object({
    address: email,
    name: z.string().trim().min(1).max(200).optional(),
    firm: z.string().trim().min(1).max(200).optional(),
    messages: z.array(message).min(1).max(100),
  }).strict()).min(1).max(MAX_WRITE_ITEMS),
}).strict();

export const statusInput = z.object({
  batchId: z.string().uuid().optional().describe('One batch; without it, the open batch and the last five decided.'),
}).strict();

type Message = z.infer<typeof message>;
export type Plan = 'person+note' | 'note' | 'skip';
/** How a failed write that may still have reached Affinity begins its error (lib/affinity-writes-decide.ts). */
export const UNCERTAIN = 'Uncertain: ';
export type ItemState = 'proposed' | 'approved' | 'skipped' | 'rejected' | 'written' | 'failed';

export interface WriteItem {
  itemId: string; batchId: string; address: string; name: string | null; firm: string | null; messages: Message[];
  plan: Plan; reason: string; affinityPersonId: number | null; state: ItemState;
  createdPersonId: number | null; affinityNoteId: number | null; error: string | null; proposedAt: string; writtenAt: string | null;
}

export const callsFor = (plan: Plan) => (plan === 'person+note' ? 2 : plan === 'note' ? 1 : 0);
export const day = (iso: string) => iso.slice(0, 10);

/** The person in Affinity with each address: our copy's newest record that lists it, else one we created. */
async function affinityPersonIds(addresses: string[]): Promise<Map<string, number>> {
  const db = await getDb();
  const out = new Map<string, number>();
  if (!addresses.length) return out;
  for (const r of await db.query<{ email: string; id: string }>(`select distinct on (lower(trim(e.v))) lower(trim(e.v)) email, r.source_id id
      from sources.raw_record r
      cross join lateral (select r.payload->>'primaryEmailAddress' v
                          union select jsonb_array_elements_text(case when jsonb_typeof(r.payload->'emailAddresses') = 'array' then r.payload->'emailAddresses' else '[]'::jsonb end)) e
     where r.source = 'affinity' and r.kind = 'person' and lower(trim(e.v)) = any($1::text[]) and r.source_id ~ '^\\d+$'
       -- Each person's newest record only: an address an older version listed may since have moved, or the person gone.
       and not exists (select 1 from sources.raw_record n where n.source = 'affinity' and n.kind = 'person' and n.source_id = r.source_id
                          and (n.fetched_at, n.id) > (r.fetched_at, r.id))
     order by lower(trim(e.v)), r.fetched_at desc, r.id desc`, [addresses])) out.set(r.email, Number(r.id));
  // A person we created ourselves, which our copy may not have synced yet: never a second one for the address.
  for (const r of await db.query<{ address: string; id: number }>(`select distinct on (address) address, created_person_id::float8 id
      from sources.affinity_write_item where address = any($1::text[]) and created_person_id is not null
     order by address, written_at desc nulls last, proposed_at desc`, [addresses])) if (!out.has(r.address)) out.set(r.address, r.id);
  return out;
}

const messageKey = (m: Message) => `${new Date(m.at).toISOString()}|${m.subject ?? ''}`;
const mergeMessages = (a: Message[], b: Message[]) => {
  const seen = new Map<string, Message>();
  for (const m of [...a, ...b]) seen.set(messageKey(m), m);
  return [...seen.values()].sort((x, y) => x.at.localeCompare(y.at));
};

async function openBatchId(): Promise<string> {
  const db = await getDb();
  await db.query(`insert into sources.affinity_write_batch (status) values ('open') on conflict do nothing`);
  return (await db.one<{ id: string }>(`select batch_id::text id from sources.affinity_write_batch where status = 'open'`))!.id;
}

export const ROW = `select item_id::text "itemId", batch_id::text "batchId", address, name, firm, messages, plan, reason,
  affinity_person_id::float8 "affinityPersonId", state, created_person_id::float8 "createdPersonId", affinity_note_id::float8 "affinityNoteId",
  error, proposed_at "proposedAt", written_at "writtenAt" from sources.affinity_write_item`;
const shape = (r: WriteItem): WriteItem => ({ ...r, proposedAt: new Date(r.proposedAt).toISOString(), writtenAt: r.writtenAt ? new Date(r.writtenAt).toISOString() : null });

// ── POST /api/outreach/affinity · outreach_propose_affinity_writes ──────────────────────

type ProposeEnv = { owner: AppUser; principal: AppUser; tokenId: string };
type Proposed = { address: string; name?: string; firm?: string; messages: Message[] };

export async function proposeAffinityWrites(env: ProposeEnv, raw: Record<string, unknown>) {
  requireMutationProfile();
  // A batch decided while this call planned is closed to it: plan again against the new open batch.
  for (let attempt = 0; attempt < 3; attempt++) {
    const done = await proposeOnce(env, raw as z.infer<typeof proposeInput>);
    if (done) return done;
  }
  throw new Error('The open batch of Affinity writes kept being decided while proposing; try again.');
}

async function proposeOnce(env: ProposeEnv, a: z.infer<typeof proposeInput>) {
  const db = await getDb();
  // The same address twice in one call is one item.
  const merged = new Map<string, Proposed>();
  for (const it of a.items) {
    const m = merged.get(it.address);
    if (m) { m.messages = mergeMessages(m.messages, it.messages); m.name ??= it.name; m.firm ??= it.firm; }
    else merged.set(it.address, { ...it, messages: mergeMessages([], it.messages) });
  }
  const batchId = await openBatchId();
  const open = new Map((await db.query<WriteItem>(`${ROW} where batch_id = $1 and address = any($2::text[])`, [batchId, [...merged.keys()]])).map((r) => [r.address, r]));
  for (const [address, it] of merged) {
    const prior = open.get(address);
    if (prior) it.messages = mergeMessages(prior.messages, it.messages);
  }
  // What PLC OS knows of each: internal, and whether Affinity's last email with them covers the last send.
  const check = (await checkParties(env.principal, { parties: [...merged.values()].map((it) => ({ address: it.address, sends: it.messages.map((m) => ({ at: m.at })) })) })).data;
  const known = new Map(check.parties.map((p) => [p.address, p]));
  const ids = await affinityPersonIds([...merged.keys()]);
  // The mail already written to Affinity for each address: a message noted once is not noted again. By message, not
  // by day: mail sent later on the day of a write still needs its note (red-team pass, 14 Oct 2026).
  // A write that failed with no answer from Affinity may still have landed (UNCERTAIN, lib/affinity-writes-decide.ts),
  // so its mail counts as noted too: proposing it again could put the same note in Affinity twice (17 Oct 2026).
  const written = new Map<string, { at: string; keys: Set<string>; uncertain: boolean }>();
  for (const r of await db.query<{ address: string; at: Date; messages: Message[]; uncertain: boolean }>(`select address, coalesce(written_at, proposed_at) at, messages,
      state = 'failed' uncertain from sources.affinity_write_item
      where (state = 'written' or (state = 'failed' and error like '${UNCERTAIN}%')) and address = any($1::text[])`, [[...merged.keys()]])) {
    const w = written.get(r.address) ?? { at: new Date(r.at).toISOString(), keys: new Set<string>(), uncertain: false };
    if (r.uncertain) w.uncertain = true;
    if (new Date(r.at).toISOString() > w.at) w.at = new Date(r.at).toISOString();
    for (const m of r.messages) w.keys.add(messageKey(m));
    written.set(r.address, w);
  }

  const planned: Array<{ it: Proposed; plan: Plan; reason: string; personId: number | null }> = [];
  for (const it of merged.values()) {
    const p = known.get(it.address);
    const aff = p && !p.internal ? p.affinity ?? null : null;
    const done = written.get(it.address);
    // Only the mail not yet noted goes in this item's note.
    if (done) { const fresh = it.messages.filter((m) => !done.keys.has(messageKey(m))); if (fresh.length) it.messages = fresh; }
    const personId = ids.get(it.address) ?? null;
    let plan: Plan, reason: string;
    if (p?.internal) { plan = 'skip'; reason = 'Internal: the team or one of our domains.'; }
    else if (done && it.messages.every((m) => done.keys.has(messageKey(m)))) {
      plan = 'skip';
      reason = done.uncertain ? `A write of this mail on ${day(done.at)} got no answer from Affinity and may have landed: check Affinity before noting it by hand.`
        : `Already written to Affinity on ${day(done.at)}.`;
    }
    else if (aff?.covered) { plan = 'skip'; reason = `Affinity already has an email with them on ${aff.lastEmail}, on or after the last send.`; }
    else if (personId) { plan = 'note'; reason = `In Affinity${aff?.name ? ` as ${aff.name}` : ''}; its last email with them is ${aff?.lastEmail ?? 'none'}.`; }
    else { plan = 'person+note'; reason = 'No person in Affinity has this address.'; }
    planned.push({ it, plan, reason, personId });
  }
  // Inserted with the batch held open (red-team pass, 14 Oct 2026): a decision waits for these items, and an item
  // never lands in a batch already decided, where nothing would show or write it.
  const out = await db.transaction(async (tx) => {
    const b = await tx.one<{ status: string }>(`select status from sources.affinity_write_batch where batch_id = $1 for share`, [batchId]);
    if (b?.status !== 'open') return null;
    const rows: Array<{ address: string; itemId: string; plan: Plan; reason: string }> = [];
    for (const { it, plan, reason, personId } of planned) {
      const row = await tx.one<{ id: string }>(`insert into sources.affinity_write_item (batch_id, address, name, firm, messages, plan, reason, affinity_person_id, proposed_by, token_id)
          values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
          on conflict (batch_id, address) do update set name = coalesce(sources.affinity_write_item.name, excluded.name), firm = coalesce(sources.affinity_write_item.firm, excluded.firm),
            messages = excluded.messages, plan = excluded.plan, reason = excluded.reason, affinity_person_id = excluded.affinity_person_id,
            proposed_by = excluded.proposed_by, token_id = excluded.token_id,
            -- A changed item is a new item (red-team pass, 17 Oct 2026): an Admin who has the batch open saw the old
            -- mail and plan, so its old id must not approve the new ones; a new id moves it to the next batch, as an
            -- unseen item does. The note names whoever proposed this mail, not the first proposer.
            item_id = case when (sources.affinity_write_item.messages, sources.affinity_write_item.plan, sources.affinity_write_item.affinity_person_id, sources.affinity_write_item.proposed_by)
                is distinct from (excluded.messages, excluded.plan, excluded.affinity_person_id, excluded.proposed_by) then gen_random_uuid() else sources.affinity_write_item.item_id end
          returning item_id::text id`,
      [batchId, it.address, it.name ?? null, it.firm ?? null, JSON.stringify(it.messages), plan, reason, personId, env.owner.id, env.tokenId]);
      rows.push({ address: it.address, itemId: row!.id, plan, reason });
    }
    return rows;
  });
  if (!out) return null;
  await appendAudit({ actorId: env.owner.id, action: 'affinity.write_proposed', subjectType: 'affinity_write_batch', subjectId: batchId, detail: {
    tokenId: env.tokenId, items: out.length, plans: Object.fromEntries((['person+note', 'note', 'skip'] as Plan[]).map((k) => [k, out.filter((o) => o.plan === k).length])),
  } });
  return { data: {
    batchId, items: out,
    next: 'Nothing is written to Affinity until a person approves the batch in PLC OS (Approvals → Affinity writes). Read where each item stands with GET /api/outreach/affinity?batchId=.',
  } };
}

// ── GET /api/outreach/affinity · outreach_affinity_writes ──────────────────────────────

export async function affinityWritesStatus(env: { owner: AppUser }, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof statusInput>;
  const db = await getDb();
  const batches = await db.query<{ batchId: string; status: string; openedAt: Date; decidedAt: Date | null; finishedAt: Date | null; decidedBy: string | null }>(
    `select b.batch_id::text "batchId", b.status, b.opened_at "openedAt", b.decided_at "decidedAt", b.finished_at "finishedAt", u.name "decidedBy"
       from sources.affinity_write_batch b left join platform.app_user u on u.id = b.decided_by
      where ${a.batchId ? 'b.batch_id = $1::uuid' : `b.status = 'open' or b.batch_id in (select batch_id from sources.affinity_write_batch where status = 'decided' order by decided_at desc limit 5)`}
      order by b.opened_at desc`, a.batchId ? [a.batchId] : []);
  // Only the items this person proposed: it is their mail.
  const items = batches.length ? await db.query<WriteItem>(`${ROW} where batch_id = any($1::uuid[]) and proposed_by = $2 order by proposed_at, address`,
    [batches.map((b) => b.batchId), env.owner.id]) : [];
  return { data: { batches: batches.map((b) => ({ ...b, items: items.filter((i) => i.batchId === b.batchId).map(shape) })) } };
}

// ── Approvals → Affinity writes ────────────────────────────────────────────────────────

export async function openWriteBatch(): Promise<{ batchId: string; openedAt: Date; items: WriteItem[] } | null> {
  const db = await getDb();
  const b = await db.one<{ id: string; at: Date }>(`select batch_id::text id, opened_at at from sources.affinity_write_batch where status = 'open'`);
  if (!b) return null;
  return { batchId: b.id, openedAt: b.at, items: (await db.query<WriteItem>(`${ROW} where batch_id = $1 order by plan = 'skip', proposed_at, address`, [b.id])).map(shape) };
}
