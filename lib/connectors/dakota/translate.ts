import type { Db, Queryable } from '@/lib/db';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { withBackgroundDb } from '@/lib/db/scheduling';
import { config } from '@/config/deployment';
import { externalIdentityIndex, resolveExternalIdentity } from '@/modules/identity/external';
import { needed, neededRecord, type Module, type Replica, type RecordFields } from './replica';
import { accountFit, contactRelevance } from './rules';

export interface DakotaCounts { replicas: number; accounts: number; contacts: number; unchanged: number; merged: number; possible: number; claims: number; sourced: number }
export type Stored = RecordFields & { entity_id:string;replica_file:string;last_verified_by:string };
const accountFields = ['type','aum__c','discretionary_assets__c','average_ticket_size__c','check_size_from__c','check_size_to__c',
  'private_equity_average_ticket_size__c','venture_capital__c','private_equity__c','cryptocurrency__c','investment_interest__c',
  'investment_focus_single__c','industry_focus__c','sector__c','asset_classes__c','geography__c','private_equity_fof__c','fof__c','billingcity','billingstate','billingcountry','of_employees__c'];
const contactFields = ['title','contact_type__c','asset_class_coverage__c','mailingcity','mailingstate','mailingcountry'];
const asIso = (x: unknown) => new Date(x as string).toISOString();

async function storeRecord(tx: Queryable, module: Module, record: RecordFields, file: string, actor: string,
  index: Awaited<ReturnType<typeof externalIdentityIndex>>, accountNames: Map<string,string>, counts: DakotaCounts) {
  const previous = await tx.one<Stored>(`select * from dakota.${module} where id=$1`,[record.id]);
  const merged: RecordFields = {...record};
  for(const key of needed(module)) if(!(key in record)) merged[key]=previous?.[key]??null;
  merged.lastmodifieddate=record.lastmodifieddate;
  if(previous && (asIso(previous.lastmodifieddate)>record.lastmodifieddate || needed(module).every(k=>
    k==='lastmodifieddate'?asIso(previous[k])===record[k]:previous[k]===merged[k]))) { counts.unchanged++;return; }
  const name=module==='account' ? accountNames.get(record.id) || merged.website || `Dakota account ${record.id}`
    : [merged.firstname,merged.lastname].filter(Boolean).join(' ') || `Dakota contact ${record.id}`;
  const identity=await resolveExternalIdentity(tx,index,{source:'dakota',sourceId:`${module}:${record.id}`,type:module==='account'?'org':'person',name,
    identifiers:module==='account'?{domain:merged.website??'',linkedin:merged.linkedin__c??(merged.lid__linkedin_company_id__c?`https://linkedin.com/company/${merged.lid__linkedin_company_id__c}`:''),crd:merged.crd__c??'',cik:merged.sec_cik__c??''}:{linkedin:merged.linkedin_url__c??''},
    asOf:record.lastmodifieddate,verifiedBy:actor});
  const columns=[...needed(module),'entity_id','replica_file','last_verified_by'];
  await tx.query(`insert into dakota.${module}(${columns.join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')})
    on conflict(id) do update set ${columns.filter(c=>c!=='id').map(c=>`${c}=excluded.${c}`).join(',')}`,
    [...needed(module).map(k=>merged[k]??null),identity.id,file,actor]);
  counts[module==='account'?'accounts':'contacts']++;counts.merged+=identity.merged;counts.possible+=identity.possible;
}

