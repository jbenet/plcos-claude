/** F5: invented, disposable real-scale page-data benchmark. Run: node --import tsx scripts/viewer-speed-bench.ts
 * No configured DB is opened; no connector runs. Timings exclude SSR/network, include SQL + projection.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPglite } from '../lib/db/pglite';
import { migrate } from '../lib/db/migrate';
import { withDb, type Db } from '../lib/db';
import { scopedReadData } from '../lib/authz/read/scoped-data';
import { pipelineData } from '../lib/pipeline-data';
import { refuseRealEnvironment } from './perf4-fixture';

// Frozen pre-F5 query: deliberately retain the expensive cross product to measure before/after.
const beforeSql = `select distinct 'affinity:' || n.source_id id,
    identity.canonical_entity_id(r.entity_id)::text "entityId",
    nullif(trim(concat_ws(' ',n.payload#>>'{creator,firstName}',n.payload#>>'{creator,lastName}')),'') author,
    coalesce(n.payload->>'createdAt',n.fetched_at::text) at
    from identity.source_record r join sources.raw_record n on n.source='affinity' and n.kind='note'
    where r.source='affinity' and identity.canonical_entity_id(r.entity_id)=any($1::uuid[])
      and ((r.source_id like 'person:%' and exists(select 1 from jsonb_array_elements(coalesce(n.payload#>'{personsPreview,data}','[]'::jsonb)) x where x->>'id'=split_part(r.source_id,':',2)))
        or (r.source_id like 'company:%' and exists(select 1 from jsonb_array_elements(coalesce(n.payload#>'{companiesPreview,data}','[]'::jsonb)) x where x->>'id'=split_part(r.source_id,':',2))))
      and not exists(select 1 from sources.raw_record newer where newer.source=n.source and newer.kind=n.kind
        and newer.source_id=n.source_id and (newer.fetched_at,newer.id)>(n.fetched_at,n.id))`;

const id = (n: number) => `f5555555-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const vehicle = id(1), other = id(2), owner = id(3);
refuseRealEnvironment();
const dir = await mkdtemp(join(tmpdir(), 'plcos-viewer-speed-'));
const db = await openPglite(join(dir, 'db'));
try {
  await migrate(db);
  await db.transaction(async tx => {
    await tx.query(`insert into platform.app_user(id,handle,name,initials,role,email,access)
      values($1,'invented-bench','Invented Operator','IO','GP','invented@example.invalid','admin')`, [owner]);
    for (const [v, slug] of [[vehicle, 'invented-a'], [other, 'invented-b']])
      await tx.query(`insert into platform.vehicle(id,slug,name,kind,exemption) values($1,$2,$2,'fund','506(c)')`, [v, slug]);
    await tx.exec(`insert into identity.entity(entity_id,entity_type,display_name)
      select md5('invented-lp-'||n)::uuid,'org','Invented LP '||n from generate_series(1,2000) n;
      insert into identity.entity(entity_id,entity_type,display_name)
      select md5('invented-person-'||n)::uuid,'person','Invented Person '||n from generate_series(1,43000) n;
      insert into identity.source_record(source,source_id,entity_id,resolved_by)
      select 'affinity','company:'||n,md5('invented-lp-'||n)::uuid,'rule:invented' from generate_series(1,2000) n;
      insert into identity.source_record(source,source_id,entity_id,resolved_by)
      select 'affinity','person:'||n,md5('invented-person-'||n)::uuid,'rule:invented' from generate_series(1,43000) n;`);
    await tx.query(`insert into strategy.pursuit(pursuit_id,entity_id,vehicle_id,owner_id,status)
      select md5('invented-pursuit-'||n)::uuid,md5('invented-lp-'||n)::uuid,$1,$2,'new' from generate_series(1,2000) n`, [vehicle, owner]);
    await tx.query(`insert into strategy.pursuit(pursuit_id,entity_id,vehicle_id,owner_id,status)
      select md5('invented-overlap-'||n)::uuid,md5('invented-lp-'||n)::uuid,$1,$2,'new' from generate_series(1,300) n`, [other, owner]);
    await tx.exec(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash)
      select md5('invented-pursuit-'||n)::uuid,'Invented strategy',
      '{"scores":{},"list":"this year","risks":[],"openQuestions":[]}'::jsonb,
      'Invented Strategist','2026-09-27','invented-'||n from generate_series(1,1500) n;
      insert into research.note(entity_id,kind,body,data)
      select md5('invented-lp-'||n)::uuid,'public_profile',repeat('Invented research finding. ',40),
        jsonb_build_object('summary','Invented research finding','facts','[]'::jsonb)
      from generate_series(1,2000) n;
      insert into research.note(entity_id,kind,body,data)
      select md5('invented-lp-'||n)::uuid,'context','Invented confidential note','{}'::jsonb
      from generate_series(1,2000) n;
      insert into sources.raw_record(source,kind,source_id,payload_hash,payload,fetched_at)
      select 'affinity','note','invented-note-'||n,'invented-version-'||version,
        jsonb_build_object('creator',jsonb_build_object('firstName','Invented','lastName','Author'),
          'createdAt','2026-09-27T00:00:00Z','content',jsonb_build_object('html','Invented private body'),
          'companiesPreview',jsonb_build_object('data',jsonb_build_array(jsonb_build_object('id',n))),
          'personsPreview',jsonb_build_object('data',jsonb_build_array(jsonb_build_object('id',n)))),
        '2026-09-26'::timestamptz+version*interval '1 day'
      from generate_series(1,2000) n cross join generate_series(0,1) version;`);
  });
  await db.exec('analyze');
  console.log('Invented fixture: 2,000 LPs; 2,300 pursuits; 1,500 strategies; 43,000 people; 4,000 research notes; 2,000 Affinity notes × 2 versions.');
  let baselineQueries = 0;
  const before: Db = { ...db, query: (sql, params) => {
    if (sql.includes("'affinity:' ||")) { baselineQueries++; return db.query(beforeSql, params); }
    return db.query(sql, params);
  } };
  const viewer = { access: 'viewer' as const, vehicles: null };
  const timings: Record<string, number[]> = {};
  let prior: unknown;
  const normalize = ({ asOf: _asOf, ...value }: Awaited<ReturnType<typeof scopedReadData>>) => ({
    ...value, notes: [...value.notes].sort((a,b) => `${a.id}:${a.entityId}`.localeCompare(`${b.id}:${b.entityId}`)),
  });
  for (const [name, run] of Object.entries({
    before: () => scopedReadData(viewer, before), after: () => scopedReadData(viewer, db),
    adminCold: async () => { await db.query('update network.read_revision set revision=revision+1 where singleton'); return withDb(db, () => pipelineData(vehicle)); },
    adminWarm: () => withDb(db, () => pipelineData(vehicle)),
  })) {
    timings[name] = [];
    for (let i=0;i<3;i++) {
      const start=performance.now(), result=await run(), ms=performance.now()-start;
      timings[name].push(ms);
      if (name==='before') prior=normalize(result as Awaited<ReturnType<typeof scopedReadData>>);
      if (name==='after') assert.deepEqual(normalize(result as Awaited<ReturnType<typeof scopedReadData>>), prior);
      console.log(`${name} sample ${i+1}: ${ms.toFixed(1)} ms`);
    }
  }
  assert.equal(baselineQueries, 3, 'Each baseline page load must use the original Affinity query');
  const medians = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, [...values].sort((a,b)=>a-b)[1]]));
  console.log(JSON.stringify({medianMs:medians, viewerToAdminCold:medians.after/medians.adminCold,
    viewerToAdminWarm:medians.after/medians.adminWarm, equivalent:true}));
} finally { await db.close(); await rm(dir,{recursive:true,force:true}); }
