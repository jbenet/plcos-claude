/** All records are invented. Uses disposable databases; never opens a configured or live DB. */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Db } from '../lib/db';
import { openTestDb } from './properties/database';
import { migrate } from '../lib/db/migrate';
import { prioritizeDb, withForegroundDb } from '../lib/db/scheduling';
import { translateDakota } from '../lib/connectors/dakota/translate';
import { neededRecord, type Module, type Replica } from '../lib/connectors/dakota/replica';
import type { Check } from './properties/harness';

export const inventedActor = '11111111-1111-4111-8111-111111111111';
const vehicle = '22222222-2222-4222-8222-222222222222';
const at = '2026-09-01T12:00:00.000Z';
const pad = (n: number) => String(n).padStart(6, '0');

export function inventedDakotaReplicas(accountCount: number, contactCount: number): Replica[] {
  const replica = (module: Module, records: Record<string, unknown>[]): Replica => ({
    module, file: `${module}/invented-batched.jsonl`,
    hash: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    records: records.map(record => neededRecord(module, { lastmodifieddate: at, ...record })),
  });
  return [replica('account', Array.from({ length: accountCount }, (_, i) => ({
    id: `invented-a-${pad(i)}`, website: `https://invented-${i}.example`, type: 'Family Office',
    average_ticket_size__c: '750000', aum__c: '100000000', billingcity: 'Invented City',
    // The strongest candidates are deliberately at the END of the input, beyond the first batch.
    investment_interest__c: i >= Math.floor(accountCount * .8) ? 'healthcare; neurotech; venture; deep tech' : 'healthcare',
    venture_capital__c: 'true',
  }))), replica('contact', Array.from({ length: contactCount }, (_, i) => ({
    id: `invented-c-${pad(i)}`, accountid: `invented-a-${pad(i % accountCount)}`,
    account_name__c: `Invented Allocator ${pad(i % accountCount)}`,
    // Five namesakes per group exercise possible-match output without an all-pairs universe.
    firstname: 'Invented', lastname: `Contact ${pad(Math.floor(i / 5))}`,
    title: i % 2 ? 'Private Markets Director' : 'Chief Investment Officer',
    email: `invented-${i}@fixture.example`, mailingcity: 'Invented City',
  })))];
}