async function employment(tx: Queryable, contacts: Stored[], accounts: Map<string,Stored>) {
  const started=performance.now();
  let processed=0;
  for(const c of contacts) {
    if(processed&&performance.now()-started>=config.dakota.translationBatchWorkMs)break;
    processed++;
    if(processed%20===0)await yieldTurn();
    const a=c.accountid?accounts.get(c.accountid):undefined;
    const old=await tx.one<{affiliation_id:string;edge_id:string}>('select affiliation_id::text,edge_id::text from dakota.employment where contact_id=$1',[c.id]);
    const at=asIso(c.lastmodifieddate),date=at.slice(0,10);
    if(!a) {
      if(old) {
        await tx.query('update identity.affiliation set ended_on=$2,is_primary=false where affiliation_id=$1 and ended_on is null',[old.affiliation_id,date]);
        await tx.query('update network.edge set valid_to=$2 where edge_id=$1 and valid_to is null',[old.edge_id,date]);
      }
      continue;
    }
    const evidence=JSON.stringify([{source:'dakota',as_of:at,confidence:config.dakota.claimConfidence,last_verified_by:c.last_verified_by,
      note:'Employment affiliation claimed by Dakota; title is not evidence of decision rights.',replica_file:c.replica_file}]);
    if(old) {
      await tx.query(`update identity.affiliation set org_entity=$2,role=$3,as_of=$4,ended_on=null,note=$5 where affiliation_id=$1
        and (org_entity,role,as_of,ended_on,note) is distinct from ($2::uuid,$3::text,$4::date,null::date,$5::text)`,
        [old.affiliation_id,a.entity_id,c.title??'not recorded',date,evidence]);
      await tx.query(`update network.edge set to_entity=$2,evidence=$3::jsonb,valid_from=$4,valid_to=null where edge_id=$1
        and (to_entity,evidence,valid_from,valid_to) is distinct from ($2::uuid,$3::jsonb,$4::date,null::date)`,[old.edge_id,a.entity_id,evidence,date]);
    } else {
      const aff=await tx.one<{id:string}>(`insert into identity.affiliation(person_entity,org_entity,kind,role,is_primary,source,as_of,certainty,note)
        values($1,$2,'staff',$3,false,'dakota',$4,'claimed',$5) returning affiliation_id::text id`,[c.entity_id,a.entity_id,c.title??'not recorded',date,evidence]);
      const edge=await tx.one<{id:string}>(`insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from)
        values($1,$2,'employment','C',$3::jsonb,$4) returning edge_id::text id`,[c.entity_id,a.entity_id,evidence,date]);
      await tx.query('insert into dakota.employment(contact_id,affiliation_id,edge_id) values($1,$2,$3)',[c.id,aff!.id,edge!.id]);
    }
  }
  return processed;
}

async function enrich(tx: Queryable,module: Module,records: Stored[],counts: DakotaCounts) {
  const fields=module==='account'?accountFields:contactFields;
  // Source-owned claims follow canonical identity at read time, so undo never moves source facts.
  const pipeline=new Set((await tx.query<{id:string}>(`with roots as materialized (select * from identity.entity_resolution)
    select distinct r.entity_id::text id from roots r join roots p on p.canonical_id=r.canonical_id
    join strategy.pursuit pursuit on pursuit.entity_id=p.entity_id`)).map(x=>x.id));
  if(module==='account')for(const r of await tx.query<{id:string}>(`with roots as materialized (select * from identity.entity_resolution)
    select distinct a.entity_id::text id from dakota.contact c join dakota.account a on a.id=c.accountid
    join roots r on r.entity_id=c.entity_id join roots p on p.canonical_id=r.canonical_id
    join strategy.pursuit pursuit on pursuit.entity_id=p.entity_id`))pipeline.add(r.id);
  const values:Array<{record_id:string;entity_id:string;field:string;value:string|null;as_of:string;last_verified_by:string;replica_file:string}>=[];
  for(const r of records) {
    if(!pipeline.has(r.entity_id))continue;
    for(const field of fields)values.push({record_id:r.id,entity_id:r.entity_id,field,value:r[field]||null,
      as_of:asIso(r.lastmodifieddate),last_verified_by:r.last_verified_by,replica_file:r.replica_file});
    await yieldTurn();
  }
  if(!values.length)return;
  const payload=JSON.stringify(values);
  await tx.query(`delete from dakota.claim c using jsonb_to_recordset($2::jsonb) v(record_id text,field text,value text)
    where c.module=$1 and c.record_id=v.record_id and c.field=v.field and v.value is null`,[module,payload]);
  const changed=await tx.query(`insert into dakota.claim(module,record_id,entity_id,field,value,as_of,last_verified_by,replica_file)
    select $1,v.record_id,v.entity_id,v.field,v.value,v.as_of,v.last_verified_by,v.replica_file from jsonb_to_recordset($2::jsonb)
      v(record_id text,entity_id uuid,field text,value text,as_of timestamptz,last_verified_by uuid,replica_file text) where v.value is not null
    on conflict(module,record_id,field) do update set value=excluded.value,as_of=excluded.as_of,
      last_verified_by=excluded.last_verified_by,replica_file=excluded.replica_file
    where (claim.value,claim.as_of) is distinct from (excluded.value,excluded.as_of) returning field`,[module,payload]);
  counts.claims+=changed.length;
}

