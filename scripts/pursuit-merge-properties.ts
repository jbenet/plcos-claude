/** Pursuit consolidation uses invented identities and evidence only. */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb } from '../lib/db';
import { importFindings } from '../lib/enrich/import';
import { latestRun } from '../modules/sources';
import { consolidatePursuits, pursuitReferences, reversePursuitMerge } from '../modules/strategy/merge';
import { auditFor } from '../modules/platform';
import { getPursuit, statusCounts } from '../modules/strategy';
import type { PursuitStatus } from '../modules/strategy/types';
import type { Check, Db } from './properties/harness';

type Spec = { status: PursuitStatus; human?: string; opened?: string; owner?: string };
export async function pursuitMergeProperties(check: Check, db: Db) {
  const users = await db.query<{ id: string }>('select id::text from platform.app_user where active order by handle');
  const actor = users[0]!.id, otherOwner = users[1]?.id ?? actor;
  const vehicle = (await db.one<{ id: string }>("select id::text from platform.vehicle where phase='active' and kind='fund' limit 1"))!.id;
  const entities: string[] = [], pursuits: string[] = [];
  const count = async (sql: string, params: unknown[] = []) => (await db.one<{ n: number }>(sql, params))!.n;
  const group = async (specs: Spec[]) => {
    const ids: string[] = [], root = randomUUID();
    for (const [index, spec] of specs.entries()) {
      const entity = index ? randomUUID() : root, id = randomUUID(); entities.push(entity); pursuits.push(id); ids.push(id);
      await db.query("insert into identity.entity(entity_id,entity_type,display_name,merged_into) values($1,'person',$2,$3)",
        [entity, `Invented pursuit merger ${root.slice(0,8)} ${index}`, index ? root : null]);
      await db.query(`insert into strategy.pursuit(pursuit_id,entity_id,vehicle_id,owner_id,status,status_source,status_set_at,opened_at)
        values($1,$2,$3,$4,$5::strategy.pursuit_status,$6,$7,$8)`,
        [id,entity,vehicle,spec.owner ?? actor,spec.status,spec.human ? 'us' : 'rule',spec.human ?? null,spec.opened ?? `2026-09-${String(index+1).padStart(2,'0')}T00:00:00Z`]);
      if (spec.human) await db.query(`insert into platform.audit_log(at,actor_id,action,subject_type,subject_id,detail)
        values($1,$2,'pursuit.status_set','pursuit',$3,$4::jsonb)`,
        [spec.human,actor,id,JSON.stringify({fromId:'new',toId:spec.status})]);
    }
    return ids;
  };
  const run = () => consolidatePursuits(db,actor);
  const mergedTo = async (id: string) => (await db.one<{ merged_into: string | null }>('select merged_into::text from strategy.pursuit where pursuit_id=$1',[id]))!.merged_into;
  const snapshot = async (ids: string[]) => JSON.stringify(await db.query(`select * from (select 'pursuit' kind,to_jsonb(t) value from strategy.pursuit t where pursuit_id=any($1::uuid[])
    union all select 'ladder',to_jsonb(t) from strategy.ladder_event t where pursuit_id=any($1::uuid[])
    union all select 'suggestion',to_jsonb(t) from strategy.suggestion t where pursuit_id=any($1::uuid[])
    union all select 'update',to_jsonb(t) from strategy.pursuit_update t where pursuit_id=any($1::uuid[])
    union all select 'owner',to_jsonb(t) from strategy.pursuit_owner t where pursuit_id=any($1::uuid[])
    union all select 'meeting',to_jsonb(t) from meetings.meeting t where pursuit_id=any($1::uuid[])
    union all select 'ticket',to_jsonb(t) from governance.approval_ticket t where subject_type='pursuit' and subject_id=any($1::uuid[])
    union all select 'note',to_jsonb(t) from research.note t where entity_id in (select entity_id from strategy.pursuit where pursuit_id=any($1::uuid[]))
    ) snapshots order by kind,value::text`,[ids]));
  try {
    const refs = await pursuitReferences(db);
    check('pursuit merge inventories every foreign key in the catalog',
      ['strategy.ladder_event','strategy.suggestion','strategy.pursuit_update','strategy.pursuit_owner','meetings.meeting'].every(table => refs.some(r => r.table===table && r.column==='pursuit_id')),
      'New pursuit foreign keys are found by catalog inspection, including the owner ledger.');
    const rank = await group([{status:'new'},{status:'committed'},{status:'discussing'}]);
    const ranked = await run();
    check('pursuit merge keeps the furthest pipeline status', ranked.merges.some(m => m.survivorId===rank[1]) && await mergedTo(rank[0]!)===rank[1] && await mergedTo(rank[2]!)===rank[1], 'Committed survives New and Discussing.');
    const again = await run();
    check('pursuit merge retries add no merge or duplicate provenance',again.merged===0 && await count('select count(*)::int n from strategy.pursuit_merge where survivor_id=$1',[rank[1]])===1,'Merged losers stay retained and are excluded from subsequent passes.');
    const recent = await group([{status:'selected',human:'2026-09-10T00:00:00Z'},{status:'selected',human:'2026-09-20T00:00:00Z'}]);
    await run();
    check('pursuit merge status ties prefer the latest person change',await mergedTo(recent[0]!)===recent[1],'Both people set Selected; the later change wins despite a newer opening.');
    const oldest = await group([{status:'sourcing',opened:'2026-09-12T00:00:00Z'},{status:'sourcing',opened:'2026-09-01T00:00:00Z'}]);
    await run();
    check('pursuit merge final tie uses the oldest pursuit',await mergedTo(oldest[0]!)===oldest[1],'Equal rule statuses have no human timestamp.');
    const conflict = await group([{status:'selected',human:'2026-09-10T00:00:00Z'},{status:'discussing',human:'2026-09-20T00:00:00Z'}]);
    const conflictBefore = await snapshot(conflict), ambiguous = await run();
    check('pursuit merge leaves conflicting person decisions untouched',ambiguous.ambiguous.some(g => g.pursuitIds.includes(conflict[0]!)) && conflictBefore===await snapshot(conflict),'A later person decision does not silently resolve two different person-set statuses.');
    const protectedGroup = await group([{status:'discussing',human:'2026-09-20T00:00:00Z'},{status:'new'}]);
    await run();
    const protectedRow = await db.one<{ status: string; status_source: string }>('select status::text,status_source from strategy.pursuit where pursuit_id=$1',[protectedGroup[0]]);
    check('pursuit merge never lowers a person-set status',await mergedTo(protectedGroup[1]!)===protectedGroup[0] && protectedRow?.status==='discussing' && protectedRow.status_source==='us','The older rule row cannot lower Discussing.');

    const pair = await group([{status:'selected',human:'2026-09-20T00:00:00Z',owner:actor},{status:'selected',human:'2026-09-10T00:00:00Z',owner:otherOwner}]);
    const [survivor,loser] = pair as [string,string];
    const entity = (await db.one<{entity_id:string}>('select entity_id::text from strategy.pursuit where pursuit_id=$1',[loser]))!.entity_id;
    for (const id of pair) {
      await db.query(`insert into strategy.ladder_event(pursuit_id,rung,evidence_kind,evidence_ref,evidence_note,recorded_by,occurred_at)
        values($1,'connector_willing','fixture',$2,'Invented consent evidence',$3,'2026-09-01')`,[id,`invented:${id}`,actor]);
      await db.query(`insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash,status)
        values($1,'Invented strategy','{}','fixture','2026-09-01','invented-shared-hash',$2)`,[id,id===survivor?'accepted':'dismissed']);
      await db.query(`insert into governance.approval_ticket(kind,subject_type,subject_id,subject_label,scope,vehicle_id,requested_by)
        values('STAGE','pursuit',$1,'Invented rung proposal',$2::jsonb,$3,$4)`,[id,JSON.stringify({apply:{command:'fixture',args:{pursuitId:id}}}),vehicle,actor]);
    }
    await db.query(`insert into governance.approval_ticket(kind,subject_type,subject_id,subject_label,scope,vehicle_id,requested_by,decision,decided_by,decided_at,expires_at)
      values('MONEY','pursuit',$1,'Invented approved bounded action',$2::jsonb,$3,$4,'approve',$4,now(),'2099-01-01')`,[loser,JSON.stringify({apply:{command:'fixture',args:{pursuitId:loser}}}),vehicle,actor]);
    await db.query(`update strategy.pursuit set plan=$2::jsonb,headline='Invented separate headline',next_step='Invented separate next step',owner_said='Invented source owner' where pursuit_id=$1`,[loser,JSON.stringify([{move:'Invented retained move',because:'Invented evidence'}])]);
    await db.query(`insert into strategy.pursuit_update(pursuit_id,body,created_by,idempotency_key) values($1,'Invented original update',$2,$3)`,[loser,actor,`invented:${loser}`]);
    await db.query(`insert into strategy.pursuit_owner(pursuit_id,owner_id,origin_pursuit_id) values($1,$2,$1)`,[loser,otherOwner]);
    await db.query(`insert into meetings.meeting(pursuit_id,entity_id,vehicle_id,kind,owner_id,summary) values($1,$2,$3,'intro',$4,'Invented linked meeting')`,[loser,entity,vehicle,actor]);
    await db.query(`insert into research.note(entity_id,author_id,kind,body,data) values($1,$2,'context','Invented linked note',$3::jsonb)`,[entity,actor,JSON.stringify({pursuitId:loser,nested:{pursuit_id:loser},originalWords:'Keep this text'})]);
    const before = await snapshot(pair);
    const auditBefore = JSON.stringify(await db.query('select * from platform.audit_log where subject_id=any($1::text[]) order by id',[pair]));
    const countsBefore = await withDb(db,()=>statusCounts());
    const full = await run(), merge = full.merges.find(m => m.survivorId===survivor);
    if (!merge) throw new Error('Expected invented reference-rich merge');
    const remaining = await Promise.all(refs.map(ref => count(`select count(*)::int n from ${ref.table} where ${ref.column}=$1`,[loser])));
    check('pursuit merge moves all five FK reference families',remaining.every(n=>n===0),'Ladder, suggestions, updates, meetings and existing owner rows all move.');
    check('pursuit merge preserves colliding rung and file records',await count('select count(*)::int n from strategy.ladder_event where pursuit_id=$1',[survivor])===2 && await count('select count(*)::int n from strategy.suggestion where pursuit_id=$1',[survivor])===2,'Distinct consent evidence and accepted/dismissed decisions survive identical rung/file keys.');
    const note = await db.one<{data:{pursuitId:string;nested:{pursuit_id:string};originalWords:string}}>('select data from research.note where entity_id=$1',[entity]);
    check('pursuit merge redirects nested note references without changing prose',note?.data.pursuitId===survivor && note.data.nested.pursuit_id===survivor && note.data.originalWords==='Keep this text','Both supported pursuit-key spellings redirect recursively.');
    const tickets = await db.query<{id:string;subject_id:string;decision:string|null;scope:{apply:{args:{pursuitId:string}}};expired:boolean}>(`select id::text,subject_id::text,decision::text,scope,expires_at<=now() expired from governance.approval_ticket where subject_id=$1`,[survivor]);
    check('pursuit merge redirects and expires approval scope without duplicate open tickets',tickets.length===3 && tickets.filter(t=>t.decision===null).length===1 && tickets.some(t=>t.decision==='defer'&&t.expired&&t.scope.apply.args.pursuitId===survivor),'Loser proposal becomes deferred; the survivor proposal stays pending.');
    check('pursuit merge invalidates previously approved loser authorizations',tickets.some(t=>t.decision==='approve'&&t.expired&&t.scope.apply.args.pursuitId===survivor),'Retargeting cannot carry an unexpired approval onto the combined pursuit.');
    check('pursuit merge retains every owner and loser strategy context',await count('select count(distinct origin_pursuit_id)::int n from strategy.pursuit_owner where pursuit_id=$1',[survivor])===2 && await count(`select count(*)::int n from strategy.pursuit_update where pursuit_id=$1 and suggested->>'rule'='rule:pursuit-merge' and body like '%Invented separate next step%'`,[survivor])===1,'Primary/source ownership, headline and next step remain attributable.');
    const timeline = await withDb(db,()=>auditFor('pursuit',survivor,['pursuit.status_set']));
    const countsAfter = await withDb(db,()=>statusCounts());
    const selectedCount = (rows:typeof countsAfter) => rows.find(r=>r.vehicleId===vehicle&&r.status==='selected')!.n;
    const oldAudit = JSON.stringify(await db.query("select * from platform.audit_log where subject_id=any($1::text[]) and action='pursuit.status_set' order by id",[pair]));
    check('pursuit merge exposes alias history and excludes losers from active reads',timeline.length===2 && await withDb(db,()=>getPursuit(loser))===null && selectedCount(countsBefore)-selectedCount(countsAfter)===1 && auditBefore===oldAudit,'The original audit rows remain byte-for-byte unchanged and are read through the survivor.');
    check('pursuit merge audit names its stable rule',await count("select count(*)::int n from platform.audit_log where subject_id=$1 and action='pursuit.merged' and detail->>'rule'='rule:pursuit-merge'",[survivor])===1,'One merge decision is separately audited.');
    const reversed = await reversePursuitMerge(db,merge.id,actor,'Invented reversal review');
    check('pursuit merge reversal restores exact references and original records',reversed && before===await snapshot(pair),'Full postimage restoration includes collision evidence, plans, owners, notes and ticket scope/decision.');
    const twice = await reversePursuitMerge(db,merge.id,actor,'Invented retry'), rerun = await run();
    check('pursuit merge reversal is idempotent and not automatically reapplied',!twice && rerun.ambiguous.some(g=>g.pursuitIds.includes(loser)) && before===await snapshot(pair),'The next identity pass respects the reversal.');

    const edited = await group([{status:'discussing'},{status:'new'}]);
    const editedEntity = (await db.one<{entity_id:string}>('select entity_id::text from strategy.pursuit where pursuit_id=$1',[edited[1]]))!.entity_id;
    await db.query(`insert into research.note(entity_id,author_id,body,data) values($1,$2,'Invented original content',$3::jsonb)`,[editedEntity,actor,JSON.stringify({pursuitId:edited[1]})]);
    const editedMerge = (await run()).merges.find(m=>m.survivorId===edited[0])!;
    await db.query("update research.note set body='Invented later edit' where entity_id=$1",[editedEntity]);
    const editedBefore = await snapshot(edited); let refused = false;
    try { await reversePursuitMerge(db,editedMerge.id,actor,'Invented unsafe reversal'); } catch (error) { refused = error instanceof Error && error.message.includes('later edits'); }
    check('pursuit merge reversal refuses subsequent edits atomically',refused && editedBefore===await snapshot(edited),'The conflict leaves every moved reference and merge pointer intact.');

    const importedPair = await group([{status:'new'},{status:'discussing'}]);
    const scratch = await mkdtemp(join(tmpdir(),'pursuit-merge-import-'));
    let importRunId: number | null = null;
    try {
      await mkdir(join(scratch,'raw'));
      const imported = await withDb(db,()=>importFindings(actor,scratch));
      const recorded = await withDb(db,()=>latestRun('enrich','import'));
      importRunId = recorded?.id ?? null;
      const saved = recorded?.detail.pursuitMerges as typeof imported.pursuitMerges;
      const resultMerge = imported.pursuitMerges?.merges.find(m=>m.survivorId===importedPair[1]);
      check('Import the findings consolidates pursuits and persists its source-run report',
        imported.files===0 && imported.pursuitMerges?.merged===1 && !!resultMerge
        && await mergedTo(importedPair[0]!)===importedPair[1] && recorded?.status==='ok'
        && saved?.merged===1 && saved.merges.some(m=>m.id===resultMerge.id&&m.loserIds.includes(importedPair[0]!)),
        'An empty findings folder still runs identity consolidation; the merge ID and count survive in the completed import receipt.');
    } finally {
      await rm(scratch,{recursive:true,force:true});
      if (importRunId !== null) await db.query('delete from sources.sync_run where id=$1',[importRunId]);
    }
  } finally {
    await db.query('delete from governance.approval_ticket where subject_type=\'pursuit\' and subject_id=any($1::uuid[])',[pursuits]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])',[entities]);
    for (const table of ['strategy.ladder_event','strategy.suggestion','strategy.pursuit_update','strategy.pursuit_owner','meetings.meeting']) await db.query(`delete from ${table} where pursuit_id=any($1::uuid[])`,[pursuits]);
    await db.query('delete from strategy.pursuit_merge where survivor_id=any($1::uuid[])',[pursuits]);
    await db.query('delete from platform.audit_log where subject_type=\'pursuit\' and subject_id=any($1::text[])',[pursuits]);
    await db.query('update strategy.pursuit set merged_into=null where pursuit_id=any($1::uuid[])',[pursuits]);
    await db.query('delete from strategy.pursuit where pursuit_id=any($1::uuid[])',[pursuits]);
    await db.query('update identity.entity set merged_into=null where entity_id=any($1::uuid[])',[entities]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])',[entities]);
  }
}
