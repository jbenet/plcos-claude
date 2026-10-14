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
  const { guardedWrite, affinityWriter, AffinityWriteRefused } = await import('../../lib/connectors/affinity/write');
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
  check('Affinity writes: proposing plans each item (internal skip, a note on a known person, person + note) and merges a repeated address; it needs outreach:write and writes nothing to Affinity',
    r.status === 200 && plan.get('known@invented-aw.example')?.plan === 'note' && plan.get('new.person@invented-aw.example')?.plan === 'person+note'
    && plan.get(String(juan.email).toLowerCase())?.plan === 'skip' && again.json?.data?.items?.[0]?.itemId === plan.get('new.person@invented-aw.example')?.itemId
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
}
