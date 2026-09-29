import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { stripDakota } from '../strip-dakota';
import type { Check } from './harness';
import { translateDakota } from '../../lib/connectors/dakota/translate';
import { inventedDakotaReplicas } from '../dakota-batched-properties';
import { repointPursuits } from '../../modules/strategy/lp-units';
import { restoreChanges, type Change } from '../../modules/strategy/merge';

export async function stripDakotaProperties(check: Check) {
  const db = await openTestDb();
  try {
    await migrate(db);
    await db.exec(`
      insert into platform.app_user(id,handle,name,initials,role,email) values('10000000-0000-0000-0000-000000000001','invented','Invented','IN','admin','');
      insert into identity.entity(entity_id,entity_type,display_name) values
       ('20000000-0000-0000-0000-000000000001','person','Invented Dakota Name'),
       ('20000000-0000-0000-0000-000000000002','org','Invented Firm');
      insert into identity.source_record(source,source_id,entity_id,resolved_by) select s,entity_id::text,entity_id,'fixture'
       from identity.entity cross join (values('dakota'),('affinity')) v(s);
      insert into identity.external_identifier(entity_id,kind,value,source,as_of,confidence,last_verified_by)
       select entity_id,'domain',case when s='dakota' then 'secret.invalid' else 'public.invalid' end,s,now(),'medium','10000000-0000-0000-0000-000000000001'
       from identity.entity cross join (values('dakota'),('public')) v(s);
      insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body) values
       ('opaque-vendor','Invented','fixture','dakota',current_date,'weak','fixture','PRIVATE'),
       ('public-doc','Invented','fixture','public:South Dakota',current_date,'strong','fixture','PUBLIC');
      insert into research.claim(entity_id,field,value,source,as_of,confidence)
       select entity_id,'aum',case when doc_id='opaque-vendor' then 'PRIVATE' else 'PUBLIC' end,doc_id,current_date,'medium'
       from identity.entity cross join research.source_doc;
      insert into library.answer(answer_id,question,answer,owner_id) values
       ('40000000-0000-0000-0000-000000000001','Invented private question','PRIVATE','10000000-0000-0000-0000-000000000001'),
       ('40000000-0000-0000-0000-000000000002','Invented public question','PUBLIC','10000000-0000-0000-0000-000000000001');
      insert into library.answer_source(answer_id,doc_id) values
       ('40000000-0000-0000-0000-000000000001','opaque-vendor'),
       ('40000000-0000-0000-0000-000000000002','public-doc');
      insert into research.note(entity_id,body,data) select entity_id,'Invented',
       '{"email":"PRIVATE","email_source":"dakota","phone":"PRIVATE","phone_source":"opaque-vendor","company_domain":"PRIVATE","company_domain_source":{"file":"dakota/raw/invented.json"},"facts":[{"source":"dakota","value":"PRIVATE"},{"source":"opaque-vendor","value":"PRIVATE"},{"source":{"file":"dakota/raw/invented.json"},"value":"PRIVATE"},{"source":"public","value":"PUBLIC"}]}' from identity.entity;
      insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
       select '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','colleague','C',j::jsonb,current_date
       from (values ('[{"source":"dakota","note":"PRIVATE"}]'),
       ('[{"source":"dakota","note":"PRIVATE"},{"source":"public","note":"PUBLIC"}]'),
       ('[{"source":"public","note":"PUBLIC"}]')) v(j);
      insert into meetings.objection(entity_id,class,statement,status,answer,answer_source)
       values('20000000-0000-0000-0000-000000000001','team','Invented question','answered','PRIVATE','opaque-vendor');
      insert into platform.import_job(kind,actor,status) values
       ('findings','10000000-0000-0000-0000-000000000001','running'),
       ('prospects','10000000-0000-0000-0000-000000000001','queued'),
       ('affinity','10000000-0000-0000-0000-000000000001','completed');
    `);
    const names = await db.query('select * from identity.entity order by entity_id');
    const publicClaims = await db.query("select * from research.claim where source='public-doc' order by claim_id");
    const publicIds = await db.query("select * from identity.external_identifier where source='public' order by entity_id");
    const publicAnswers = await db.query("select * from library.answer where answer='PUBLIC'");
    const counts = await stripDakota(db);
    check('CUTOVER Dakota source records and identifiers are removed; names and independent claims survive',
      counts['identity.source_record'] === 2 && counts['identity.external_identifier'] === 2
      && JSON.stringify(names) === JSON.stringify(await db.query('select * from identity.entity order by entity_id'))
      && JSON.stringify(publicClaims) === JSON.stringify(await db.query('select * from research.claim order by claim_id'))
      && JSON.stringify(publicIds) === JSON.stringify(await db.query('select * from identity.external_identifier order by entity_id')),
      'Invented fixtures: 4 source records → 2; 4 claims → 2; 4 identifiers → 2.');
    check('CUTOVER Dakota-only library prose is removed; independent answer survives byte for byte',
      JSON.stringify(publicAnswers) === JSON.stringify(await db.query('select * from library.answer')),
      'Opaque document provenance: 2 answers → 1.');
    const edges = await db.query<{ evidence: unknown }>('select evidence from network.edge');
    check('CUTOVER removes only Dakota evidence on mixed edges and nested facts', edges.length === 2
      && edges.every(e => JSON.stringify(e.evidence) === '[{"note":"PUBLIC","source":"public"}]')
      && !(await db.query<{ private: boolean }>(`select bool_or(data::text like '%PRIVATE%') private from research.note`))[0].private,
      '3 edges → 2, independently sourced facts retained.');
    const question = await db.one<{ answer: string | null; statement: string; status: string }>('select answer,statement,status from meetings.objection');
    check('CUTOVER nulls unsupported answer fields without losing the question', question?.answer === null
      && question.statement === 'Invented question' && question.status === 'open', 'Opaque source-document references included.');
    await stripDakota(db);
    check('CUTOVER stripping is repeatable', (await db.query('select * from network.edge')).length === 2, 'Second pass preserves survivors.');
    await db.exec(await readFile('scripts/stop-cutover-jobs.sql','utf8'));
    check('CUTOVER fails copied running and queued jobs; terminal jobs survive',
      Number((await db.one<{ n: string }>("select count(*)::text n from platform.import_job where status='failed' and error='stopped at cutover' and finished_at is not null"))?.n) === 2
      && Number((await db.one<{ n: string }>("select count(*)::text n from platform.import_job where status='completed'"))?.n) === 1,
      '2 active → 0; completed unchanged.');
    await db.exec(`insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body)
      values('mixed-vendor','Invented','fixture','dakota',current_date,'weak','fixture','PRIVATE');
      insert into library.answer_source(answer_id,doc_id) values
      ('40000000-0000-0000-0000-000000000002','mixed-vendor');`);
    const mixedBefore = await db.query('select * from library.answer_source order by doc_id');
    let mixedRefused = false;
    try { await stripDakota(db); } catch { mixedRefused = true; }
    check('CUTOVER mixed library prose refuses and rolls back without deleting public content', mixedRefused
      && JSON.stringify(mixedBefore) === JSON.stringify(await db.query('select * from library.answer_source order by doc_id'))
      && JSON.stringify(publicAnswers) === JSON.stringify(await db.query('select * from library.answer')),
      'Independent citations cannot justify silently retaining inseparable vendor prose.');
    await db.exec("delete from library.answer_source where doc_id='mixed-vendor'; delete from research.source_doc where doc_id='mixed-vendor'");
    // Unknown provenance must stop the transaction, including prior deletes.
    await db.exec(`create table public.future_fact(id int, evidence jsonb);
      insert into public.future_fact values(1,'{"source":"dakota","value":"PRIVATE"}');
      insert into identity.source_record values('dakota','again','20000000-0000-0000-0000-000000000001',null,'fixture',now());`);
    let refused = false;
    try { await stripDakota(db); } catch { refused = true; }
    check('CUTOVER unknown provenance rolls back and restores audit protection', refused
      && (await db.query("select 1 from identity.source_record where source='dakota'")).length === 1,
      'Future JSON shape cannot silently leak or partially strip.');
    let protectedAudit = false;
    try { await db.exec('delete from platform.audit_log'); } catch { protectedAudit = true; }
    check('CUTOVER audit append-only guard remains enabled', protectedAudit, 'Even after a failed stripping transaction.');
    await db.exec('drop table public.future_fact');
    // Inseparable confidence/history records must retain independent facts on refusal.
    for (const kind of ['match', 'audit']) {
      if (kind === 'match') await db.exec(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
        values('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',0.5,
        '[{"source":"dakota","value":"PRIVATE"},{"source":"public","value":"PUBLIC"}]')`);
      else await db.exec(`insert into platform.audit_log(action,subject_type,detail)
        values('invented.mixed','fixture','{"facts":[{"source":"dakota","value":"PRIVATE"},{"source":"public","value":"PUBLIC"}]}')`);
      let mixedStopped = false;
      try { await stripDakota(db); } catch { mixedStopped = true; }
      const kept = kind === 'match'
        ? await db.query("select 1 from identity.possible_match where signals::text like '%PUBLIC%'")
        : await db.query("select 1 from platform.audit_log where action='invented.mixed' and detail::text like '%PUBLIC%'");
      check(`CUTOVER mixed ${kind} evidence stops without losing independent facts`, mixedStopped && kept.length === 1,
        'Rollback preserves the complete mixed record for review.');
      if (kind === 'match') await db.exec('delete from identity.possible_match');

    }
  } finally { await db.close(); }
  await translatedDakotaProperty(check);
}

/** Exercise the actual writer and journal paths, not only hand-built source tags. */
async function translatedDakotaProperty(check: Check) {
  const db = await openTestDb();
  const actor = '10000000-0000-0000-0000-000000000001';
  const vehicle = '30000000-0000-0000-0000-000000000001';
  try {
    await migrate(db);
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,'invented','Invented','IN','fixture','')`, [actor]);
    await db.query(`insert into platform.vehicle(id,slug,name,kind,exemption) values($1,'invented-neurotech','Invented Neurotech','fund','506(c)')`, [vehicle]);
    const replicas = inventedDakotaReplicas(2, 4);
    // This reversal fixture needs distinct people, not same-name corroborated contacts.
    for (const replica of replicas) if (replica.module === 'contact') {
      replica.records = replica.records.map((record, index) => ({ ...record, lastname: `Cutover Contact ${index}` }));
      replica.hash = createHash('sha256').update(JSON.stringify(replica.records)).digest('hex');
    }
    await translateDakota(db, actor, replicas);
    // Model people whose firm has no pursuit yet, so the re-point creates it.
    await db.exec("delete from strategy.pursuit where source='dakota'");
    const people = await db.query<{ entity_id: string }>('select entity_id::text from dakota.contact order by id limit 3');
    for (const person of people) await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,source,status,status_source)
      values($1,$2,$3,'affinity','new','affinity')`, [person.entity_id, vehicle, actor]);
    const original = await db.query("select * from strategy.pursuit where source='affinity' order by pursuit_id");
    const repointed = await repointPursuits(db, actor);
    check('CUTOVER fixture exercises a real Dakota-derived LP re-point', repointed.moved === 3 && repointed.created === 2,
      'Actual translator affiliations feed three journals, two sharing a created pursuit.');
    // Force the creator first in descending UUID order, with the actual batch timestamp.
    const journals = await db.query<{ id: string; created_org_pursuit: boolean }>(
      'select id::text,created_org_pursuit from strategy.lp_repoint order by created_org_pursuit,id');
    for (const [i, journal] of journals.entries()) {
      const id = `90000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;
      await db.query('update strategy.lp_repoint set id=$2 where id=$1', [journal.id, id]);
      // Audit is append-only; preserve the writer's IDs by leaving its detail intact.
    }
    const tied = await db.one<{ n: number }>('select count(distinct created_at)::int n from strategy.lp_repoint');
    check('CUTOVER same-timestamp fixture orders creators before dependent contact journals',
      tied?.n === 1 && journals.filter(j => j.created_org_pursuit).length === 2,
      'Three re-points, two org pursuits, one transaction timestamp; creator UUIDs sort first.');
    let oldOrderFailed = false;
    try {
      await db.transaction(async tx => {
        const rows = await tx.query<{ changes: Change[] }>(
          'select changes from strategy.lp_repoint order by created_at desc,id desc');
        for (const row of rows) await restoreChanges(tx, row.changes, 'invented old-order probe');
        throw new Error('Fixture did not reproduce the dependency');
      });
    } catch (error) {
      oldOrderFailed = !!error && typeof error === 'object' && 'code' in error && error.code === '23503';
    }
    check('CUTOVER fixture reproduces FK 23503 under the former timestamp/UUID undo order', oldOrderFailed,
      'Probe rolls back; the production strip must resolve the same journal dependency.');
    const tableNames = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='dakota' order by tablename");
    const populated = await Promise.all(tableNames.map(async ({ tablename }) =>
      Number((await db.one<{ n: string }>(`select count(*)::text n from dakota.${tablename}`))!.n)));
    const names = await db.query('select entity_id,display_name from identity.entity order by entity_id');
    const contact = (await db.one<{ contact_id: string; role: string }>('select contact_id::text,role from strategy.pursuit_contact order by contact_id limit 1'))!;
    await db.query("update strategy.pursuit_contact set role='Invented later independent edit' where contact_id=$1", [contact.contact_id]);
    let conflictRefused = false;
    try { await stripDakota(db); } catch { conflictRefused = true; }
    check('CUTOVER journal conflicts preserve later independent edits and roll back stripping', conflictRefused
      && (await db.one<{ role: string }>('select role from strategy.pursuit_contact where contact_id=$1', [contact.contact_id]))?.role === 'Invented later independent edit'
      && Number((await db.one<{ n: string }>('select count(*)::text n from dakota.account'))?.n) === 2,
      'A changed postimage is refused, never overwritten or partially deleted.');
    await db.query('update strategy.pursuit_contact set role=$2 where contact_id=$1', [contact.contact_id, contact.role]);
    // A contact outside the selected journals is a real blocker, not permission to cascade.
    const shared = (await db.one<{ pursuit_id: string }>(`select pursuit_id::text from strategy.pursuit_contact
      group by pursuit_id having count(*)=2`))!.pursuit_id;
    const independent = (await db.one<{ contact_id: string }>(`insert into strategy.pursuit_contact
      (pursuit_id,person_entity,role,source,origin_pursuit_id)
      values($1,$2,'Invented independent contact','public',$1) returning contact_id::text`,
      [shared, people[1].entity_id]))!.contact_id;
    const snapshot = async () => JSON.stringify(await Promise.all([
      db.query('select * from strategy.pursuit order by pursuit_id'),
      db.query('select * from strategy.pursuit_contact order by contact_id'),
      db.query('select * from strategy.lp_repoint order by id'),
    ]));
    const blockedBefore = await snapshot();
    let dependenciesRefused = false;
    try { await stripDakota(db); } catch (error) {
      dependenciesRefused = error instanceof Error && error.message === 'Cutover stopped: unresolved re-point dependencies';
    }
    check('CUTOVER a permanently blocked journal stops after no progress and rolls back earlier undos',
      dependenciesRefused && blockedBefore === await snapshot(),
      'Independent contact, all pursuits and all journals survive unchanged.');
    await db.query('delete from strategy.pursuit_contact where contact_id=$1', [independent]);
    const counts = await stripDakota(db);
    const remaining = await Promise.all(tableNames.map(async ({ tablename }) =>
      Number((await db.one<{ n: string }>(`select count(*)::text n from dakota.${tablename}`))!.n)));
    check('CUTOVER empties all seven populated Dakota tables from the actual translator',
      tableNames.length === 7 && populated.every(n => n > 0) && remaining.every(n => n === 0),
      `Invented table counts ${populated.join('/')} → ${remaining.join('/')}.`);
    check('CUTOVER restores the independent pursuit before removing Dakota re-point derivatives', counts.repoints === 3
      && JSON.stringify(original) === JSON.stringify(await db.query("select * from strategy.pursuit where source='affinity' order by pursuit_id"))
      && !(await db.query('select 1 from strategy.lp_repoint')).length
      && !(await db.query('select 1 from strategy.pursuit_contact')).length
      && !(await db.query('select 1 from strategy.pursuit_update')).length
      && JSON.stringify(names) === JSON.stringify(await db.query('select entity_id,display_name from identity.entity order by entity_id')),
      'Dakota title and journal disappear; the original independent row and every name remain.');
    const columns = await db.query<{ table_schema: string; table_name: string; column_name: string }>(`
      select c.table_schema,c.table_name,c.column_name from information_schema.columns c
      join information_schema.tables t using(table_schema,table_name)
      where t.table_type='BASE TABLE' and c.table_schema not in ('information_schema','dakota')
      and c.table_schema !~ '^pg_' and c.column_name in ('source','origin','left_source','right_source','answer_source','evidence_kind')
      and c.data_type in ('text','character varying','USER-DEFINED')`);
    let residue = 0;
    for (const c of columns) residue += Number((await db.one<{ n: string }>(
      `select count(*)::text n from "${c.table_schema}"."${c.table_name}" where "${c.column_name}"::text ~* '(^|[^a-z0-9])dakota([^a-z0-9]|$)'`))!.n);
    check('CUTOVER catalog-wide source audit finds no Dakota provenance after translation', residue === 0,
      `${columns.length} scalar provenance columns checked, including constrained source enums.`);
  } finally { await db.close(); }
}