type Vehicle = {id:string;slug:string;name:string};
type Candidate = {account:string;id:string;vehicle:string;score:number;reason:string};
interface SourceContext {
  vehicles: Vehicle[]; roots: Map<string,string>; excluded: Set<string>; existing: Set<string>; remaining: Map<string,number>;
}
/** Build sets once per page, rather than accounts × affiliations × possible matches.
 * Only pairs adjacent to a blocked/pursued identity affect eligibility. SQL projects
 * canonical IDs once, not a recursive function for each endpoint. */
async function sourceContext(tx: Queryable, restrictionsOnly=false): Promise<SourceContext> {
  const vehicles=await tx.query<Vehicle>(`select id::text,slug,name from platform.vehicle where phase<>'historical' and kind::text<>'grant_rail'`);
  const roots=new Map((await tx.query<{id:string;root:string}>('select entity_id::text id,canonical_id::text root from identity.entity_resolution')).map(r=>[r.id,r.root]));
  const canonical=(id:string)=>roots.get(id)??id;
  const blocked=new Set((await tx.query<{id:string}>(`select entity_id::text id from coordination.restriction where expires_at is null or expires_at>current_date`)).map(r=>canonical(r.id)));
  const pursuits=await tx.query<{id:string;vehicle:string;source:string}>(`select entity_id::text id,vehicle_id::text vehicle,source from strategy.pursuit`);
  const excluded=new Set([...blocked,...pursuits.filter(p=>!restrictionsOnly||p.source!=='dakota').map(p=>canonical(p.id))]);
  // Freeze the base set: uncertainty is one-hop, not transitive name propagation.
  const base=new Set(excluded);
  const pairs=await tx.query<{a:string;b:string}>(`select left_entity::text a,right_entity::text b from identity.possible_match where active`);
  for(let i=0;i<pairs.length;i++) {
    const p=pairs[i]!,a=canonical(p.a),b=canonical(p.b);
    if(base.has(a))excluded.add(b);if(base.has(b))excluded.add(a);
    if(i%200===0)await yieldTurn();
  }
  for(const a of await tx.query<{person:string;org:string}>(`select person_entity::text person,org_entity::text org from identity.affiliation where ended_on is null`))
    if(base.has(canonical(a.person)))excluded.add(canonical(a.org));
  return {vehicles,roots,excluded,existing:new Set(pursuits.map(p=>`${canonical(p.id)}:${p.vehicle}`)),
    remaining:new Map(vehicles.map(v=>[v.id,Math.max(0,config.dakota.perVehicleCap-pursuits.filter(p=>p.vehicle===v.id&&p.source==='dakota').length)]))};
}