export async function inventedDakotaDb(accountCount: number) {
  const dir = await mkdtemp(join(tmpdir(), 'plcos-invented-dakota-batched-'));
  let db: Db = prioritizeDb(await openTestDb(join(dir, 'db')));
  try {
    await migrate(db);
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email)
      values($1,'invented-batched','Invented Batch Operator','IB','fixture','')`, [inventedActor]);
    await db.query(`insert into platform.vehicle(id,slug,name,kind,exemption)
      values($1,'invented-neurotech-batched','Invented Neurotech','fund','506(c)')`, [vehicle]);
    await db.query(`insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body)
      values('invented-dakota-index','Invented index fixture','fixture','invented',$1,'weak','Invented identity claims only','Invented source')`, [at]);
    await db.transaction(async tx => {
      for (let i = 0; i < accountCount; i += 100) {
        const id = (await tx.one<{ id: string }>(`insert into identity.entity(entity_type,display_name)
          values('org',$1) returning entity_id::text id`, [`Invented Existing Allocator ${i}`]))!.id;
        await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
          values('invented_fixture',$1,$2,'fixture')`, [`existing-${i}`, id]);
        const mode = (i / 100) % 4;
        if (mode === 0) await tx.query(`insert into identity.external_identifier(entity_id,kind,value,source,as_of,confidence,last_verified_by)
          values($1,'domain',$2,'invented_fixture',$3,'medium',$4)`, [id, `invented-${i}.example`, at, inventedActor]);
        if (mode === 1) await tx.query(`insert into research.claim(entity_id,field,value,source,as_of,confidence,last_verified_by)
          values($1,'website',$2,'invented-dakota-index',$3,'medium',$4)`, [id, `https://invented-${i}.example`, at, inventedActor]);
        await tx.query(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'public_profile',$3,$4::jsonb)`,
          [id, inventedActor, 'Invented profile prose. '.repeat(400), JSON.stringify({ identity: { links: [
            { kind: 'linkedin', url: `https://linkedin.com/company/invented-existing-${i}` },
            ...(mode === 2 ? [{ kind: 'website', url: `https://invented-${i}.example` }] : []),
          ] }, unrelated_prose: 'Invented irrelevant profile detail. '.repeat(300) })]);
        // Non-identity prose must not be loaded wholesale to construct identifier indexes.
        await tx.query(`insert into research.claim(entity_id,field,value,source,as_of,confidence,last_verified_by)
          select $1,'invented.non_identity.'||n,$2,'invented-dakota-index',$3,'low',$4 from generate_series(1,10) n`,
          [id, 'Invented unrelated investment background. '.repeat(200), at, inventedActor]);
        await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
          values('affinity',$1,$2,'fixture')`, [`organization:invented-existing-${i}`, id]);
        await tx.query(`insert into sources.raw_record(source,kind,source_id,payload_hash,payload)
          values('affinity','organization',$1,$2,$3::jsonb)`, [`invented-existing-${i}`, `invented-hash-${i}`, JSON.stringify({
          ...(mode === 3 ? { domain: `invented-${i}.example` } : {}),
          linkedinUrl: `https://linkedin.com/company/invented-existing-${i}`,
          unrelated_prose: 'Invented unrelated Affinity prose. '.repeat(500),
        })]);
        await tx.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_reason,status_set_by,source)
          values($1,$2,$3,'new','rule','Invented fixture',$3,'invented_fixture')`, [id, vehicle, inventedActor]);
      }
    });
    return {
      get db() { return db; },
      async restart() { await db.close(); db = prioritizeDb(await openTestDb(join(dir, 'db'))); },
      async close() { await db.close(); await rm(dir, { recursive: true, force: true }); },
    };
  } catch (error) { await db.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

/** UUIDs and wall-clock timestamps differ across independent DBs; compare source-addressed facts. */
async function semanticState(db: Db): Promise<string> {
  const state: Record<string, unknown> = {};
  state.accounts = await db.query(`select to_jsonb(a)-'entity_id' account,
    (select min(s.source||':'||s.source_id) from identity.source_record s
      where s.entity_id=identity.canonical_entity_id(a.entity_id)) canonical
    from dakota.account a order by a.id`);
  state.contacts = await db.query(`select to_jsonb(c)-'entity_id' contact from dakota.contact c order by c.id`);
  state.claims = await db.query(`select to_jsonb(c)-'entity_id' claim from dakota.claim c order by module,record_id,field`);
  state.matches = await db.query(`select least(l.source||':'||l.source_id,r.source||':'||r.source_id) a,
    greatest(l.source||':'||l.source_id,r.source||':'||r.source_id) b,m.confidence,m.signals,m.active
    from identity.possible_match m join identity.source_record l on l.entity_id=m.left_entity
    join identity.source_record r on r.entity_id=m.right_entity order by a,b`);
  state.assertions = await db.query(`select kind,left_source,left_source_id,right_source,right_source_id,rule,signals,note
    from identity.match_assertion order by left_source,left_source_id,right_source,right_source_id`);
  state.employment = await db.query(`select d.contact_id,a.id account_id,f.role,f.kind,f.is_primary,f.source,f.as_of,f.certainty,f.note,
    e.kind edge_kind,e.tier,e.evidence,e.valid_from,e.valid_to
    from dakota.employment d join identity.affiliation f on f.affiliation_id=d.affiliation_id
    join network.edge e on e.edge_id=d.edge_id join dakota.account a on a.entity_id=f.org_entity order by d.contact_id`);
  state.pursuits = await db.query(`select s.source||':'||s.source_id entity,p.status,p.status_source,p.status_reason,p.source
    from strategy.pursuit p join identity.source_record s on s.entity_id=p.entity_id order by entity`);
  state.replicas = await db.query('select * from dakota.replica order by module,file');
  return JSON.stringify(state);
}

export async function observeDakotaJob<T>(db: Db, work: () => Promise<T>) {
  let running = true, pending = false, completedDuringJob = 0, maxQueryMs = 0, maxTimerGapMs = 0;
  let lastTick = performance.now();
  const probes: Promise<void>[] = [], errors: unknown[] = [];
  const timer = setInterval(() => {
    const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick); lastTick = now;
    if (pending) return;
    pending = true;
    const started = performance.now();
    probes.push(db.one<{ answer: number }>('select 42 answer').then(row => {
      if (row?.answer !== 42) errors.push(new Error('Foreground query returned the wrong result.'));
      maxQueryMs = Math.max(maxQueryMs, performance.now() - started);
      if (running) completedDuringJob++;
    }).catch(error => { errors.push(error); }).finally(() => { pending = false; }));
  }, 20);
  const started = performance.now();
  try {
    const result = await work();
    running = false; clearInterval(timer); await Promise.all(probes);
    return { result, elapsedMs: performance.now() - started, completedDuringJob, maxQueryMs, maxTimerGapMs, errors };
  } finally { running = false; clearInterval(timer); await Promise.all(probes); }
}

export async function dakotaBatchedProperties(check: Check) {
  const replicas = inventedDakotaReplicas(300, 600);
  const uninterrupted = await inventedDakotaDb(300);
  const resumed = await inventedDakotaDb(300);
  try {
    const measured = await observeDakotaJob(uninterrupted.db, () => translateDakota(uninterrupted.db, inventedActor, replicas, { batchSize: 200 }));
    check('DAKOTA foreground pages keep their DB connection between background batches', measured.completedDuringJob > 1
      && measured.maxQueryMs < 2000 && measured.errors.length === 0,
    `${measured.completedDuringJob} foreground queries answered during 900 invented records; worst ${Math.ceil(measured.maxQueryMs)} ms (bound 2000 ms).`);
    check('DAKOTA translation yields the event loop during large invented work', measured.maxTimerGapMs < 2000,
      `20 ms heartbeat worst gap ${Math.ceil(measured.maxTimerGapMs)} ms (bound 2000 ms).`);
    let interrupted = false;
    const interruption = new Error('Invented interruption after committed checkpoint');
    try {
      await translateDakota(resumed.db, inventedActor, replicas, { batchSize: 200, afterBatch: async progress => {
        if (progress.done === 300) throw interruption;
      } });
    } catch (error) { if (error !== interruption) throw error; interrupted = true; }
    const partial = (await resumed.db.one<{ n: number }>('select count(*)::int n from dakota.account'))!.n;
    check('DAKOTA interruption retains committed records before process restart', interrupted && partial > 0,
      `${partial} invented accounts persisted at the interrupted checkpoint.`);
    await resumed.restart();
    const beforeFailedBatch = JSON.stringify(await resumed.db.one('select state from dakota.translation_job'));
    const beforeChangedInput = await semanticState(resumed.db);
    let refusedInputs = 0;
    for (const changed of [replicas.slice(0, 1), replicas.map(r => r.module === 'contact' ? { ...r, hash: 'invented-changed-hash' } : r)]) {
      try { await translateDakota(resumed.db, inventedActor, changed, { batchSize: 200 }); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'Dakota job inputs changed; resume refused.') throw error;
        refusedInputs++;
      }
    }
    check('DAKOTA active checkpoints reject missing or changed pinned inputs without mutations', refusedInputs === 2
      && beforeChangedInput === await semanticState(resumed.db)
      && beforeFailedBatch === JSON.stringify(await resumed.db.one('select state from dakota.translation_job')),
    'Both a missing contact replica and a changed contact hash are refused; original inputs remain resumable.');
    let contactWrites = 0, checkpointWritten = false, rolledBack = false;
    const faulty: Db = { ...resumed.db, transaction: fn => resumed.db.transaction(tx => {
      let batchContactWrites = 0;
      return fn({ ...tx, query: async <T>(sql: string, params?: unknown[]) => {
        const rows = await tx.query<T>(sql, params);
        if (/insert into dakota\.contact\(/.test(sql)) batchContactWrites++;
        // The time budget may end a batch before any fixed record count. Fail the
        // first contact transaction after BOTH its records and checkpoint are written.
        if (batchContactWrites > 0 && /update dakota\.translation_job set state=/.test(sql)) {
          contactWrites = batchContactWrites;
          checkpointWritten = true;
          throw interruption;
        }
        return rows;
      } });
    }) };
    try { await translateDakota(faulty, inventedActor, replicas, { batchSize: 200 }); }
    catch (error) { if (error !== interruption) throw error; rolledBack = true; }
    check('DAKOTA a failed transaction rolls back its records and checkpoint together', rolledBack && contactWrites > 0 && checkpointWritten
      && (await resumed.db.one<{ n: number }>('select count(*)::int n from dakota.contact'))!.n === 0
      && beforeFailedBatch === JSON.stringify(await resumed.db.one('select state from dakota.translation_job')),
    `An injected failure after ${contactWrites} contact writes and their checkpoint update leaves neither partial records nor an advanced cursor.`);
    await resumed.restart();
    let claimBatches = 0, claimInterrupted = false;
    try {
      await translateDakota(resumed.db, inventedActor, replicas, { batchSize: 200, afterBatch: async progress => {
        if (progress.phase === 'account claims' && ++claimBatches === 2) throw interruption;
      } });
    } catch (error) { if (error !== interruption) throw error; claimInterrupted = true; }
    check('DAKOTA also resumes after sourcing and a committed claims batch', claimInterrupted
      && (await resumed.db.one<{ n: number }>("select count(*)::int n from strategy.pursuit where source='dakota'"))!.n > 0
      && (await resumed.db.one<{ n: number }>('select count(*)::int n from dakota.claim'))!.n > 0,
    'Ranked candidates and the first claim batch survive a second process restart.');
    await resumed.restart();
    const final = await translateDakota(resumed.db, inventedActor, replicas, { batchSize: 200 });
    const expected = await semanticState(uninterrupted.db), actual = await semanticState(resumed.db);
    check('DAKOTA restarting from its checkpoint has the uninterrupted semantic end state', expected === actual,
      'Source-addressed records, identity assertions, possible matches, employment, ranked pursuits, claims and replica hashes agree.');
    check('DAKOTA resumed receipt includes every committed batch exactly once',
      Object.entries(measured.result).every(([key, value]) => final[key as keyof typeof final] === value),
      'Cumulative counts agree after closing and reopening the interrupted database.');
    const winners = await resumed.db.query<{ id: string }>(`select a.id from dakota.account a join strategy.pursuit p
      on p.entity_id=a.entity_id where p.source='dakota' order by a.id`);
    check('DAKOTA sourcing ranks the entire replica before applying vehicle caps',
      Array.from({ length: 60 }, (_, i) => `invented-a-${pad(240 + i)}`).every(id => winners.some(w => w.id === id)),
      'All 60 strongest candidates from the end of the input survive the cap.');
    const replay = await translateDakota(resumed.db, inventedActor, replicas, { batchSize: 200 });
    check('DAKOTA replay after restart is fully idempotent', actual === await semanticState(resumed.db)
      && Object.values(replay).every(n => n === 0), 'Completed replicas cause no domain change and return a zero-change receipt.');
  } finally { await uninterrupted.close(); await resumed.close(); }

  const correction = await inventedDakotaDb(220);
  try {
    const target = (await correction.db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name)
      values('org','Invented Between Batch Target') returning entity_id::text id`))!.id;
    await correction.db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      values('invented_fixture','between-batch-target',$1,'fixture')`, [target]);
    let changed = false;
    await translateDakota(correction.db, inventedActor, inventedDakotaReplicas(220, 440), { batchSize: 100, afterBatch: async progress => {
      if (changed || progress.done === 0) return;
      changed = true;
      await withForegroundDb(correction.db, () => correction.db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        values('dakota','account:invented-a-000219',$1,'invented foreground binding')`, [target]));
    } });
    const linked = await correction.db.one<{ root: string }>(`select identity.canonical_entity_id(entity_id)::text root
      from dakota.account where id='invented-a-000219'`);
    check('DAKOTA sees source bindings added by a foreground change between batches', changed && linked?.root === target,
      'A new foreground source binding is visible to a later record; the cached index never overrides the correction.');
  } finally { await correction.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = 0;
  await dakotaBatchedProperties((name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) failed++; });
  if (failed) process.exitCode = 1;
}
