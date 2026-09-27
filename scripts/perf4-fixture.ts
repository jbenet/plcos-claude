/** Invented scale fixture. Never opens the configured application database. */
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Db } from '../lib/db';

export const fixtureVersion = 'perf4-invented-v1';
export const fixtureId = (n: number) => `f4444444-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const fixtureAt = '2026-09-27T00:00:00.000Z';
export function refuseRealEnvironment() {
  if (process.env.DATA_PROFILE && process.env.DATA_PROFILE !== 'demo') throw new Error('Performance fixtures require the demo profile.');
  if (process.env.DATABASE_URL) throw new Error('Performance fixtures refuse DATABASE_URL.');
  if (process.env.PGLITE_DIR) throw new Error('Performance fixtures refuse PGLITE_DIR; use --dir for a marked scratch fixture.');
}
/** Reject real components and links before any database opens, including links through ancestors. */
export async function safeFixtureDirectory(path: string, existing: boolean): Promise<string> {
  const target = resolve(path);
  if (target.split(sep).some(x => /^(real|plcos-data)$/i.test(x))) throw new Error('Performance fixtures refuse real-data paths.');
  for (let part = target; ; part = dirname(part)) {
    const info = await lstat(part).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
    // macOS /tmp itself is a standard link. Resolve it once; arbitrary links are refused.
    if (info?.isSymbolicLink() && part !== '/tmp' && part !== '/var') throw new Error('Performance fixtures refuse symbolic-link paths.');
    if (part === dirname(part)) break;
  }
  const parent = await realpath(existing ? target : dirname(target));
  if (parent.split(sep).some(x => /^(real|plcos-data)$/i.test(x))) throw new Error('Performance fixtures refuse resolved real-data paths.');
  if (existing && (await lstat(join(target,'db'))).isSymbolicLink()) throw new Error('Performance fixtures refuse symbolic-link database directories.');
  if (existing && (await readFile(join(target, '.perf4-invented'), 'utf8')).trim() !== fixtureVersion) throw new Error('Not a marked invented performance fixture.');
  return target;
}

export async function createFixture(requested?: string): Promise<string> {
  refuseRealEnvironment();
  const dir = requested ? await safeFixtureDirectory(requested, false)
    : await mkdtemp(await safeFixtureDirectory(join(tmpdir(), 'plcos-perf4-'), false));
  if (requested) await mkdir(dir); // Existing directories are never seeded or reset.
  await writeFile(join(dir, '.perf4-invented'), fixtureVersion + '\n', { flag: 'wx' });
  const [{ openPglite }, { migrate }, { seed }, { withDb }] = await Promise.all([
    import('../lib/db/pglite'), import('../lib/db/migrate'), import('../lib/seed'), import('../lib/db'),
  ]);
  const db = await openPglite(join(dir, 'db'));
  try {
    await migrate(db);
    await withDb(db, () => seed(db));
    await fill(db);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: fixtureVersion, invented: true,
      generatedAt: new Date().toISOString(), counts: await counts(db) }, null, 2));
  } finally { await db.close(); }
  return dir;
}
export async function counts(db: Db) {
  return db.one(`select (select count(*) from research.note where kind='public_profile')::int profiles,
    (select sum(jsonb_array_length(data->'paths')) from research.note where kind='connection_candidates')::int research_paths,
    (select count(*) from strategy.suggestion)::int strategies,
    (select count(*) from dakota.account)::int dakota_accounts,
    (select count(*) from dakota.contact)::int dakota_contacts,
    (select count(*) from strategy.pursuit p join platform.vehicle v on p.vehicle_id=v.id where v.slug='neurotech')::int pursuits,
    (select count(*) from network.route_cache)::int cached_targets,
    (select sum(jsonb_array_length(search->'routes')) from network.route_cache)::int cached_paths`);
}
export async function fill(db: Db) {
  const actor = (await db.one<{ id: string }>(`select id from platform.app_user where handle='juan'`))
    ?? (await db.one<{ id: string }>(`select id from platform.app_user order by handle limit 1`))!;
  const vehicle = (await db.one<{ id: string }>(`select id from platform.vehicle where slug='neurotech'`))!;
  const { withDb } = await import('../lib/db');
  const { routeSources } = await import('../modules/network/repo');
  const sources = await withDb(db, () => routeSources());
  const source = sources[0];
  if (!source) throw new Error('Demo seed must contain a route source.');
  const profile = { researched: { at: fixtureAt, by: 'Invented fixture' }, identity: { match: 'confirmed', links: [] },
    profile: { capacity: { band: '$1–5M', basis: 'Invented fixture assets $100M.' } },
    summary: 'Invented allocator with an interest in healthcare. '.repeat(45), facts: [] };
  const strategy = { key: 'invented', name: 'Invented allocator', made: { at: fixtureAt, by: 'Invented fixture', workflow: 'W5', version: '1.18' },
    fit: { neurotech: { verdict: 'good', why: 'Invented healthcare focus.' } },
    scores: { capacity: { band: '$1–5M', basis: 'Invented assets $100M.' }, affinity: { level: 'medium', basis: 'Invented healthcare focus.' }, propensity: { level: 'medium', basis: 'Invented allocation history.' }, timeToDecision: { band: '1–2 months', basis: 'Invented timing.' } },
    angle: 'Invented healthcare allocation opportunity.', route: null,
    next: { what: 'Review the invented allocation mandate.', who: 'Invented operator', when: '2026-10-01' },
    ask: { vehicle: 'neurotech', shape: 'verify first' }, openQuestions: ['Invented allocation review date?'], risks: ['Invented mandate remains unverified.'], list: 'this year', confidence: 'medium' };
  await db.transaction(async tx => {
    // Large replica universe exercises every canonical-identity scan, mostly outside the 900-LP set.
    await tx.query(`insert into identity.entity(entity_id,entity_type,display_name,created_at)
      select ('f4444444-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,
      case when n between 5001 and 15000 then 'person' else 'org' end::identity.entity_type,
      'Invented Scale '||lpad(n::text,5,'0'),$1 from generate_series(1,15020) n`, [fixtureAt]);
    await tx.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,headline,opened_at)
      select entity_id,$1,$2,(array['new','sourcing','selected','connecting','discussing','committed','passed'])[1+(row_number() over(order by entity_id)%7)::int]::strategy.pursuit_status,
      'Invented scale allocator',$3 from identity.entity where entity_id=any($4::uuid[])`, [vehicle.id, actor.id, fixtureAt, Array.from({length:900},(_,i)=>fixtureId(i+1))]);
    await tx.query(`insert into research.note(entity_id,kind,body,data,created_at)
      select entity_id,'public_profile','Invented research profile',$1::jsonb,$2 from identity.entity where entity_id=any($3::uuid[])`, [JSON.stringify(profile),fixtureAt,Array.from({length:900},(_,i)=>fixtureId(i+1))]);
    await tx.query(`insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body)
      values('perf4-invented','Invented fixture','fixture','invented',$1,'weak','Invented facts only','Invented profile source')`,[fixtureAt]);
    await tx.query(`insert into research.claim(entity_id,field,value,source,as_of,confidence,last_verified_by)
      select entity_id,'invented.field.'||n,'Invented claim '||n,'perf4-invented',$1,'medium',$2
      from identity.entity cross join generate_series(1,8) n where entity_id=any($3::uuid[])`,[fixtureAt,actor.id,Array.from({length:900},(_,i)=>fixtureId(i+1))]);
    await tx.query(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash)
      select pursuit_id,'Review the invented allocation mandate.',$1::jsonb,'Invented fixture',$2,'perf4-'||pursuit_id
      from strategy.pursuit where entity_id=any($3::uuid[]) and vehicle_id=$4`,[JSON.stringify(strategy),fixtureAt,Array.from({length:500},(_,i)=>fixtureId(i+1)),vehicle.id]);
    await tx.query(`insert into dakota.account(id,entity_id,type,website,description,aum__c,average_ticket_size__c,lastmodifieddate,replica_file,last_verified_by)
      select 'invented-a-'||n,('f4444444-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'Family Office',
      'https://invented-'||n||'.example','Invented account prose','100000000','750000',$1,'invented-fixture',$2 from generate_series(1,5000) n`,[fixtureAt,actor.id]);
    await tx.query(`insert into dakota.contact(id,entity_id,accountid,firstname,lastname,title,lastmodifieddate,replica_file,last_verified_by)
      select 'invented-c-'||n,('f4444444-0000-4000-8000-'||lpad(to_hex(n+5000),12,'0'))::uuid,
      'invented-a-'||(1+(n%5000)),'Invented','Contact '||n,'Investment Director',$1,'invented-fixture',$2 from generate_series(1,10000) n`,[fixtureAt,actor.id]);
    await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by,resolved_at)
      select 'dakota','account:'||id,entity_id,'invented-fixture',$1::timestamptz from dakota.account union all
      select 'dakota','contact:'||id,entity_id,'invented-fixture',$1::timestamptz from dakota.contact`,[fixtureAt]);
    await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty)
      select c.entity_id,a.entity_id,'staff','Investment Director','invented-fixture',$1,'inferred' from dakota.contact c join dakota.account a on a.id=c.accountid`,[fixtureAt]);
    await tx.query(`insert into network.edge(edge_id,from_entity,to_entity,kind,tier,valid_from,evidence)
      select ('f4444444-0000-4000-8000-'||lpad(to_hex(100000+n),12,'0'))::uuid,$1,
      ('f4444444-0000-4000-8000-'||lpad(to_hex(15000+n),12,'0'))::uuid,'colleague','B',$2,$3::jsonb from generate_series(1,17) n`,[source.entityId,fixtureAt,JSON.stringify([{source:'Invented fixture',note:'Invented documented working relationship.',asOf:fixtureAt}])]);
    await tx.query(`insert into network.edge(edge_id,from_entity,to_entity,kind,tier,valid_from,evidence)
      select ('f4444444-0000-4000-8000-'||lpad(to_hex(200000+lp*100+n),12,'0'))::uuid,
      ('f4444444-0000-4000-8000-'||lpad(to_hex(15000+n),12,'0'))::uuid,
      ('f4444444-0000-4000-8000-'||lpad(to_hex(lp),12,'0'))::uuid,'colleague','B',$1,$2::jsonb
      from generate_series(1,600) lp cross join generate_series(1,17) n`,[fixtureAt,JSON.stringify([{source:'Invented fixture',note:'Invented documented allocator relationship.',asOf:fixtureAt}])]);
    await tx.query(`insert into pipeline.exposure(entity_id,vehicle_id,instrument,track,amount,owner_id,opened_at)
      select entity_id,$1,'lp_commitment','soft',750000,$2,$3 from identity.entity where entity_id=any($4::uuid[])`,[vehicle.id,actor.id,fixtureAt,Array.from({length:250},(_,i)=>fixtureId(i+1))]);
  });
  // Stored research paths model imported W3 records independently of graph materialisation.
  for (let lp=1;lp<=600;lp++) {
    const paths=Array.from({length:17},(_,i)=>({lp:fixtureId(lp),tier:'B',kind:'colleague',other:{type:'ours',name:`Invented Scale ${String(15001+i).padStart(5,'0')}`,key:fixtureId(15001+i)},source:'https://fixture.example',chain:[source.name,`Invented Scale ${String(15001+i).padStart(5,'0')}`,`Invented Scale ${String(lp).padStart(5,'0')}`],basis:'Invented documented working relationship.',sources:['https://fixture.example'],as_of:fixtureAt,found:fixtureAt}));
    await db.query(`insert into research.note(entity_id,kind,body,data,created_at) values($1,'connection_candidates','17 invented paths',$2::jsonb,$3)`,[fixtureId(lp),JSON.stringify({paths}),fixtureAt]);
  }
  await db.exec('analyze');
  // The graph is regular: materialise one production search and substitute the target and
  // its 17 unique edge IDs. Every substituted edge exists; no synthetic score or guard logic.
  const { cachedRoutes, revisionFor } = await import('../modules/network/cache');
  const { computeStructuralRoutes } = await import('../modules/network/service');
  await withDb(db, () => cachedRoutes(fixtureId(1),'fund',()=>computeStructuralRoutes('',fixtureId(1),3,'fund','team')));
  const template=(await db.one<{search:string;best_score:number}>(`select search::text search,best_score from network.route_cache where target_id=$1`,[fixtureId(1)]))!;
  const revision=await withDb(db,()=>revisionFor(db));
  for(let lp=2;lp<=600;lp++) {
    let search=template.search.replaceAll(fixtureId(1),fixtureId(lp)).replaceAll('Invented Scale 00001',`Invented Scale ${String(lp).padStart(5,'0')}`);
    for(let n=1;n<=17;n++) search=search.replaceAll(fixtureId(200100+n),fixtureId(200000+lp*100+n));
    await db.query(`insert into network.route_cache(target_id,vehicle_kind,revision,input_revision,computed_at,search,best_score)
      values($1,'fund',$2,$3,$4,$5::jsonb,$6)`,[fixtureId(lp),revision.generation,revision.revision,fixtureAt,search,template.best_score]);
  }
  await db.exec('analyze');
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2); const dir=args[0]==='--dir'?args[1]:undefined;
  if(args.length && (!dir || args.length!==2)) throw new Error('Usage: npm run perf4:seed [-- --dir NEW_DIRECTORY]');
  createFixture(dir).then(path=>console.log(JSON.stringify({fixture:path,database:join(path,'db')}))).catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
}
