/**
 * Affinity writes by batch (docs/27 §5b; Juan, 14 Oct 2026), on invented data and a scripted Affinity:
 *   - the wire guard sends only POST /persons and POST /notes to Affinity's host; the demo never gets the real transport;
 *   - proposing plans each item against our copy (internal skip, a note on a known person, person + note otherwise),
 *     merges a repeated address, and writes nothing to Affinity;
 *   - only an admin decides; the checked items are written (person, then note), the rest rejected; a decided batch
 *     cannot be decided again; over the request cap, nothing is decided.
 */
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

export async function affinityWriteProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { guardedWrite, affinityWriter, AffinityWriteRefused, AffinityWriteError } = await import('../../lib/connectors/affinity/write');
  const { AFFINITY_ORIGIN: A } = await import('../../lib/connectors/affinity/fetch');
  const aw = { ...(await import('../../lib/affinity-writes')), ...(await import('../../lib/affinity-writes-decide')) };
  const { config } = await import('../../config/deployment');
  resetWindows();

  // ── The wire guard ──
  let reached = 0;
  const wire = guardedWrite(async () => { reached++; return new Response('{"id":1}', { status: 200 }); });
  const attempt = async (u: string) => { try { await wire.post(new URL(u), '{}', {}); return null; } catch (e) { return e; } };
  const refused = [await attempt(`${A}/persons/5`), await attempt(`${A}/v2/persons`), await attempt(`${A}/lists`),
    await attempt('https://example.invalid/persons'), await attempt(`${A}/notes?x=1`)];
  const ok = await attempt(`${A}/notes`);
  let demoHttps: unknown = null;
  try { affinityWriter({ transport: wire, key: 'k' }); } catch (e) { demoHttps = e; }
  check('Affinity writes: the wire guard sends only POST /persons and /notes to Affinity\'s host; the demo never gets the real transport',
    refused.every((e) => e instanceof AffinityWriteRefused) && ok === null && reached === 1 && demoHttps instanceof Error,
    `refused ${refused.filter((e) => e instanceof AffinityWriteRefused).length}/5; allowed reached fetch ${reached}; demo with https: ${String((demoHttps as Error)?.message).slice(0, 60)}`);

  // ── Proposing ──
  const call = await outreachClient();
  const { juan, token, user } = await fixtures(db);
  const rw = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
  await db.query(`insert into sources.raw_record (source, kind, source_id, payload_hash, payload) values ('affinity', 'person', '777001', 'props-aw-1', $1::jsonb)`,
    [JSON.stringify({ id: 777001, firstName: 'Invented', lastName: 'Known', primaryEmailAddress: 'known@invented-aw.example', emailAddresses: ['known@invented-aw.example'] })]);
  const at = (d: string) => `${d}T15:00:00Z`;
  const body = { items: [
    { address: 'known@invented-aw.example', name: 'Invented Known', messages: [{ at: at('2026-10-08'), subject: 'Invented hello' }] },
    { address: 'New.Person@invented-aw.example', messages: [{ at: at('2026-10-09'), subject: 'Invented intro' }] },
    { address: juan.email, messages: [{ at: at('2026-10-09') }] },
  ] };
  const logBefore = (await db.one<{ n: number }>(`select count(*)::int n from sources.request_log where note = 'write'`))!.n;
  const r = await call(rw, 'affinity', {}, { method: 'POST', body });
  const plan = new Map<string, any>((r.json?.data?.items ?? []).map((i: any) => [i.address, i]));
  const again = await call(rw, 'affinity', {}, { method: 'POST', body: { items: [{ address: 'new.person@invented-aw.example', name: 'Invented Newperson', messages: [{ at: at('2026-10-11'), subject: 'Invented follow-up' }] }] } });
  const status = await call(rw, 'affinity', { batchId: r.json?.data?.batchId ?? '' });
  const items = status.json?.data?.batches?.[0]?.items ?? [];
  const merged = items.find((i: any) => i.address === 'new.person@invented-aw.example');
  const ro = await call(await token(juan, [OUTREACH_READ]), 'affinity', {}, { method: 'POST', body });
  check('Affinity writes: proposing plans each item (internal skip, a note on a known person, person + note) and merges a repeated address under a new id; it needs outreach:write and writes nothing to Affinity',
    r.status === 200 && plan.get('known@invented-aw.example')?.plan === 'note' && plan.get('new.person@invented-aw.example')?.plan === 'person+note'
    && plan.get(String(juan.email).toLowerCase())?.plan === 'skip' && again.json?.data?.items?.[0]?.itemId !== plan.get('new.person@invented-aw.example')?.itemId
    && items.filter((i: any) => i.address === 'new.person@invented-aw.example').length === 1
    && merged?.messages?.length === 2 && merged.name === 'Invented Newperson' && items.every((i: any) => i.state === 'proposed') && ro.status === 403
    && (await db.one<{ n: number }>(`select count(*)::int n from sources.request_log where note = 'write'`))!.n === logBefore,
    `plans ${JSON.stringify([...plan.values()].map((i) => i.plan))}; merged ${merged?.messages?.length} messages, name ${merged?.name}; read-only ${ro.status}`);

  // ── Deciding ──
  const sent: Array<{ kind: string; arg: any }> = [];
  const scripted = {
    kind: 'scripted' as const,
    createPerson: async (p: any) => { sent.push({ kind: 'person', arg: p }); return 880001; },
    createNote: async (n: any) => { sent.push({ kind: 'note', arg: n }); return 990000 + sent.length; },
  };
  const batch = (await aw.openWriteBatch())!;
  const ids = batch.items.filter((i) => i.plan !== 'skip').map((i) => i.itemId);
  const gp = await user('aw-team', 'team', null);
  let notAdmin: unknown = null;
  try { await aw.decideWriteBatch(gp, batch.batchId, ids, scripted); } catch (e) { notAdmin = e; }
  const cap = config.affinity.writeBatchMaxCalls;
  let overCap: unknown = null;
  (config.affinity as { writeBatchMaxCalls: number }).writeBatchMaxCalls = 2;
  try { await aw.decideWriteBatch(juan, batch.batchId, ids, scripted); } catch (e) { overCap = e; } finally { (config.affinity as { writeBatchMaxCalls: number }).writeBatchMaxCalls = cap; }
  const stillOpen = (await aw.openWriteBatch())?.batchId === batch.batchId && sent.length === 0;
  const res = await aw.decideWriteBatch(juan, batch.batchId, ids, scripted);
  let twice: unknown = null;
  try { await aw.decideWriteBatch(juan, batch.batchId, ids, scripted); } catch (e) { twice = e; }
  const after = await db.query<{ address: string; state: string; created: number | null; note: number | null }>(`select address, state, created_person_id::int created, affinity_note_id::int note
    from sources.affinity_write_item where batch_id = $1 order by address`, [batch.batchId]);
  const person = sent.find((s) => s.kind === 'person')?.arg;
  const noteOnKnown = sent.find((s) => s.kind === 'note' && s.arg.personIds[0] === 777001)?.arg;
  check('Affinity writes: only an admin decides; over the cap nothing is decided; the checked are written (person, then note) and the batch cannot be decided twice',
    notAdmin instanceof aw.WriteBatchRefused && overCap instanceof aw.WriteBatchRefused && stillOpen && res.written === 2 && res.failed === 0
    && sent.length === 3 && person?.firstName === 'Invented' && person.lastName === 'Newperson' && person.emails[0] === 'new.person@invented-aw.example'
    && sent.some((s) => s.kind === 'note' && s.arg.personIds[0] === 880001) && /2026-10-08 · Invented hello/.test(noteOnKnown?.content ?? '')
    && after.filter((a) => a.state === 'written').length === 2 && after.some((a) => a.state === 'skipped') && twice instanceof aw.WriteBatchRefused,
    `not admin: ${String((notAdmin as Error)?.message).slice(0, 40)}; over cap: ${String((overCap as Error)?.message).slice(0, 40)}; written ${res.written}; calls ${sent.map((s) => s.kind).join(',')}; states ${after.map((a) => a.state).join(',')}`);

  // ── Red-team pass, 14 Oct 2026 ──
  // Proposing again after a write: the person we created is noted, never made twice; mail already noted is not noted
  // again, while mail sent later the same day is; an address an older Affinity record listed is not a match.
  await db.query(`insert into sources.raw_record (source, kind, source_id, payload_hash, payload, fetched_at) values
    ('affinity', 'person', '777002', 'props-aw-2', $1::jsonb, now() - interval '2 days'),
    ('affinity', 'person', '777002', 'props-aw-3', $2::jsonb, now())`,
    [JSON.stringify({ id: 777002, firstName: 'Invented', lastName: 'Moved', emailAddresses: ['moved@invented-aw.example'] }),
     JSON.stringify({ id: 777002, firstName: 'Invented', lastName: 'Moved', emailAddresses: ['elsewhere@invented-aw.example'] })]);
  const writtenDay = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 60_000).toISOString();
  const re = await call(rw, 'affinity', {}, { method: 'POST', body: { items: [
    { address: 'new.person@invented-aw.example', messages: [{ at: at('2026-10-09'), subject: 'Invented intro' }] },
    { address: 'known@invented-aw.example', messages: [{ at: at('2026-10-08'), subject: 'Invented hello' }, { at: later, subject: 'Invented same day' }] },
    { address: 'moved@invented-aw.example', messages: [{ at: at('2026-10-10'), subject: 'Invented moved' }] },
  ] } });
  const rePlan = new Map<string, any>((re.json?.data?.items ?? []).map((i: any) => [i.address, i]));
  const reItems = (await aw.openWriteBatch())?.items ?? [];
  const knownItem = reItems.find((i) => i.address === 'known@invented-aw.example');
  check('Affinity writes: proposing again skips mail already noted, notes mail sent later the same day, and reads only each Affinity person\'s newest record',
    rePlan.get('new.person@invented-aw.example')?.plan === 'skip' && rePlan.get('known@invented-aw.example')?.plan === 'note'
    && knownItem?.messages.length === 1 && knownItem.messages[0]!.subject === 'Invented same day'
    && rePlan.get('moved@invented-aw.example')?.plan === 'person+note',
    `plans ${JSON.stringify([...rePlan.values()].map((i) => [i.address, i.plan]))}; known messages ${knownItem?.messages.length}; day ${writtenDay}`);
  // The person we created and our copy has not synced: a new mail to them is a note on that person.
  const fresh = await call(rw, 'affinity', {}, { method: 'POST', body: { items: [
    { address: 'new.person@invented-aw.example', messages: [{ at: later, subject: 'Invented next' }] }] } });
  const freshItem = ((await aw.openWriteBatch())?.items ?? []).find((i) => i.address === 'new.person@invented-aw.example');
  check('Affinity writes: an address whose person we created is a note on that person, never a second person',
    fresh.json?.data?.items?.[0]?.plan === 'note' && freshItem?.affinityPersonId === 880001, `plan ${fresh.json?.data?.items?.[0]?.plan}; person ${freshItem?.affinityPersonId}`);
  // Deciding with only what was shown: an item proposed after the page was drawn moves to the next batch, undecided.
  const drawn = (await aw.openWriteBatch())!;
  const shownIds = drawn.items.map((i) => i.itemId);
  await call(rw, 'affinity', {}, { method: 'POST', body: { items: [{ address: 'late@invented-aw.example', messages: [{ at: at('2026-10-12'), subject: 'Invented late' }] }] } });
  sent.length = 0;
  await aw.decideWriteBatch(juan, drawn.batchId, [], scripted, shownIds);
  const nextBatch = await aw.openWriteBatch();
  let badId: unknown = null;
  try { await aw.decideWriteBatch(juan, 'not-a-batch', [], scripted); } catch (e) { badId = e; }
  check('Affinity writes: an item proposed after the page was drawn is not rejected unseen; it waits in the next batch',
    nextBatch !== null && nextBatch.batchId !== drawn.batchId && nextBatch.items.length === 1 && nextBatch.items[0]!.address === 'late@invented-aw.example'
    && nextBatch.items[0]!.state === 'proposed' && sent.length === 0 && badId instanceof aw.WriteBatchRefused,
    `next ${nextBatch?.batchId === drawn.batchId ? 'same batch' : nextBatch?.items.map((i) => i.address).join(',')}; calls ${sent.length}; bad id ${String((badId as Error)?.message).slice(0, 40)}`);

  // ── Red-team pass, 17 Oct 2026 ──
  // An item changed after the page was drawn (more mail, another proposer) is a new item: approving the id that was
  // shown writes nothing, and the changed item waits in the next batch, attributed to whoever proposed it last.
  const ines = await user('aw-other', 'admin', null);
  const other = await token(ines, [OUTREACH_READ, OUTREACH_WRITE]);
  const seenBatch = (await aw.openWriteBatch())!;
  const seenItem = seenBatch.items.find((i) => i.address === 'late@invented-aw.example')!;
  await call(other, 'affinity', {}, { method: 'POST', body: { items: [{ address: 'late@invented-aw.example', messages: [{ at: at('2026-10-13'), subject: 'Invented changed' }] }] } });
  sent.length = 0;
  await aw.decideWriteBatch(juan, seenBatch.batchId, [seenItem.itemId], scripted, [seenItem.itemId]);
  const moved = await aw.openWriteBatch();
  const movedItem = moved?.items.find((i) => i.address === 'late@invented-aw.example');
  const by = await db.one<{ id: string }>(`select proposed_by::text id from sources.affinity_write_item where item_id = $1`, [movedItem?.itemId ?? seenItem.itemId]);
  check('Affinity writes: an item changed after it was shown is not written on the shown id; it waits in the next batch under its latest proposer',
    sent.length === 0 && moved !== null && moved.batchId !== seenBatch.batchId && movedItem?.state === 'proposed' && movedItem.itemId !== seenItem.itemId
    && movedItem.messages.length === 2 && by?.id === ines.id,
    `calls ${sent.length}; next ${moved?.batchId === seenBatch.batchId ? 'same batch' : 'new'}; item ${movedItem?.state}, ${movedItem?.messages.length} messages; proposer ${by?.id === ines.id ? 'latest' : 'first'}`);

  // A write that got no answer may have landed: its mail is not proposed again. One Affinity refused is proposed again.
  const flaky = { ...scripted, createNote: async () => { throw new Error('socket hang up'); } };
  const refusing = { ...scripted, createNote: async () => { throw new AffinityWriteError(422, 'Affinity answered 422'); } };
  const toDecide = (await aw.openWriteBatch())!;
  await aw.decideWriteBatch(juan, toDecide.batchId, [movedItem!.itemId], flaky, toDecide.items.map((i) => i.itemId));
  await call(rw, 'affinity', {}, { method: 'POST', body: { items: [
    { address: 'late@invented-aw.example', messages: [{ at: at('2026-10-12'), subject: 'Invented late' }, { at: at('2026-10-13'), subject: 'Invented changed' }] },
    { address: 'refused@invented-aw.example', messages: [{ at: at('2026-10-13'), subject: 'Invented refused' }] }] } });
  const b2 = (await aw.openWriteBatch())!;
  await aw.decideWriteBatch(juan, b2.batchId, b2.items.filter((i) => i.address === 'refused@invented-aw.example').map((i) => i.itemId), refusing, b2.items.map((i) => i.itemId));
  const replan = await call(rw, 'affinity', {}, { method: 'POST', body: { items: [
    { address: 'late@invented-aw.example', messages: [{ at: at('2026-10-13'), subject: 'Invented changed' }] },
    { address: 'refused@invented-aw.example', messages: [{ at: at('2026-10-13'), subject: 'Invented refused' }] }] } });
  const rp = new Map<string, any>((replan.json?.data?.items ?? []).map((i: any) => [i.address, i]));
  check('Affinity writes: mail whose write got no answer is not proposed again (it may be in Affinity); mail Affinity refused is',
    rp.get('late@invented-aw.example')?.plan === 'skip' && /may have landed/.test(rp.get('late@invented-aw.example')?.reason ?? '')
    && rp.get('refused@invented-aw.example')?.plan !== 'skip',
    `plans ${JSON.stringify([...rp.values()].map((i) => [i.address, i.plan, String(i.reason).slice(0, 50)]))}`);
}