export interface DakotaProgress { phase:string; done:number; total:number }
interface State extends DakotaProgress {
  policy:string;
  inputs: Array<{module:Module;file:string;hash:string;size:number}>;
  replica:number; offset:number; cursor:string; counts:DakotaCounts; plan:Candidate[];
}
export interface DakotaJob {
  id:string; status:'queued'|'running'|'failed'|'completed'; started_at:string; last_batch_at:string|null;
  finished_at:string|null; actor:string; state:State|null; error:string|null;
}
export interface DakotaStatus extends DakotaProgress {
  id:string;status:DakotaJob['status'];started:string;lastBatch:string|null;result:DakotaCounts;error:string|null;
}
export const emptyCounts = (): DakotaCounts => ({replicas:0,accounts:0,contacts:0,unchanged:0,merged:0,possible:0,claims:0,sourced:0});
export async function dakotaJob(db: Queryable): Promise<DakotaJob|null> {
  return db.one<DakotaJob>('select id::text,actor::text,status,started_at,last_batch_at,finished_at,state,error from dakota.translation_job where singleton');
}
export async function dakotaStatus(db: Queryable): Promise<DakotaStatus|null> {
  const job=await dakotaJob(db);if(!job)return null;
  return {id:job.id,status:job.status,started:asIso(job.started_at),lastBatch:job.last_batch_at?asIso(job.last_batch_at):null,
    phase:job.state?.phase??'reading',done:job.state?.done??0,total:job.state?.total??0,result:job.state?.counts??emptyCounts(),error:job.error};
}
export async function queueDakota(db: Db, actor: string): Promise<void> {
  await db.transaction(async tx=>{
    await tx.query(`insert into dakota.translation_job(singleton,actor,status) values(true,$1,'queued')
      on conflict(singleton) do update set id=gen_random_uuid(),actor=excluded.actor,status='queued',started_at=now(),
        last_batch_at=null,finished_at=null,state=null,error=null where translation_job.status='completed'`,[actor]);
    await tx.query(`update dakota.translation_job set status='queued',error=null where status='failed'`);
  });
}

export interface DakotaOptions {
  /** GUESS: 200 rows bounds connection occupancy; measured by the invented 15k benchmark. */
  batchSize?:number;
  /** Test interruption point: called only after the effects and cursor have committed. */
  afterBatch?:(progress:DakotaProgress)=>Promise<void>;
}
async function checkpoint(tx: Queryable, state: State) {
  await tx.query(`update dakota.translation_job set state=$1::jsonb,status=$2,last_batch_at=clock_timestamp(),
    finished_at=case when $2='completed' then clock_timestamp() else null end,error=null where singleton`,
    [JSON.stringify(state),state.phase==='completed'?'completed':'running']);
}
async function namesFor(tx: Queryable, replicas: Replica[]) {
  const names=new Map<string,string>();
  for(const c of await tx.query<{accountid:string;account_name__c:string}>(`select accountid,account_name__c from dakota.contact where accountid is not null and account_name__c is not null order by lastmodifieddate,id`))names.set(c.accountid,c.account_name__c);
  let n=0;
  for(const batch of replicas)if(batch.module==='contact')for(const c of batch.records) {
    if(c.accountid&&c.account_name__c)names.set(c.accountid,c.account_name__c);
    if(++n%200===0)await yieldTurn();
  }
  return names;
}

/** Local background worker; no external orchestration. Each bounded transaction commits
 * source effects and the next cursor together. Restart reconstructs indexes from committed
 * state and validates frozen inputs before advancing. Supplied handles only. */
