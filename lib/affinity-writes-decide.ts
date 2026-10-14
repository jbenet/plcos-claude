import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { appendAudit, type AppUser } from '@/modules/platform';
import { affinityWriter, type AffinityWriter } from '@/lib/connectors/affinity/write';
import { callsFor, day, ROW, type WriteItem } from '@/lib/affinity-writes';

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

/**
 * Decide the open batch: the checked items are written, the rest rejected; skips stay skipped. Refused when the batch
 * is no longer open, is not this one, or the checked items would take more than the cap.
 */
export async function decideWriteBatch(user: AppUser, batchId: string, approve: string[], writer?: AffinityWriter) {
  requireMutationProfile();
  if (user.access !== 'admin') throw new WriteBatchRefused('Only an admin decides Affinity writes.');
  const db = await getDb();
  const chosen = new Set(approve);
  const items = await db.transaction(async (tx) => {
    const b = await tx.one<{ status: string }>(`select status from sources.affinity_write_batch where batch_id = $1 for update`, [batchId]);
    if (!b || b.status !== 'open') throw new WriteBatchRefused('That batch was decided already.');
    const all = await tx.query<WriteItem>(`${ROW} where batch_id = $1`, [batchId]);
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
      if (it.plan === 'person+note' || !personId) {
        created = await w.createPerson({ ...nameParts(it.name, it.address), emails: [it.address] });
        personId = created;
        await db.query(`update sources.affinity_write_item set created_person_id = $2 where item_id = $1`, [it.itemId, created]);
      }
      const noteId = await w.createNote({ personIds: [personId], content: noteContent(senders.get(it.itemId) ?? 'We', it) });
      await db.query(`update sources.affinity_write_item set state = 'written', affinity_note_id = $2, written_at = now(), error = null where item_id = $1`, [it.itemId, noteId]);
      written++;
    } catch (err) {
      failed++;
      await db.query(`update sources.affinity_write_item set state = 'failed', error = $2 where item_id = $1`,
        [it.itemId, (err instanceof Error ? err.message : String(err)).slice(0, 300)]);
    }
  }
  await db.query(`update sources.affinity_write_batch set finished_at = now() where batch_id = $1`, [batchId]);
  await appendAudit({ actorId: user.id, action: 'affinity.write_batch_written', subjectType: 'affinity_write_batch', subjectId: batchId, detail: { written, failed } });
  return { written, failed };
}
