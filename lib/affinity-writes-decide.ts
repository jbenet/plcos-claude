import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { appendAudit, type AppUser } from '@/modules/platform';
import { AffinityWriteError, AffinityWriteRefused, affinityWriter, type AffinityWriter } from '@/lib/connectors/affinity/write';
import { callsFor, day, messageKey, ROW, UNCERTAIN, type WriteItem } from '@/lib/affinity-writes';

/**
 * Deciding a batch of Affinity writes, and writing it (lib/affinity-writes.ts says what the batch is). Only the
 * Approvals page reaches this file: no MCP tool or outreach op may (scripts/properties/mcp.ts checks the names).
 */

export class WriteBatchRefused extends Error {}

const nameParts = (name: string | null, address: string) => {
  const words = (name ?? address.split('@')[0]!.replace(/[._+-]+/g, ' ')).trim().split(/\s+/).filter(Boolean)
    .map((w) => (name ? w : w[0]!.toUpperCase() + w.slice(1)));
  return { firstName: words[0] ?? address, lastName: words.slice(1).join(' ') };
};

/** The note: who emailed them, when, and about what, from the mail's metadata; and where it came from. */
export function noteContent(sender: string, it: Pick<WriteItem, 'name' | 'address' | 'messages'>): string {
  const lines = it.messages.map((m) => `- ${day(m.at)}${m.subject ? ` · ${m.subject}` : ''}`);
  return `${sender} emailed ${it.name ?? it.address} (${it.address}); Affinity's mail sync did not capture ${it.messages.length === 1 ? 'it' : 'these'}:\n`
    + `${lines.join('\n')}\nRecorded by PLC OS from ${sender}'s sent mail.`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decide the open batch: the checked items are written, the rest rejected; skips stay skipped. Refused when the batch
 * is no longer open, is not this one, or the checked items would take more than the cap.
 *
 * `shown`: the items the person saw when deciding. Any other item (proposed after the page was drawn) is neither
 * written nor rejected: it moves to a new open batch, to be shown next time (red-team pass, 14 Oct 2026).
 */
export async function decideWriteBatch(user: AppUser, batchId: string, approve: string[], writer?: AffinityWriter, shown?: string[]) {
  requireMutationProfile();
  if (user.access !== 'admin') throw new WriteBatchRefused('Only an admin decides Affinity writes.');
  if (!UUID.test(batchId)) throw new WriteBatchRefused('That is not a batch of Affinity writes.');
  const db = await getDb();
  const chosen = new Set(approve);
  const items = await db.transaction(async (tx) => {
    const b = await tx.one<{ status: string }>(`select status from sources.affinity_write_batch where batch_id = $1 for update`, [batchId]);
    if (!b || b.status !== 'open') throw new WriteBatchRefused('That batch was decided already.');
    let all = await tx.query<WriteItem>(`${ROW} where batch_id = $1`, [batchId]);
    const seen = shown ? new Set(shown) : null;
    const unseen = seen ? all.filter((i) => !seen.has(i.itemId)) : [];
    if (unseen.length) {
      // Decided first: one batch may be open at a time.
      await tx.query(`update sources.affinity_write_batch set status = 'decided', decided_by = $2, decided_at = now() where batch_id = $1`, [batchId, user.id]);
      const next = (await tx.one<{ id: string }>(`insert into sources.affinity_write_batch (status) values ('open') returning batch_id::text id`))!.id;
      await tx.query(`update sources.affinity_write_item set batch_id = $2 where item_id = any($1::uuid[])`, [unseen.map((i) => i.itemId), next]);
      all = all.filter((i) => seen!.has(i.itemId));
    }
    const go = all.filter((i) => i.plan !== 'skip' && chosen.has(i.itemId));
    const calls = go.reduce((n, i) => n + callsFor(i.plan), 0);
    if (calls > config.affinity.writeBatchMaxCalls) {
      throw new WriteBatchRefused(`The checked items take ${calls} Affinity requests; one batch may take ${config.affinity.writeBatchMaxCalls}. Uncheck some: they stay for the next batch.`);
    }
    await tx.query(`update sources.affinity_write_batch set status = 'decided', decided_by = $2, decided_at = now() where batch_id = $1`, [batchId, user.id]);
    await tx.query(`update sources.affinity_write_item set state = case when plan = 'skip' then 'skipped' when item_id = any($2::uuid[]) then 'approved' else 'rejected' end
      where batch_id = $1`, [batchId, go.map((i) => i.itemId)]);
    await appendAudit({ actorId: user.id, action: 'affinity.write_batch_decided', subjectType: 'affinity_write_batch', subjectId: batchId, detail: {
      approved: go.length, rejected: all.filter((i) => i.plan !== 'skip' && !chosen.has(i.itemId)).length, skipped: all.filter((i) => i.plan === 'skip').length, calls,
    } }, tx);
    return go;
  });

  // The decision is on record; now the writes, each saved as it lands.
  const w = writer ?? affinityWriter();
  const senders = new Map((await db.query<{ id: string; name: string }>(`select i.item_id::text id, u.name from sources.affinity_write_item i
    join platform.app_user u on u.id = i.proposed_by where i.batch_id = $1`, [batchId])).map((r) => [r.id, r.name]));
  let written = 0, failed = 0;
  for (const it of items) {
    let personId = it.affinityPersonId, created: number | null = null;
    try {
      // Mail another item has written since this one was proposed (two batches over the same mail) is not noted twice.
      const noted = new Set((await db.query<{ messages: WriteItem['messages'] }>(`select messages from sources.affinity_write_item
        where address = $1 and state = 'written' and item_id <> $2`, [it.address, it.itemId])).flatMap((r) => r.messages.map(messageKey)));
      if (noted.size && it.messages.every((m) => noted.has(messageKey(m)))) {
        await db.query(`update sources.affinity_write_item set state = 'skipped', reason = 'Already written to Affinity by another batch.' where item_id = $1`, [it.itemId]);
        continue;
      }
      // A person already created for this address (an earlier batch, or an item before this one) is noted, never made twice.
      const made = it.plan === 'person+note' || !personId ? (await db.one<{ id: number }>(`select created_person_id::float8 id from sources.affinity_write_item
        where address = $1 and created_person_id is not null order by written_at desc nulls last limit 1`, [it.address]))?.id ?? null : null;
      if (made) personId = made;
      else if (it.plan === 'person+note' || !personId) {
        created = await w.createPerson({ ...nameParts(it.name, it.address), emails: [it.address] });
        personId = created;
        await db.query(`update sources.affinity_write_item set created_person_id = $2 where item_id = $1`, [it.itemId, created]);
      }
      const noteId = await w.createNote({ personIds: [personId], content: noteContent(senders.get(it.itemId) ?? 'We', it) });
      await db.query(`update sources.affinity_write_item set state = 'written', affinity_note_id = $2, written_at = now(), error = null where item_id = $1`, [it.itemId, noteId]);
      written++;
    } catch (err) {
      failed++;
      // Refused before sending, or answered with an error: nothing landed. Anything else (no answer, or a failure after
      // Affinity said yes) may have, so the item is marked and its mail is not proposed again (17 Oct 2026).
      const none = err instanceof AffinityWriteRefused || (err instanceof AffinityWriteError && err.status !== null && (err.status < 200 || err.status >= 300));
      await db.query(`update sources.affinity_write_item set state = 'failed', error = $2 where item_id = $1`,
        [it.itemId, `${none ? '' : UNCERTAIN}${err instanceof Error ? err.message : String(err)}`.slice(0, 300)]);
    }
  }
  await db.query(`update sources.affinity_write_batch set finished_at = now() where batch_id = $1`, [batchId]);
  await appendAudit({ actorId: user.id, action: 'affinity.write_batch_written', subjectType: 'affinity_write_batch', subjectId: batchId, detail: { written, failed } });
  return { written, failed };
}