export async function translateDakota(db: Db,actor: string,replicas: Replica[],options: DakotaOptions={}): Promise<DakotaCounts> {
  const size=options.batchSize??config.dakota.translationBatchRecords;
  if(!Number.isSafeInteger(size)||size<1||size>config.dakota.translationBatchRecords)throw new Error('Invalid Dakota batch size.');
  return withBackgroundDb(async()=>{
    const policy=createHash('sha256').update(JSON.stringify({version:'dakota-batched-v1',config:config.dakota})).digest('hex');
    let job=await dakotaJob(db);
    const completed=await db.query<{module:Module;file:string;hash:string}>('select module,file,hash from dakota.replica');
    const imported=new Map(completed.map(r=>[`${r.module}:${r.file}`,r.hash]));
    for(const r of replicas)if(imported.has(`${r.module}:${r.file}`)&&imported.get(`${r.module}:${r.file}`)!==r.hash)
      throw new Error('A completed Dakota replica changed; import refused.');
    if(!job||job.status==='completed') {
      if(!replicas.some(r=>!imported.has(`${r.module}:${r.file}`)))return emptyCounts();
      await queueDakota(db,actor);job=await dakotaJob(db);
    }
    actor=job!.actor;
    let state=job!.state;
    if(!state) {
      const inputs=replicas.filter(r=>!imported.has(`${r.module}:${r.file}`)).map(r=>({module:r.module,file:r.file,hash:r.hash,size:r.records.length}));
      state={policy,inputs,replica:0,offset:0,cursor:'',phase:'records',done:0,total:inputs.reduce((n,r)=>n+r.size,0),counts:emptyCounts(),plan:[]};
      await db.transaction(async tx=>{
        const saved=await tx.one<{state:State|null}>('select state from dakota.translation_job where id=$1 for update',[job!.id]);
        if(!saved)throw new Error('Dakota job changed before initialization.');
        if(saved.state)state=saved.state;
        else await checkpoint(tx,state!);
      });
    }
    if(state.policy!==policy)throw new Error('Dakota job rules changed; resume refused.');
    const inputs=state.inputs.map(input=>{
      const r=replicas.find(r=>r.module===input.module&&r.file===input.file);
      if(!r||r.hash!==input.hash||r.records.length!==input.size)throw new Error('Dakota job inputs changed; resume refused.');
      return r;
    });
    const names=await namesFor(db,inputs);
    const revision=async(tx:Queryable)=>(await tx.one<{revision:string}>('select revision::text from dakota.identity_revision where singleton'))!.revision;
    let index:Awaited<ReturnType<typeof externalIdentityIndex>>|undefined,indexRevision:string|undefined;
    while(state.phase!=='completed') {
      await yieldTurn();
      if(state.phase==='records') {
        const before=await revision(db);
        if(!index||indexRevision!==before) {
          index=await externalIdentityIndex(db);
          indexRevision=await revision(db);
          // Foreground edits may have interleaved these bounded reads. Rebuild a
          // coherent index rather than use a mixed snapshot for identity decisions.
          if(before!==indexRevision){index=undefined;continue;}
        }
      }
      // Copy before mutation: failures leave both the persisted cursor and in-memory
      // counters at the last commit. No index from a rolled-back batch is reused.
      const next:State=structuredClone(state);
      const committed=await db.transaction(async tx=>{
        await tx.exec('lock table dakota.translation_job,identity.entity,identity.source_record,identity.external_identifier,identity.match_assertion,research.claim,research.note,sources.raw_record,strategy.pursuit in share row exclusive mode');
        if(next.phase==='records'&&await revision(tx)!==indexRevision){index=undefined;return false;}
        const owns=await tx.one('select 1 from dakota.translation_job where id=$1 and state=$2::jsonb',[job!.id,JSON.stringify(state)]);
        if(!owns)throw new Error('Dakota checkpoint advanced in another worker.');
        if(next.phase==='records') {
          const replica=inputs[next.replica];
          if(!replica) {next.phase=next.counts.accounts||next.counts.contacts?'accounts':'completed';next.cursor='';}
          else {
            const started=performance.now();
            for(const record of replica.records.slice(next.offset,next.offset+size)) {
              await storeRecord(tx,replica.module,neededRecord(replica.module,record),replica.file,actor,index!,names,next.counts);
              next.offset++;next.done++;
              if(next.done%20===0)await yieldTurn();
              if(performance.now()-started>=config.dakota.translationBatchWorkMs)break;
            }
            if(next.offset===replica.records.length) {
              await tx.query('insert into dakota.replica(module,file,hash) values($1,$2,$3) on conflict do nothing',[replica.module,replica.file,replica.hash]);
              next.counts.replicas++;next.replica++;next.offset=0;
            }
          }
        } else if(next.phase==='accounts') {
          const accounts=await tx.query<Stored>('select * from dakota.account where id>$1 order by id limit $2',[next.cursor,size]);
          const contacts=await tx.query<Stored>('select * from dakota.contact where accountid=any($1::text[]) order by id',[accounts.map(a=>a.id)]);
          const likely=new Map<string,Stored>();
          for(const c of contacts)if(c.accountid&&contactRelevance(c.title)>contactRelevance(likely.get(c.accountid)?.title??null))likely.set(c.accountid,c);
          for(const a of accounts) {
            const name=names.get(a.id);if(name)await tx.query('update identity.entity set display_name=$2 where entity_id=$1 and display_name is distinct from $2',[a.entity_id,name]);
            await tx.query('update dakota.account set likely_contact_id=$2 where id=$1 and likely_contact_id is distinct from $2',[a.id,likely.get(a.id)?.id??null]);
            next.cursor=a.id;
          }
          if(accounts.length<size){next.phase='employment';next.cursor='';}
        } else if(next.phase==='employment') {
          const contacts=await tx.query<Stored>('select * from dakota.contact where id>$1 order by id limit $2',[next.cursor,size]);
          const accounts=await tx.query<Stored>('select * from dakota.account where id=any($1::text[])',[contacts.map(c=>c.accountid).filter(Boolean)]);
          const processed=await employment(tx,contacts,new Map(accounts.map(a=>[a.id,a])));
          next.cursor=contacts[processed-1]?.id??next.cursor;
          if(processed===contacts.length&&contacts.length<size){next.phase='ranking';next.cursor='';}
        } else if(next.phase==='ranking') {
          const context=await sourceContext(tx);
          const accounts=await tx.query<Stored>('select * from dakota.account where id>$1 order by id limit $2',[next.cursor,size]);
          for(const v of context.vehicles) {
            const ranked=next.plan.filter(c=>c.vehicle===v.id);
            for(const a of accounts) {
              const id=context.roots.get(a.entity_id)??a.entity_id,fit=accountFit(a,v);
              if(!fit||context.excluded.has(id)||context.existing.has(`${id}:${v.id}`))continue;
              const reason=`${fit.reason}; fit score ${fit.score} (rule ranking, not probability); source dakota; as_of ${asIso(a.lastmodifieddate)}; confidence ${config.dakota.claimConfidence}; last_verified_by ${a.last_verified_by}`;
              ranked.push({account:a.id,id,vehicle:v.id,score:fit.score,reason});
            }
            ranked.sort((a,b)=>b.score-a.score||a.account.localeCompare(b.account));
            const seen=new Set<string>();
            next.plan=next.plan.filter(c=>c.vehicle!==v.id).concat(ranked.filter(c=>!seen.has(c.id)&&!!seen.add(c.id)).slice(0,context.remaining.get(v.id)??0));
          }
          next.cursor=accounts.at(-1)?.id??next.cursor;
          if(accounts.length<size){next.phase='sourcing';next.offset=0;next.cursor='';}
        } else if(next.phase==='sourcing') {
          // Recheck current restrictions under the same lock as each write. Persisted
          // ranking is stable across restarts; don't fill gaps with lower-ranked rows.
          const context=await sourceContext(tx,true);
          for(const c of next.plan.slice(next.offset,next.offset+size)) {
            const blocked=context.excluded.has(context.roots.get(c.id)??c.id);
            if(!blocked) {
              const row=await tx.one(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_reason,status_set_at,status_set_by,source)
                select identity.canonical_entity_id($1),$2,$3,'new','rule',$4,now(),$3,'dakota'
                where (select count(*) from strategy.pursuit where vehicle_id=$2 and source='dakota')<$5
                  and not exists(select 1 from strategy.pursuit where identity.canonical_entity_id(entity_id)=identity.canonical_entity_id($1) and vehicle_id=$2)
                on conflict(entity_id,vehicle_id) do nothing returning pursuit_id`,[c.id,c.vehicle,actor,c.reason,config.dakota.perVehicleCap]);
              if(row)next.counts.sourced++;
            }
            next.offset++;
          }
          if(next.offset===next.plan.length){next.phase='account claims';next.cursor='';next.plan=[];}
        } else {
          const module:Module=next.phase==='account claims'?'account':'contact';
          const records=await tx.query<Stored>(`select * from dakota.${module} where id>$1 order by id limit $2`,[next.cursor,size]);
          await enrich(tx,module,records,next.counts);
          next.cursor=records.at(-1)?.id??next.cursor;
          if(records.length<size){next.phase=module==='account'?'contact claims':'completed';next.cursor='';}
        }
        if(next.phase==='records')indexRevision=await revision(tx);
        await checkpoint(tx,next);
        if(next.phase==='completed'&&(next.counts.replicas||next.counts.sourced||next.counts.claims))
          await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,detail) values($1,'dakota.translated','enrich',$2::jsonb)`,[actor,JSON.stringify(next.counts)]);
        return true;
      });
      if(!committed)continue;
      state=next;
      await options.afterBatch?.({phase:state.phase,done:state.done,total:state.total});
    }
    return state.counts;
  });
}
